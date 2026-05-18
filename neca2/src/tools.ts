// ---- neca2 MCP 工具定义 ----

import { z } from 'zod';
import { makeMessage } from './protocol/codec.js';
import { BinaryCodec, compressionRatio } from './protocol/binary-codec.js';
import { routeMessage, getPendingFor, pendingCount } from './relay/router.js';
import { getSession, listSessions, sessionStats, deleteSession } from './relay/session.js';
import { relayManager } from './relay/http-relay.js';
import { STANDARD_AGENTS, STANDARD_MESSAGE_TYPES } from './protocol/types.js';
import { getMetaState, getTrace, getRecentTraces, adaptive } from './meta/orchestrator.js';
import { getContextForHealth, getFullContext, updateMemory, addTopic } from './memory/memory-manager.js';
import { retryQueue } from './relay/retry-queue.js';
import { runMiddlewarePipeline, resetRateLimiter } from './relay/midware-pipeline.js';
import { logger, getLogDir } from './utils/logger.js';
import { readBlackboard, writeSelfStatus, getBlackboardSummary, isNecaAlive, addMessageToBlackboard } from './shared/blackboard.js';
import { getNecaSummary, getBridgeStats } from './shared/neca-bridge.js';

const AGENT_NAMES = STANDARD_AGENTS.map(a => a) as [string, ...string[]];
const MSG_TYPES = STANDARD_MESSAGE_TYPES.map(t => t) as [string, ...string[]];
const MSG_TYPES_NO_SYSTEM = MSG_TYPES.filter(t => !['pong', 'ack', 'error', 'init'].includes(t)) as [string, ...string[]];

// 二进制 codec 实例（用于演示压缩率）
const binaryCodec = new BinaryCodec();

