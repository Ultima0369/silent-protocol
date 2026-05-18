#!/usr/bin/env node
// ---- neca2 MCP Server ----
// Silent Protocol 紧凑协议参考实现
//
// v0.4.0 — 里程碑 3：左手右手互优化
// 新增：统一黑板报、neca桥接器、Hello World 端到端示例、混合部署配置

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
import { startBlackboardSync, writeSelfStatus, readBlackboard, getBlackboardSummary } from './shared/blackboard.js';
import { getNecaSummary, getBridgeStats } from './shared/neca-bridge.js';

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

// 注册工具
for (const [name, tool] of Object.entries(tools)) {
  const shape = (tool.parameters as any).shape ?? tool.parameters;
  server.tool(name, tool.description, shape, async (args: any) => {
    try {
      const parsed = tool.parameters.parse(args);
      const result = await tool.handler(parsed);
      // 每次工具调用后自动保存记忆 + 更新黑板报
      saveMemory();
      writeSelfStatus('neca2');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      logger.error('Tool handler error', { tool: name, error: e.message }, { module: 'tools' });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: e.message }) }], isError: true };
    }
  });
}

// 优雅关闭
let isShuttingDown = false;
function gracefulShutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.error(chalk.yellow('[neca2] shutting down...'));
  logger.info('Server shutting down', {}, { module: 'system' });

  const timer = setTimeout(() => { removePid(); process.exit(1); }, 5000);

  // 关闭前最后一次写入黑板报
  writeSelfStatus('neca2', 'degraded');

  // 按依赖顺序关闭
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

  // 初始化结构化日志
  logger.info('Starting neca2 server', {
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  }, { module: 'system' });

  // 加载记忆（自动恢复跨 session 上下文）
  const mem = initMemory();
  console.error(chalk.green(`[neca2] memory: ${mem.projectName} | user: ${mem.userIdentity.name} | session #${mem.sessionCount}`));
  logger.info('Memory loaded', { project: mem.projectName, user: mem.userIdentity.name, sessionCount: mem.sessionCount }, { module: 'memory' });

  // 初始化会话管理器
  const recovered = initSessionManager();
  if (recovered > 0) {
    console.error(chalk.gray(`[neca2] recovered ${recovered} sessions from disk`));
    logger.info('Sessions recovered', { count: recovered }, { module: 'session' });
  }

  // 初始化重试队列
  initRetryQueue();
  console.error(chalk.gray('[neca2] retry queue initialized'));
  logger.info('Retry queue initialized', {}, { module: 'retry' });

  // 初始化统一黑板报
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

  // 检查 relay 状态
  if (relayManager.available) {
    console.error(chalk.green(`[neca2] relay: ${relayManager.availableProviders.join(', ')} (default: ${relayManager.default})`));
    logger.info('Relay providers available', { providers: relayManager.availableProviders, default: relayManager.default }, { module: 'relay' });
  } else {
    console.error(chalk.yellow('[neca2] no relay providers configured'));
    logger.warn('No relay providers configured', {}, { module: 'relay' });
  }

  // 告知路由层实际工具数
  setToolCount(Object.keys(tools).length);

  // 启动 HTTP 传输层（非阻塞）
  startHttpServer().catch((err) => {
    console.error(chalk.yellow('[neca2] HTTP server failed to start:'), err.message);
    logger.error('HTTP server start failed', { error: err.message }, { module: 'http' });
  });

  await server.connect(new StdioServerTransport());
  console.error(chalk.green('[neca2] ready (stdio)'));
  console.error(chalk.gray(`tools: ${Object.keys(tools).length} | pid: ${process.pid}`));
  logger.info('Server ready', { tools: Object.keys(tools).length, pid: process.pid }, { module: 'system' });

  // 打印摘要
  const bridgeInfo = getBridgeStats();
  console.error(chalk.cyan(`[neca2] context: ${mem.projectName} @ ${mem.projectPhase} | user: ${mem.userIdentity.name}`));
  console.error(chalk.gray(`[neca2] bridge: necaAlive=${bridgeInfo.necaAlive} | blackboard: ${getBlackboardSummary().substring(0, 80)}...`));
}

main().catch((err) => {
  console.error(chalk.red('[neca2] startup failed:'), err);
  logger.error('Startup failed', { error: err.message, stack: err.stack?.substring(0, 500) }, { module: 'system' });
  logger.shutdown();
  removePid();
  process.exit(1);
});
