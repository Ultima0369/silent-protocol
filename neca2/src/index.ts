#!/usr/bin/env node
// ---- neca2 MCP Server ----
// Silent Protocol 紧凑协议参考实现

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
      // 每次工具调用后自动保存记忆
      saveMemory();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
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
  const timer = setTimeout(() => { removePid(); process.exit(1); }, 5000);
  stopHttpServer();
  shutdownSessionManager();
  saveMemory();  // ← 关闭前保存记忆
  clearTimeout(timer);
  removePid();
  process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => console.error(chalk.red('[neca2] error:'), err.message));
process.on('unhandledRejection', (reason) => console.error(chalk.red('[neca2] rejection:'), reason));

async function main(): Promise<void> {
  writePid();

  // 加载记忆（自动恢复跨 session 上下文）
  const mem = initMemory();
  console.error(chalk.green(`[neca2] memory: ${mem.projectName} | user: ${mem.userIdentity.name} | session #${mem.sessionCount}`));

  const recovered = initSessionManager();
  if (recovered > 0) console.error(chalk.gray(`[neca2] recovered ${recovered} sessions from disk`));
  if (relayManager.available) {
    console.error(chalk.green(`[neca2] relay: ${relayManager.availableProviders.join(', ')} (default: ${relayManager.default})`));
  } else {
    console.error(chalk.yellow('[neca2] no relay providers configured'));
  }

  // 告知路由层实际工具数
  setToolCount(Object.keys(tools).length);

  // 启动 HTTP 传输层（非阻塞）
  startHttpServer().catch((err) => console.error(chalk.yellow('[neca2] HTTP server failed to start:'), err.message));

  await server.connect(new StdioServerTransport());
  console.error(chalk.green('[neca2] ready (stdio)'));
  console.error(chalk.gray(`tools: ${Object.keys(tools).length} | pid: ${process.pid}`));

  // 打印记忆摘要便于运维
  console.error(chalk.cyan(`[neca2] context: ${mem.projectName} @ ${mem.projectPhase} | user: ${mem.userIdentity.name}`));
}

main().catch((err) => {
  console.error(chalk.red('[neca2] startup failed:'), err);
  removePid();
  process.exit(1);
});
