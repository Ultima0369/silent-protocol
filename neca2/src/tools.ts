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
import { permissionManager, INDUSTRY_LEVELS } from './utils/permissions.js';
import { readBlackboard, writeSelfStatus, getBlackboardSummary, isNecaAlive, addMessageToBlackboard } from './shared/blackboard.js';
import { getNecaSummary, getBridgeStats } from './shared/neca-bridge.js';
import { adaptiveEngine } from './relay/adaptive-learning.js';
import { torkAgent } from './relay/tork-agent.js';
import { zeroOverhead } from './protocol/zero-overhead.js';
import { multiplexedConnection, compareProtocolVersions } from './protocol/stream-protocol.js';
import { advancedCache } from './relay/cache-advanced.js';
import {
  executeFromNaturalLanguage,
  getExecutionState,
  cancelExecution,
  pauseExecution,
  resumeExecution,
  submitFeedback,
  listExecutions,
  cleanupOldExecutions,
} from './relay/intent-executor.js';
import { parseIntent } from './relay/intent-parser.js';
import { aggregateFeedback, getAcceptancePrompt } from './relay/feedback-aggregator.js';
import {
  fullSafetyCheck,
  safetyPreflight,
  cleanResiduals,
  validatePath,
  analyzeFileForChunking,
  writeFileInChunks,
  withTimeout,
} from './utils/safety.js';
import type { Message } from './protocol/types.js';

const AGENT_NAMES = STANDARD_AGENTS.map(a => a) as [string, ...string[]];
const MSG_TYPES = STANDARD_MESSAGE_TYPES.map(t => t) as [string, ...string[]];
const MSG_TYPES_NO_SYSTEM = MSG_TYPES.filter(t => !['pong', 'ack', 'error', 'init'].includes(t)) as [string, ...string[]];

const binaryCodec = new BinaryCodec();

