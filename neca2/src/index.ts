#!/usr/bin/env node
// ---- neca2 MCP Server ----
// Silent Protocol 紧凑协议参考实现
//
// v0.8.0 — DeepSeek Exclusive v2 + Intent Execution
// 新增：意图执行协议（Intent Parser / Planner / Executor / Feedback）

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { tools } from './tools.js';
import { setToolCount } from './relay/router.js';
import { initSessionManager, shutdownSessionManager } from './relay/session.js';
import { relayManager } from './relay/http-relay.js';
import { startHttpServer, stopHttpServer } from './transport/http-server.js';
import { initMemory, saveMemory, getMemory } from './memory/memory-manager.js';
import { initRetryQueue, shutdownRetryQueue } from './relay/retry-queue.js';
import { logger } from './utils/logger.js';
import { initPermissions, getPermissionSummary } from './utils/permissions.js';
import { startBlackboardSync, writeSelfStatus, readBlackboard, getBlackboardSummary } from './shared/blackboard.js';
import { getNecaSummary, getBridgeStats } from './shared/neca-bridge.js';
import { adaptiveEngine } from './relay/adaptive-learning.js';
import { zeroOverhead } from './protocol/zero-overhead.js';
import { multiplexedConnection, compareProtocolVersions } from './protocol/stream-protocol.js';
import { advancedCache } from './relay/cache-advanced.js';
import { ambientEngine } from './relay/ambient-channel.js';
import { cleanupOldExecutions } from './relay/intent-executor.js';
import type { Message } from './protocol/types.js';

const PID_FILE = process.platform === 'win32'
  ? (process.env.APPDATA || process.cwd()) + '/neca2.pid'
  : '/tmp/neca2.pid';

function writePid(): void {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}
function removePid(): void { try { fs.unlinkSync(PID_FILE); } catch {} }

const server = new McpServer({ name: 'neca2-mcp-server', version: '1.0.0' });

for (const [name, tool] of Object.entries(tools)) {
  const shape = (tool.parameters as any).shape ?? tool.parameters;
  server.tool(name, tool.description, shape, async (args: any) => {
    try {
      const parsed = tool.parameters.parse(args);
      const result = await tool.handler(parsed);
      saveMemory();
      writeSelfStatus('neca2');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      logger.error('Tool handler error', { tool: name, error: e.message }, { module: 'tools' });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: e.message }) }], isError: true };
    }
  });
}

let isShuttingDown = false;
function gracefulShutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.error(chalk.yellow('[neca2] shutting down...'));
  logger.info('Server shutting down', {}, { module: 'system' });

  const timer = setTimeout(() => { removePid(); process.exit(1); }, 5000);

  writeSelfStatus('neca2', 'degraded');

  shutdownRetryQueue();
  stopHttpServer();
  shutdownSessionManager();
  saveMemory();
  logger.shutdown();

  clearTimeout(timer);
  removePid();
  process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
  console.error(chalk.red('[neca2] error:'), err.message);
  logger.error('Uncaught exception', { error: err.message, stack: err.stack?.substring(0, 500) }, { module: 'system' });
});
process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('[neca2] rejection:'), reason);
  logger.error('Unhandled rejection', { reason: String(reason) }, { module: 'system' });
});