export const tools = {
  neca2_send: {
    description: 'Send a message through the Silent Protocol compact protocol to any agent. Supports callback polling.',
    parameters: z.object({
      to: z.enum(AGENT_NAMES).describe('Target agent'),
      type: z.enum(MSG_TYPES_NO_SYSTEM).describe('Message type'),
      payload: z.record(z.unknown()).describe('Message payload'),
      callback: z.boolean().optional().default(false).describe('Wait for response?'),
      id: z.string().optional().describe('Custom message ID'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const msg = makeMessage('cloud_ds', args.to, args.type, args.payload as any, args.callback ?? false);
      if (args.id) msg.id = args.id;

      // 通过中间件管道校验
      const midResult = await runMiddlewarePipeline(msg);
      if (!midResult.allowed) {
        return { success: false, error: midResult.error || 'Message rejected by middleware', data: { validation: midResult.validation } };
      }

      const session = await routeMessage(midResult.message!);
      addTopic(`${args.type}→${args.to}`);

      // 记录到黑板报
      addMessageToBlackboard('cloud_ds', args.to, args.type, JSON.stringify(args.payload).substring(0, 60));

      if (args.callback && session.status !== 'reply_received' && session.status !== 'error') {
        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 200));
          const current = getSession(session.id);
          if (!current) break;
          if (current.status === 'reply_received' || current.status === 'completed') {
            return { success: true, data: { sessionId: current.id, status: current.status, response: current.response } };
          }
          if (current.status === 'error' || current.status === 'timeout' || current.status === 'cancelled') {
            return { success: false, error: 'session failed: ' + current.status, data: current.response };
          }
        }
        return { success: false, error: 'callback timeout', data: getSession(session.id) };
      }
      return { success: true, data: { sessionId: session.id, status: session.status } };
    },
  },

  neca2_poll: {
    description: 'Poll relay session status. Non-blocking.',
    parameters: z.object({ id: z.string().describe('Session ID') }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const session = getSession(args.id);
      if (!session) return { success: false, error: 'session not found: ' + args.id, data: null };
      const trace = getTrace(args.id);
      return {
        success: true,
        data: { id: session.id, status: session.status, response: session.response, age: Date.now() - session.createdAt, trace },
      };
    },
  },

  neca2_pending: {
    description: 'Get pending messages for an agent (consumed on read).',
    parameters: z.object({
      for: z.enum(['cloud_ds', 'local_claude', 'user']).optional().default('cloud_ds'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const agent = args.for || 'cloud_ds';
      const messages = getPendingFor(agent);
      return { success: true, data: { agent, count: messages.length, messages: messages.map(m => ({ id: m.id, from: m.from, type: m.type, payload: m.payload, ts: m.ts })) } };
    },
  },

  neca2_sessions: {
    description: 'List active sessions.',
    parameters: z.object({
      status: z.string().optional().describe('Filter by status'),
      to: z.string().optional().describe('Filter by target'),
      limit: z.number().optional().default(20),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const filter: any = {};
      if (args.status) filter.status = args.status;
      if (args.to) filter.to = args.to;
      const sessions = listSessions(filter).slice(0, args.limit ?? 20);
      return { success: true, data: { stats: sessionStats(), sessions } };
    },
  },

  neca2_session_delete: {
    description: 'Delete a session.',
    parameters: z.object({ id: z.string().describe('Session ID') }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const deleted = deleteSession(args.id);
      return { success: deleted, data: { deleted, id: args.id } };
    },
  },

  neca2_relay_status: {
    description: 'Check relay provider status.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      return {
        success: true,
        data: {
          availableProviders: relayManager.availableProviders,
          defaultProvider: relayManager.default,
          available: relayManager.available,
          sessionStats: sessionStats(),
          pendingCount: pendingCount(),
          retryQueue: { depth: retryQueue.depth, stats: retryQueue.stats },
        },
      };
    },
  },

  neca2_health: {
    description: 'Server health check. Returns status, uptime, and project memory context for session continuity.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const ctx = getContextForHealth();
      return {
        success: true,
        data: {
          status: 'ok',
          uptime: process.uptime(),
          platform: process.platform,
          nodeVersion: process.version,
          features: [
            'json-codec', 'binary-codec', 'validator-middleware', 'retry-queue',
            'auto-persist', 'structured-logging', 'codec-factory', 'router-scheduler',
            'cli', 'shared-blackboard', 'neca-bridge',
          ],
          sessionStats: sessionStats(),
          retryQueueStats: retryQueue.stats,
          retryQueueDepth: retryQueue.depth,
          bridge: getBridgeStats(),
          blackboard: getBlackboardSummary(),
          memory: ctx,
        },
      };
    },
  },

  neca2_protocol_info: {
    description: 'Compact protocol spec summary.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      // 演示二进制压缩效果
      const demoMsg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hello world', cwd: '/tmp', timeout: 5000 });
      const jsonBytes = JSON.stringify(demoMsg).length;
      const binaryBytes = binaryCodec.encode(demoMsg).length;
      const ratio = compressionRatio(jsonBytes, binaryBytes);

      return {
        success: true,
        data: {
          version: 1,
          standardAgents: STANDARD_AGENTS,
          standardMessageTypes: STANDARD_MESSAGE_TYPES,
          codecs: ['json', 'binary'],
          features: [
            'callback', 'persistence', 'multi-model-relay',
            'meta-orchestrator', 'memory-persistence',
            'binary-codec', 'validator-middleware', 'retry-queue',
            'auto-persist', 'structured-logging',
            'codec-factory', 'router-scheduler', 'cli',
            'shared-blackboard', 'neca-bridge',
          ],
          compressionDemo: {
            messageType: 'exec',
            jsonBytes,
            binaryBytes,
            saving: ratio,
          },
        },
      };
    },
  },

  neca2_exec: {
    description: 'Execute a shell command via compact protocol.',
    parameters: z.object({
      cmd: z.string().describe('Command'),
      cwd: z.string().optional().describe('Working directory'),
      timeout: z.number().optional().default(30000),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: args.cmd, cwd: args.cwd, timeout: args.timeout ?? 30000 }, true);

      // 通过中间件管道
      const midResult = await runMiddlewarePipeline(msg);
      if (!midResult.allowed) {
        return { success: false, error: midResult.error || 'Message rejected', data: null };
      }

      const session = await routeMessage(midResult.message!);
      if (session.status === 'reply_received' && session.response) return { success: true, data: session.response.payload };
      return { success: false, error: 'exec failed', data: session.response };
    },
  },

  neca2_meta_state: {
    description: 'Get the full meta-orchestrator state: timing traces, agent models, adaptive policies, latency budgets.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      return { success: true, data: getMetaState() };
    },
  },

  neca2_memory_write: {
    description: 'Write a file using memory-first approach: construct in memory, verify, then write to disk atomically.',
    parameters: z.object({
      path: z.string().describe('Target file path'),
      content: z.string().describe('File content to write'),
      verify: z.object({
        language: z.string().describe('Programming language (rust, typescript, python, etc.)'),
        checkSyntax: z.boolean().optional().default(true).describe('Run syntax check before writing'),
        checkCompile: z.boolean().optional().default(false).describe('Run compilation check before writing'),
        testCmd: z.string().optional().describe('Custom verification command'),
      }).optional(),
      atomic: z.boolean().optional().default(true).describe('Use atomic rename (temp file + move)'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const fs = await import('node:fs');
      const pathModule = await import('node:path');
      const crypto = await import('node:crypto');
      const { execSync } = await import('node:child_process');

      const targetPath = pathModule.resolve(args.path);
      const content = args.content;
      const verify = args.verify;
      const atomic = args.atomic ?? true;

      const result: any = {
        path: targetPath,
        size: Buffer.byteLength(content, 'utf-8'),
        atomic,
        verified: false,
        written: false,
        errors: [],
      };

      if (verify) {
        const tmpDir = pathModule.join(process.env.TEMP || '/tmp', 'neca2_verify');
        fs.mkdirSync(tmpDir, { recursive: true });
        const ext = verify.language === 'rust' ? '.rs'
          : verify.language === 'typescript' ? '.ts'
          : verify.language === 'python' ? '.py'
          : verify.language === 'javascript' ? '.js'
          : verify.language === 'go' ? '.go'
          : '.tmp';
        const tmpFile = pathModule.join(tmpDir, `verify_${crypto.randomUUID()}${ext}`);

        try {
          fs.writeFileSync(tmpFile, content, 'utf-8');
          if (verify.checkSyntax || verify.checkCompile) {
            let cmd = '';
            if (verify.language === 'rust' && verify.checkCompile) {
              cmd = `rustc --edition 2021 --crate-type lib "${tmpFile}" -o "${tmpFile}.out" 2>&1`;
            } else if (verify.language === 'rust') {
              cmd = `rustfmt --check "${tmpFile}" 2>&1`;
            } else if (verify.language === 'typescript' && verify.checkCompile) {
              cmd = `npx tsc --noEmit --strict "${tmpFile}" 2>&1`;
            } else if (verify.language === 'python' && verify.checkSyntax) {
              cmd = `python -m py_compile "${tmpFile}" 2>&1`;
            } else if (verify.testCmd) {
              cmd = verify.testCmd.replace('{file}', tmpFile);
            }
            if (cmd) {
              try {
                execSync(cmd, { timeout: 30000, windowsHide: true, encoding: 'utf-8' });
                result.verified = true;
              } catch (e: any) {
                result.errors.push({ phase: 'verify', error: e.stderr || e.message });
                result.verified = false;
              }
            }
          }
          try { fs.unlinkSync(tmpFile); } catch {}
          try { fs.unlinkSync(tmpFile + '.out'); } catch {}
        } catch (e: any) {
          result.errors.push({ phase: 'tmp_write', error: e.message });
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }

      if (!verify || result.verified || result.errors.length === 0) {
        try {
          const dir = pathModule.dirname(targetPath);
          fs.mkdirSync(dir, { recursive: true });
          if (atomic) {
            const tmpTarget = targetPath + '.neca2_tmp';
            fs.writeFileSync(tmpTarget, content, 'utf-8');
            fs.renameSync(tmpTarget, targetPath);
          } else {
            fs.writeFileSync(targetPath, content, 'utf-8');
          }
          result.written = true;
          result.writtenAt = Date.now();
        } catch (e: any) {
          result.errors.push({ phase: 'write', error: e.message });
        }
      }
      return { success: result.written, data: result };
    },
  },

  neca2_memory_context: {
    description: 'Get or update the persistent project memory. Auto-loaded on startup, auto-saved on every tool call. Returns full context for session continuity.',
    parameters: z.object({
      action: z.enum(['read', 'set_user', 'set_phase', 'add_topic', 'set_summary']).default('read').describe('Action to perform'),
      name: z.string().optional().describe('User name (for set_user)'),
      mode: z.string().optional().describe('Preferred mode (for set_user)'),
      phase: z.string().optional().describe('Project phase (for set_phase)'),
      topic: z.string().optional().describe('Topic to add (for add_topic)'),
      summary: z.string().optional().describe('Project summary (for set_summary)'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      switch (args.action) {
        case 'set_user':
          updateMemory({ userIdentity: { name: args.name || '访客', preferredMode: args.mode || 'normal' } });
          break;
        case 'set_phase':
          if (args.phase) updateMemory({ projectPhase: args.phase });
          break;
        case 'add_topic':
          if (args.topic) addTopic(args.topic);
          break;
        case 'set_summary':
          if (args.summary) updateMemory({ projectSummary: args.summary });
          break;
        case 'read':
        default:
          break;
      }
      return { success: true, data: getFullContext() };
    },
  },

  // ============================================================
  // 里程碑 3 新增工具
  // ============================================================

  neca2_blackboard: {
    description: 'Read the shared neca+neca2 blackboard. Shows both server status, session stats, and recent messages.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const bb = readBlackboard();
      if (!bb) {
        return { success: true, data: { message: 'No blackboard data yet. neca2 will write on next tool call.', necaAlive: false } };
      }
      return {
        success: true,
        data: {
          ...bb,
          necaAlive: isNecaAlive(),
          necaSummary: getNecaSummary(),
          summary: getBlackboardSummary(),
        },
      };
    },
  },

  neca2_bridge_status: {
    description: 'Check the neca bridge status — whether neca (left hand) is alive and available for delegation.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      return {
        success: true,
        data: getBridgeStats(),
      };
    },
  },
};