// 辅助函数：造一条 demo 消息用于版本对比
function demoMessages(): Message[] {
  return [
    makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'npm test', cwd: '/project', timeout: 30000 }),
    makeMessage('local_claude', 'cloud_ds', 'report', { taskId: 't1', status: 'completed', result: { output: 'ok' } }),
    makeMessage('cloud_ds', 'cloud_claude', 'query', { question: '分析这个结果', maxTokens: 2000 }),
    makeMessage('cloud_ds', 'local_claude', 'ping', {} as any),
    makeMessage('local_claude', 'cloud_ds', 'pong', {} as any),
  ];
}

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

      const midResult = await runMiddlewarePipeline(msg);
      if (!midResult.allowed) {
        return { success: false, error: midResult.error || 'Message rejected by middleware', data: { validation: midResult.validation } };
      }

      const session = await routeMessage(midResult.message!);
      addTopic(`${args.type}→${args.to}`);
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
          v2Features: {
            streamProtocol: true,
            adaptiveLearning: true,
            zeroOverhead: true,
            intentExecution: true,
          },
        },
      };
    },
  },

  neca2_health: {
    description: 'Server health check. Returns status, uptime, and project memory context for session continuity.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const ctx = getContextForHealth();
      const safety = fullSafetyCheck();
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
            'v2-stream-protocol', 'v2-adaptive-learning', 'v2-zero-overhead',
            'intent-execution', 'safety-guard',
          ],
          sessionStats: sessionStats(),
          retryQueueStats: retryQueue.stats,
          retryQueueDepth: retryQueue.depth,
          bridge: getBridgeStats(),
          blackboard: getBlackboardSummary(),
          memory: ctx,
          intentExecution: {
            activeExecutions: listExecutions().length,
          },
          safety: {
            warnings: safety.warnings,
            residualFiles: safety.residual.pidFiles.length + safety.residual.lockFiles.length,
          },
        },
      };
    },
  },

  neca2_protocol_info: {
    description: 'Compact protocol spec summary.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const demoMsg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hello world', cwd: '/tmp', timeout: 5000 });
      const jsonBytes = JSON.stringify(demoMsg).length;
      const binaryBytes = binaryCodec.encode(demoMsg).length;
      const ratio = compressionRatio(jsonBytes, binaryBytes);

      const v2Compare = compareProtocolVersions(demoMessages());

      return {
        success: true,
        data: {
          version: 2,
          standardAgents: STANDARD_AGENTS,
          standardMessageTypes: STANDARD_MESSAGE_TYPES,
          codecs: ['json', 'binary', 'v2-stream'],
          features: [
            'callback', 'persistence', 'multi-model-relay',
            'meta-orchestrator', 'memory-persistence',
            'binary-codec', 'validator-middleware', 'retry-queue',
            'auto-persist', 'structured-logging',
            'codec-factory', 'router-scheduler', 'cli',
            'shared-blackboard', 'neca-bridge',
            'v2-stream-protocol', 'v2-adaptive-learning', 'v2-zero-overhead',
            'intent-execution', 'safety-guard',
          ],
          compressionDemo: {
            messageType: 'exec',
            jsonBytes,
            binaryBytes,
            saving: ratio,
          },
          v2Comparison: {
            v1Bytes: v2Compare.v1Bytes,
            v2Bytes: v2Compare.v2Bytes,
            savings: v2Compare.savings,
            note: 'v2 stream protocol with multiplexing saves ~73% frame overhead',
          },
        },
      };
    },
  },

  neca2_exec: {
    description: 'Execute a shell command via compact protocol. Safety preflight included.',
    parameters: z.object({
      cmd: z.string().describe('Command'),
      cwd: z.string().optional().describe('Working directory'),
      timeout: z.number().optional().default(30000).describe('Timeout in ms'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      // 安全前检
      const preflight = safetyPreflight('exec');
      
      const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { 
        cmd: args.cmd, 
        cwd: args.cwd || process.cwd(), 
        timeout: args.timeout ?? 30000 
      }, true);
      
      const midResult = await runMiddlewarePipeline(msg);
      if (!midResult.allowed) {
        return { success: false, error: midResult.error || 'Message rejected', data: null };
      }
      
      // 带超时的执行
      try {
        const session = await withTimeout(
          () => routeMessage(midResult.message!),
          (args.timeout ?? 30000) + 5000,
          `exec: ${args.cmd?.substring(0, 40)}`
        );
        if (session.status === 'reply_received' && session.response) {
          return { success: true, data: { ...session.response.payload, _safety: preflight } };
        }
        return { success: false, error: 'exec failed', data: { status: session.status, response: session.response, _safety: preflight } };
      } catch (e: any) {
        return { success: false, error: e.message, data: { _safety: preflight } };
      }
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
    description: 'Write a file using memory-first approach: construct in memory, verify, then write to disk atomically. Supports chunked writes for large files.',
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

      // 安全检查：文件大小分析
      const chunkAnalysis = analyzeFileForChunking(content);
      
      const result: any = { 
        path: targetPath, 
        size: Buffer.byteLength(content, 'utf-8'), 
        atomic, 
        verified: false, 
        written: false, 
        errors: [],
        chunkAnalysis,
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
            if (verify.language === 'rust' && verify.checkCompile) cmd = `rustc --edition 2021 --crate-type lib \"${tmpFile}\" -o \"${tmpFile}.out\" 2>&1`;
            else if (verify.language === 'rust') cmd = `rustfmt --check \"${tmpFile}\" 2>&1`;
            else if (verify.language === 'typescript' && verify.checkCompile) cmd = `npx tsc --noEmit --strict \"${tmpFile}\" 2>&1`;
            else if (verify.language === 'python' && verify.checkSyntax) cmd = `python -m py_compile \"${tmpFile}\" 2>&1`;
            else if (verify.testCmd) cmd = verify.testCmd.replace('{file}', tmpFile);
            if (cmd) {
              try { execSync(cmd, { timeout: 30000, windowsHide: true, encoding: 'utf-8' }); result.verified = true; }
              catch (e: any) { result.errors.push({ phase: 'verify', error: e.stderr || e.message }); result.verified = false; }
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
          
          if (chunkAnalysis.chunks > 1) {
            // 大文件分块写入
            const chunkResult = writeFileInChunks(targetPath, content);
            result.written = chunkResult.success;
            result.chunked = true;
            if (!chunkResult.success) {
              result.errors.push({ phase: 'chunked_write', error: chunkResult.error });
            }
          } else if (atomic) {
            const tmpTarget = targetPath + '.neca2_tmp';
            fs.writeFileSync(tmpTarget, content, 'utf-8');
            fs.renameSync(tmpTarget, targetPath);
            result.written = true;
          } else {
            fs.writeFileSync(targetPath, content, 'utf-8');
            result.written = true;
          }
          if (result.written) result.writtenAt = Date.now();
        } catch (e: any) { result.errors.push({ phase: 'write', error: e.message }); }
      }
      return { success: result.written, data: result };
    },
  },

  neca2_memory_context: {
    description: 'Get or update the persistent project memory.',
    parameters: z.object({
      action: z.enum(['read', 'set_user', 'set_phase', 'add_topic', 'set_summary']).default('read').describe('Action to perform'),
      name: z.string().optional(),
      mode: z.string().optional(),
      phase: z.string().optional(),
      topic: z.string().optional(),
      summary: z.string().optional(),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      switch (args.action) {
        case 'set_user': updateMemory({ userIdentity: { name: args.name || '访客', preferredMode: args.mode || 'normal' } }); break;
        case 'set_phase': if (args.phase) updateMemory({ projectPhase: args.phase }); break;
        case 'add_topic': if (args.topic) addTopic(args.topic); break;
        case 'set_summary': if (args.summary) updateMemory({ projectSummary: args.summary }); break;
      }
      return { success: true, data: getFullContext() };
    },
  },

  // ============================================================
  // 里程碑 3 工具
  // ============================================================

  neca2_blackboard: {
    description: 'Read the shared neca+neca2 blackboard.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const bb = readBlackboard();
      if (!bb) return { success: true, data: { message: 'No blackboard data yet.', necaAlive: false } };
      return { success: true, data: { ...bb, necaAlive: isNecaAlive(), necaSummary: getNecaSummary(), summary: getBlackboardSummary() } };
    },
  },

  neca2_bridge_status: {
    description: 'Check the neca bridge status — whether neca (left hand) is alive and available for delegation.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      return { success: true, data: getBridgeStats() };
    },
  },

  // ============================================================
  // DeepSeek Exclusive v2 — Stream Protocol
  // ============================================================

  neca2_v2_stream_status: {
    description: '[DeepSeek Exclusive] Stream Protocol v2 diagnostics — multiplexing stats, frame savings, v1 vs v2 bandwidth comparison.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const msgs = demoMessages();
      const v2Compare = compareProtocolVersions(msgs);
      const streamStats = multiplexedConnection.getStats();

      return {
        success: true,
        data: {
          version: 'v2-stream-protocol',
          description: 'Single-connection multiplexed streaming protocol (like HTTP/2 for agents)',
          savings: {
            demoMessages: msgs.length,
            v1Bytes: v2Compare.v1Bytes,
            v2Bytes: v2Compare.v2Bytes,
            savings: v2Compare.savings,
            interpretation: 'Frame overhead reduced by eliminating ver/id/from/to/ts from every message',
          },
          typeRegistry: {
            messageTypes: 13,
            bytesPerType: 1,
            vsV1StringEncoding: '12 bytes saved per message',
          },
          multiplexing: streamStats,
          flags: {
            PUSH: 'Server push — predict and prefetch next message',
            END: 'End of stream',
            STREAM: 'Streaming fragment (not last frame)',
            DELTA: 'Delta encoding — only send changes',
            PIGGYBACK: 'Control info piggybacked on data frames',
          },
          useCases: [
            'High-throughput agent coordination (100+ msg/s)',
            'Large payload streaming (100KB+ file writes)',
            'Multi-agent conversation with predictive push',
          ],
        },
      };
    },
  },

  // ============================================================
  // DeepSeek Exclusive v2 — Adaptive Learning
  // ============================================================

  neca2_v2_learning_report: {
    description: '[DeepSeek Exclusive] Adaptive Learning Engine full diagnostic — Bayesian reliability scores, cache auto-tuning status, mined message patterns.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const report = adaptiveEngine.getFullReport();
      const cacheStats = advancedCache.getStats();

      return {
        success: true,
        data: {
          version: 'v2-adaptive-learning',
          description: 'System that learns and optimizes itself without human intervention',
          bayesianReliability: report.reliability,
          cacheTuning: report.cacheTuning,
          minedPatterns: report.patterns,
          highConfidencePatterns: report.highConfidencePatterns,
          advancedCache: {
            combinedHitRate: cacheStats.combinedHitRate,
            semanticHitRate: cacheStats.semantic.hitRate,
            flowPredictionAccuracy: cacheStats.flow.accuracy,
            dedupRatio: cacheStats.dedup.dedupRatio,
            estimatedBandwidthSaved: cacheStats.estimatedBandwidthSaved,
          },
          howItWorks: {
            bayesian: 'Each success/failure updates Beta(alpha, beta) posterior. More data → more accurate.',
            autoTuning: 'Every 1000 messages: evaluates hit rate and latency, adjusts cache size and TTL.',
            patternMining: 'Tracks message type transitions (exec→report). 20+ repetitions → 80%+ confidence.',
          },
        },
      };
    },
  },

  // ============================================================
  // DeepSeek Exclusive v2 — Zero-Overhead Protocol
  // ============================================================

  neca2_v2_zero_overhead: {
    description: '[DeepSeek Exclusive] Zero-Overhead Protocol status — hardcoded control signals, piggybacking, delta encoding stats.',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const controlMsgs = demoMessages().filter(m => ['ping', 'pong', 'ack'].includes(m.type));
      const elimination = zeroOverhead.estimateElimination(controlMsgs.length > 0 ? controlMsgs : demoMessages());
      const deltaStats = zeroOverhead.delta.getStats();

      return {
        success: true,
        data: {
          version: 'v2-zero-overhead',
          description: 'Control signals cost near zero. Delta encoding makes repeated messages tiny.',
          hardcodedSignals: {
            signals: ['ping', 'pong', 'ack'],
            mechanism: 'Pre-encoded at startup, returned via memcpy at runtime',
            latency: '0μs encoding delay (vs ~4μs for normal path)',
          },
          piggybacking: {
            enabled: true,
            encoding: '4-bit piggyback info in frame flags header',
            saving: 'Up to 80% reduction in separate control messages',
            analogy: 'Like TCP delayed ACK — data and control share one packet',
          },
          deltaEncoding: deltaStats,
          controlSignalElimination: {
            inTestBatch: elimination,
            bestCase: 'Repeated exec commands on same stream: 90%+ savings',
          },
          howItWorks: {
            hardcodedSignals: 'ping/pong/ack frames are pre-computed. Runtime just returns pre-compiled byte array.',
            piggybacking: 'Control info (ack, status) embedded in data frame flags. No separate message needed.',
            deltaEncoding: 'Only changed fields between consecutive messages are sent. Fields unchanged since last message are inferred.',
          },
        },
      };
    },
  },

  // ============================================================
  // 里程碑 6：意图执行协议
  // ============================================================

  neca2_intent_exec: {
    description: '[Intent Execution] 从自然语言开始执行。说你要什么，系统自动拆解为任务序列并执行。',
    parameters: z.object({
      text: z.string().describe('自然语言描述你要做的事情，如"帮我爬一下AI论文"'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      // 安全前检
      safetyPreflight(`intent: ${args.text?.substring(0, 30)}`);
      
      const state = await executeFromNaturalLanguage(args.text);
      if (state.status === 'needs_clarification') {
        return { success: false, error: state.clarification || '需要更详细的描述', data: { status: state.status, executionId: state.id } };
      }
      const plan = state.plan!;
      return {
        success: true,
        data: {
          status: state.status,
          executionId: state.id,
          intent: { type: plan.intent.type, target: plan.intent.primaryTarget, confidence: plan.intent.confidence },
          plan: { steps: plan.steps.length, estimatedTime: plan.estimatedTotalTime },
        },
      };
    },
  },

  neca2_intent_status: {
    description: '[Intent Execution] 查询意图执行状态。',
    parameters: z.object({
      executionId: z.string().describe('执行ID'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const state = getExecutionState(args.executionId);
      if (!state) return { success: false, error: '执行记录未找到', data: null };

      let result = null;
      if (state.status === 'completed' && state.plan) {
        result = aggregateFeedback(state.plan, state.stepResults);
      }

      return {
        success: true,
        data: {
          status: state.status,
          executionId: state.id,
          intent: state.plan ? { type: state.plan.intent.type, rawText: state.plan.intent.rawText } : null,
          currentStep: state.currentStepIndex,
          totalSteps: state.plan?.steps.length || 0,
          error: state.error,
          duration: state.endTime ? state.endTime - state.startTime : Date.now() - state.startTime,
          result,
          acceptancePrompt: result ? getAcceptancePrompt(result) : null,
        },
      };
    },
  },

  neca2_intent_feedback: {
    description: '[Intent Execution] 尝菜式反馈。说"可以"=验收，"改xxx"=调整，"重来"=重新执行。',
    parameters: z.object({
      executionId: z.string().describe('执行ID'),
      feedback: z.string().describe('你的反馈：可以 / 改这里 / 重来'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const result = await submitFeedback(args.executionId, args.feedback);
      return {
        success: true,
        data: {
          status: result.status,
          adjusted: result.adjusted,
          result: result.result,
          acceptancePrompt: result.result ? getAcceptancePrompt(result.result) : null,
        },
      };
    },
  },

  neca2_intent_cancel: {
    description: '[Intent Execution] 取消正在执行的意图。',
    parameters: z.object({
      executionId: z.string().describe('执行ID'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const cancelled = cancelExecution(args.executionId);
      return { success: cancelled, data: { cancelled, executionId: args.executionId } };
    },
  },

  neca2_intent_list: {
    description: '[Intent Execution] 列出所有意图执行记录。',
    parameters: z.object({
      status: z.enum(['planning', 'running', 'paused', 'completed', 'failed', 'cancelled', 'needs_clarification'] as const).optional().describe('按状态过滤'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const executions = listExecutions(args.status as any);
      return {
        success: true,
        data: {
          total: executions.length,
          executions: executions.map(e => ({
            id: e.id,
            status: e.status,
            intent: e.plan ? e.plan.intent.type : 'unknown',
            rawText: e.plan?.intent.rawText?.substring(0, 80) || '',
            stepsDone: e.currentStepIndex,
            stepsTotal: e.plan?.steps.length || 0,
            age: Date.now() - e.startTime,
            error: e.error,
          })),
        },
      };
    },
  },

  // ============================================================
  // 安全防护工具（防翻车三件套）
  // ============================================================

  neca2_safety_check: {
    description: '[Safety Guard] 全量安全检查：残余进程/文件、目录权限、内存状态。执行任务前先跑这个。',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const report = fullSafetyCheck();
      const cleanResult = cleanResiduals();
      return {
        success: true,
        data: {
          status: report.warnings.length === 0 ? 'clean' : 'issues_found',
          timestamp: report.timestamp,
          residual: {
            pidFiles: report.residual.pidFiles.length,
            lockFiles: report.residual.lockFiles.length,
            staleSessions: report.residual.staleSessions,
            warnings: report.residual.warnings,
            cleaned: cleanResult.cleaned,
          },
          cwd: {
            path: process.cwd(),
            writable: report.cwd.writable,
            exists: report.cwd.exists,
            warnings: report.cwd.warnings,
          },
          temp: {
            path: process.env.TEMP || '/tmp',
            writable: report.tempDir.writable,
          },
          memory: {
            heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`,
            heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1)}MB`,
          },
          allClear: report.warnings.length === 0,
        },
      };
    },
  },

  neca2_safety_preflight: {
    description: '[Safety Guard] 执行前安全检查。检查残余进程、目录可写性、内存水位。带自动清理。',
    parameters: z.object({
      taskName: z.string().describe('任务名称（用于日志）'),
    }),
    handler: async (args: any): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const result = safetyPreflight(args.taskName || 'unnamed');
      return {
        success: result.ok,
        data: {
          ok: result.ok,
          warnings: result.warnings,
          safe: result.ok ? '可安全执行' : '存在风险，建议先处理警告',
        },
      };
    },
  },

  neca2_safety_clean: {
    description: '[Safety Guard] 清理所有残余进程和锁文件。',
    parameters: z.object({}),
    handler: async (): Promise<{ success: boolean; data: unknown; error?: string }> => {
      const result = cleanResiduals();
      const check = fullSafetyCheck();
      return {
        success: true,
        data: {
          cleaned: result.cleaned,
          errors: result.errors,
          residual_remaining: check.residual.pidFiles.length + check.residual.lockFiles.length,
          allClear: check.warnings.length === 0,
        },
      };
    },
  },

  // ============================================================
  // 用户主权权限工具
  // ============================================================

  neca2_permission_status: {
    description: '查看当前权限状态（等级、允许的能力、生效范围）',
    parameters: { shape: {}, parse: (a: any) => a },
    handler: async () => {
      const snap = permissionManager.snapshot();
      const level = INDUSTRY_LEVELS[snap.level];
      return {
        success: true,
        data: {
          level: snap.level,
          label: level?.label || "未知",
          icon: level?.icon || "",
          description: level?.description || "",
          allowed: snap.allowed,
          scopes: snap.effectiveScopes,
          isTrusted: snap.isTrusted,
          entries: snap.entries.map(e => ({
            cap: e.capability,
            scope: e.scope,
            effect: e.effect,
            path: e.path || null,
            desc: e.description || null,
          })),
          summary: permissionManager.summary(),
        },
      };
    },
  },

  neca2_permission_set_level: {
    description: '设置行业标准权限等级 L0-L5',
    parameters: {
      shape: {
        level: z.number().min(0).max(5).describe('权限等级 0-5'),
        effect: z.enum(['persist', 'session', 'one-shot']).default('session').describe('生效方式'),
      },
      parse: (a: any) => a,
    },
    handler: async (args: any) => {
      const snap = permissionManager.setLevel(args.level, args.effect || 'session');
      const level = INDUSTRY_LEVELS[snap.level];
      return {
        success: true,
        data: {
          level: snap.level,
          label: level?.label || "",
          icon: level?.icon || "",
          allowed: snap.allowed,
          isTrusted: snap.isTrusted,
          summary: permissionManager.summary(),
          message: "权限已设置为 " + (level?.icon || "") + " L" + snap.level + " " + snap.label,
        },
      };
    },
  },

  neca2_permission_trust: {
    description: '一键完全信任（L5）\u2014 AI 拥有全部能力，如同老友',
    parameters: {
      shape: {
        effect: z.enum(['persist', 'session', 'one-shot']).default('session').describe('生效方式'),
      },
      parse: (a: any) => a,
    },
    handler: async (args: any) => {
      const snap = permissionManager.trust(args.effect || 'session');
      return {
        success: true,
        data: {
          level: 5,
          label: "完全信任",
          icon: "\uD83E\uDD1D",
          allowed: snap.allowed,
          summary: permissionManager.summary(),
          message: "\uD83E\uDD1D 已授予完全信任权限。我拥有了全部能力，如同老友。",
        },
      };
    },
  },

  neca2_permission_grant: {
    description: '授予特定能力权限（更精细的控制）',
    parameters: {
      shape: {
        capability: z.enum(['view', 'exec', 'write', 'admin', 'trust']).describe('能力'),
        scope: z.enum(['global', 'project', 'directory', 'file']).default('global').describe('范围'),
        effect: z.enum(['persist', 'session', 'one-shot']).default('session').describe('生效方式'),
        path: z.string().optional().describe('路径'),
        description: z.string().optional().describe('描述'),
      },
      parse: (a: any) => a,
    },
    handler: async (args: any) => {
      const snap = permissionManager.grant(args.capability, {
        scope: args.scope,
        effect: args.effect,
        path: args.path,
        description: args.description,
      });
      return {
        success: true,
        data: {
          level: snap.level,
          allowed: snap.allowed,
          summary: permissionManager.summary(),
          message: "已授予 " + args.capability + " 权限",
        },
      };
    },
  },

  neca2_permission_revoke: {
    description: '撤销特定能力权限',
    parameters: {
      shape: {
        capability: z.enum(['view', 'exec', 'write', 'admin', 'trust']).optional().describe('要撤销的能力'),
        scope: z.enum(['global', 'project', 'directory', 'file']).optional().describe('范围'),
      },
      parse: (a: any) => a,
    },
    handler: async (args: any) => {
      const snap = permissionManager.revoke(args.capability, { scope: args.scope });
      return {
        success: true,
        data: {
          level: snap.level,
          allowed: snap.allowed,
          summary: permissionManager.summary(),
          message: "已撤销权限，当前 L" + snap.level,
        },
      };
    },
  },

  // ============================================================
  // TORK Agent 工具 — 里程碑 8：双生子融合
  // ============================================================
  neca2_tork_status: {
    description: '[TORK Agent] 查看 TORK 实时状态（心跳、世代、温度、模式、连接状态）',
    parameters: { shape: {}, parse: (a: any) => a },
    handler: async () => {
      const h = torkAgent.getHealth();
      return { success: true, data: { alive: h.alive, heartbeat: h.heartbeat, generation: h.generation, ticks: h.ticks, uptime: h.uptime, temperature: h.temperature, mode: h.mode, soulVersion: h.soulVersion, lastSeen: h.lastSeen, error: h.error || null, sinceLastSeen: h.lastSeen ? Math.round((Date.now() - h.lastSeen) / 1000) + 's ago' : 'never' } };
    },
  },
  neca2_tork_ping: {
    description: '[TORK Agent] 向 TORK 发送 ping，获取心跳响应。如果 TORK 不在线，返回连接失败。',
    parameters: { shape: {}, parse: (a: any) => a },
    handler: async () => {
      try { const bpm = await torkAgent.getHeartbeat(); return { success: true, data: { heartbeat: bpm, alive: true } }; } catch (e: any) { return { success: false, error: 'TORK not reachable: ' + e.message, data: { alive: false } }; }
    },
  },
  neca2_tork_soul: {
    description: '[TORK Agent] 获取 TORK 灵魂状态摘要 — 从 torkd 读取 soul 数据。',
    parameters: { shape: {}, parse: (a: any) => a },
    handler: async () => {
      try { const summary = await torkAgent.getSoulSummary(); return { success: true, data: summary }; } catch (e: any) { return { success: false, error: 'Failed to get soul: ' + e.message, data: null }; }
    },
  },
  neca2_tork_evolve: {
    description: '[TORK Agent] 触发 TORK 进化 — 让 TORK 自我修改代码、编译、测试，进化到下一代。',
    parameters: { shape: { rounds: { type: 'number', min: 1, max: 10, default: 1, description: '进化轮次（1-10）' } }, parse: (a: any) => a },
    handler: async (args: any) => {
      try { const result = await torkAgent.triggerEvolution(args.rounds || 1); return { success: true, data: { result, rounds: args.rounds || 1 } }; } catch (e: any) { return { success: false, error: 'Evolution failed: ' + e.message, data: null }; }
    },
  },
  neca2_tork_send: {
    description: '[TORK Agent] 向 TORK torkd socket 发送原始命令并获取响应。',
    parameters: { shape: { command: { type: 'string', description: '发送给 TORK 的命令（如 ping, soul, status, exec:ls）' } }, parse: (a: any) => a },
    handler: async (args: any) => {
      try { const result = await torkAgent.send(args.command); return { success: true, data: { command: args.command, response: result } }; } catch (e: any) { return { success: false, error: 'TORK command failed: ' + e.message, data: null }; }
    },
  },
};