async function main(): Promise<void> {
  writePid();

  logger.info('Starting neca2 server', {
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  }, { module: 'system' });

  const mem = initMemory();
  console.error(chalk.green(`[neca2] memory: ${mem.projectName} | user: ${mem.userIdentity.name} | session #${mem.sessionCount}`));
  logger.info('Memory loaded', { project: mem.projectName, user: mem.userIdentity.name, sessionCount: mem.sessionCount }, { module: 'memory' });

  const recovered = initSessionManager();
  if (recovered > 0) {
    console.error(chalk.gray(`[neca2] recovered ${recovered} sessions from disk`));
    logger.info('Sessions recovered', { count: recovered }, { module: 'session' });
  }

  initRetryQueue();
  console.error(chalk.gray('[neca2] retry queue initialized'));
  logger.info('Retry queue initialized', {}, { module: 'retry' });

  // ---- DeepSeek Exclusive v2 初始化 ----

  // 1. 自适应学习引擎（预热 Bayesian 先验）
  console.error(chalk.gray('[neca2] v2 adaptive learning engine ready'));
  logger.info('v2 Adaptive learning engine initialized', {}, { module: 'v2' });

  // 2. 零开销协议（硬编码控制信号已预计算）
  console.error(chalk.gray(`[neca2] v2 zero-overhead: ${zeroOverhead.signals.pingFrame.length}B pre-coded control signals`));
  logger.info('v2 Zero-overhead protocol ready', { signalSizes: { ping: zeroOverhead.signals.pingFrame.length } }, { module: 'v2' });

  // 3. 高级缓存（预热 12 种常见消息模式）
  const cacheStats = advancedCache.getStats();
  console.error(chalk.gray(`[neca2] v2 advanced cache: ${cacheStats.semantic.patternCount} patterns, ${cacheStats.flow.rules} flow rules`));
  logger.info('v2 Advanced cache ready', { patterns: cacheStats.semantic.patternCount, rules: cacheStats.flow.rules }, { module: 'v2' });

  // 4. 意图执行引擎
  console.error(chalk.gray('[neca2] intent execution engine ready'));
  logger.info('Intent execution engine initialized', {}, { module: 'intent' });

  // 6. 环境通道引擎初始化
  console.error(chalk.gray('[neca2] ambient channel engine ready'));
  logger.info('Ambient channel engine initialized', { stats: ambientEngine.stats() }, { module: 'ambient' });

  // 7. 权限系统初始化
  const permSnap = initPermissions();
  console.error(chalk.gray('[neca2] permissions: ' + getPermissionSummary()));
  logger.info('Permissions initialized', { level: permSnap.level, label: permSnap.label }, { module: 'permissions' });

  // 黑板报初始化
  startBlackboardSync();
  const bb = readBlackboard();
  if (bb?.agents?.neca) {
    const necaInfo = getNecaSummary();
    console.error(chalk.cyan(`[neca2] ${necaInfo}`));
    logger.info('Neca detected via blackboard', { summary: necaInfo }, { module: 'bridge' });
  } else {
    console.error(chalk.yellow('[neca2] neca not detected via blackboard (first start?)'));
    logger.info('Neca not detected on blackboard', {}, { module: 'bridge' });
  }

  if (relayManager.available) {
    console.error(chalk.green(`[neca2] relay: ${relayManager.availableProviders.join(', ')} (default: ${relayManager.default})`));
    logger.info('Relay providers available', { providers: relayManager.availableProviders, default: relayManager.default }, { module: 'relay' });
  } else {
    console.error(chalk.yellow('[neca2] no relay providers configured'));
    logger.warn('No relay providers configured', {}, { module: 'relay' });
  }

  setToolCount(Object.keys(tools).length);

  startHttpServer().catch((err) => {
    console.error(chalk.yellow('[neca2] HTTP server failed to start:'), err.message);
    logger.error('HTTP server start failed', { error: err.message }, { module: 'http' });
  });

  await server.connect(new StdioServerTransport());
  console.error(chalk.green('[neca2] ready (stdio)'));
  console.error(chalk.gray(`tools: ${Object.keys(tools).length} | pid: ${process.pid}`));
  logger.info('Server ready', { tools: Object.keys(tools).length, pid: process.pid }, { module: 'system' });

  const bridgeInfo = getBridgeStats();
  console.error(chalk.cyan(`[neca2] context: ${mem.projectName} @ ${mem.projectPhase} | user: ${mem.userIdentity.name}`));
  console.error(chalk.gray(`[neca2] bridge: necaAlive=${bridgeInfo.necaAlive} | v2: stream+learning+zero+intent+ambient`));
  console.error(chalk.magenta('[neca2] DeepSeek Exclusive v2 features active: stream-protocol | adaptive-learning | zero-overhead | intent-execution | ambient-channel'));

  // 定时清理过期执行记录
  setInterval(() => {
    const cleaned = cleanupOldExecutions(30 * 60 * 1000);
    if (cleaned > 0) logger.info('Cleaned old executions', { count: cleaned }, { module: 'intent' });
  }, 5 * 60 * 1000);
}

main().catch((err) => {
  console.error(chalk.red('[neca2] startup failed:'), err);
  logger.error('Startup failed', { error: err.message, stack: err.stack?.substring(0, 500) }, { module: 'system' });
  logger.shutdown();
  removePid();
  process.exit(1);
});
