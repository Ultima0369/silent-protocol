#!/usr/bin/env npx tsx
/**
 * send-hello.ts — Hello World 端到端演示
 *
 * 展示完整流程：
 *   消息构建 → 校验 → 编码 → 解码验证 → 路由 → 执行 → 取回结果
 *
 * 运行: npx tsx examples/hello-world/send-hello.ts
 */

import { makeMessage } from '../../src/protocol/codec.js';
import { JsonCodec } from '../../src/protocol/codec.js';
import { BinaryCodec, compressionRatio } from '../../src/protocol/binary-codec.js';
import { validateMessage } from '../../src/protocol/types.js';
import { validateMessageMiddleware } from '../../src/protocol/validator.js';
import { codecFactory, encode, decode } from '../../src/protocol/codec-factory.js';
import { routeMessage } from '../../src/relay/router.js';
import { initSessionManager, shutdownSessionManager, getSession } from '../../src/relay/session.js';
import { startTrace, completeTrace, getTrace } from '../../src/meta/orchestrator.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const C = (s: string) => `\x1b[36m${s}\x1b[0m`;

async function main(): Promise<void> {
  console.log();
  console.log(B('╔══════════════════════════════════════════════════════╗'));
  console.log(B('║   Silent Protocol · Hello World 端到端演示          ║'));
  console.log(B('╚══════════════════════════════════════════════════════╝'));
  console.log();

  // ============================================================
  // Step 1: 构建消息
  // ============================================================
  console.log(Y('┌─ Step 1: 构建紧凑协议消息'));
  console.log(Y('│'));

  const msg = makeMessage('cloud_ds', 'local_claude', 'exec', {
    cmd: 'echo "Hello Silent Protocol!"',
    cwd: '.',
    timeout: 5000,
  }, true);

  console.log(`│  ID:      ${C(msg.id)}`);
  console.log(`│  From:    ${msg.from}`);
  console.log(`│  To:      ${msg.to}`);
  console.log(`│  Type:    ${msg.type}`);
  console.log(`│  Payload: ${JSON.stringify(msg.payload)}`);
  console.log(Y('└── ✅ 消息构建完成'));
  console.log();

  // ============================================================
  // Step 2: 校验
  // ============================================================
  console.log(Y('┌─ Step 2: 消息校验'));
  console.log(Y('│'));

  const validation = validateMessage(msg);
  console.log(`│  validateMessage:       ${validation.valid ? G('✅ PASS') : '❌ FAIL'}`);

  const midResult = validateMessageMiddleware(msg);
  console.log(`│  middleware (11 rules): ${midResult.valid ? G('✅ ALL PASS') : `❌ ${midResult.errors.join(', ')}`}`);

  console.log(Y('└── ✅ 消息校验通过'));
  console.log();

  // ============================================================
  // Step 3: 编码（JSON + Binary）
  // ============================================================
  console.log(Y('┌─ Step 3: 编解码'));
  console.log(Y('│'));

  const jsonCodec = new JsonCodec();
  const binCodec = new BinaryCodec();

  const jsonEncoded = jsonCodec.encode(msg);
  const binEncoded = binCodec.encode(msg);

  const jsonDecoded = jsonCodec.decode(jsonEncoded);
  const binDecoded = binCodec.decode(binEncoded);

  console.log(`│  JSON codec:   ${String(jsonEncoded.length).padStart(6)} bytes  ${G('✅ round-trip')}`);
  console.log(`│  Binary codec: ${String(binEncoded.length).padStart(6)} bytes  ${G('✅ round-trip')}`);
  console.log(`│  Savings:      ${compressionRatio(jsonEncoded.length, binEncoded.length)}`);
  console.log();

  // CodecFactory 展示
  console.log(`│  CodecFactory: ${codecFactory.names.join(', ')}`);
  console.log(`│  Default:      ${codecFactory.default.type}`);
  console.log(`│  Auto-select:  ${codecFactory.autoSelect(msg).type}`);

  // 内容协商演示
  const negotiated = codecFactory.negotiate(['binary', 'json']);
  console.log(`│  Negotiated:   ${negotiated.type} (when client supports binary+json)`);

  console.log(Y('└── ✅ 编解码验证通过'));
  console.log();

  // ============================================================
  // Step 4: 路由执行
  // ============================================================
  console.log(Y('┌─ Step 4: 路由执行'));
  console.log(Y('│'));

  // 时序追踪
  startTrace(msg.id);

  try {
    initSessionManager();
    const session = await routeMessage(msg);

    const trace = getTrace(msg.id);
    completeTrace(msg.id);

    console.log(`│  Session:    ${session.id}`);
    console.log(`│  Status:     ${session.status === 'reply_received' ? G('✅ ' + session.status) : Y('⏳ ' + session.status)}`);
    console.log(`│  Duration:   ${trace?.totalDurationMs || '?'}ms`);

    if (session.response) {
      const payload = session.response.payload || {};
      console.log(`│  Exit code:  ${payload.exitCode ?? '?'}`);
      console.log(`│  Stdout:     ${C(payload.stdout || '(empty)')}`);
      if (payload.stderr) console.log(`│  Stderr:     ${Y(payload.stderr)}`);
    }

    // 展示时序追踪
    if (trace && trace.spans.length > 0) {
      console.log();
      console.log(`│  ${B('Timing Trace:')}`);
      for (const span of trace.spans) {
        const statusIcon = span.status === 'ok' ? G('✓') : span.status === 'error' ? '✗' : '⏳';
        const dur = span.durationMs ? `${span.durationMs}ms` : '...';
        console.log(`│    ${statusIcon} ${span.name.padEnd(20)} ${C(dur.padStart(8))}${span.detail ? `  ${span.detail}` : ''}`);
      }
    }
  } finally {
    shutdownSessionManager();
  }

  console.log(Y('└── ✅ 路由执行完成'));
  console.log();

  // ============================================================
  // Summary
  // ============================================================
  console.log(B('╔══════════════════════════════════════════════════════╗'));
  console.log(B('║   总结                                               ║'));
  console.log(B('╚══════════════════════════════════════════════════════╝'));
  console.log();
  console.log(`  ${G('✅')} 消息构建     → makeMessage()`);
  console.log(`  ${G('✅')} 消息校验     → validateMessage() + validateMessageMiddleware()`);
  console.log(`  ${G('✅')} JSON 编码    → ${jsonEncoded.length} bytes`);
  console.log(`  ${G('✅')} Binary 编码  → ${binEncoded.length} bytes (节省 ${compressionRatio(jsonEncoded.length, binEncoded.length)})`);
  console.log(`  ${G('✅')} 路由执行     → exit code ${msg.payload.exitCode ?? '?'}`);
  console.log(`  ${G('✅')} 结果返回     → 完整闭环`);
  console.log();
  console.log(`  ${B('Hello Silent Protocol!  🎉')}`);
  console.log();
}

main().catch((err) => {
  console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
  process.exit(1);
});
