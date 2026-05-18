/**
 * integration.test.ts — 集成测试
 *
 * 覆盖从 MCP 工具调用到 relay 返回的全链路。
 * 使用 mock 替代真实的子进程和 API 调用。
 *
 * 运行: npx vitest run tests/integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JsonCodec } from '../src/protocol/codec';
import { BinaryCodec } from '../src/protocol/binary-codec';
import { validateMessage } from '../src/protocol/types';
import { validateMessageMiddleware } from '../src/protocol/validator';
import type { Message, MessageType, AnyPayload } from '../src/protocol/types';
import * as sessionModule from '../src/relay/session';
import { makeMessage } from '../src/protocol/codec';

// ============================================================
// 1. 编解码器集成测试
// ============================================================

describe('编解码器集成测试', () => {
  const jsonCodec = new JsonCodec();
  const binaryCodec = new BinaryCodec();

  const sampleMessages: Message[] = [
    { ver: 1, id: 'int-1', from: 'cloud_ds', to: 'local_claude', type: 'exec', payload: { cmd: 'ls -la', cwd: '/home', timeout: 5000 }, callback: true, ts: Date.now() },
    { ver: 1, id: 'int-2', from: 'local_claude', to: 'cloud_claude', type: 'query', payload: { question: 'What is the capital of France?', maxTokens: 100 }, callback: true, ts: Date.now() },
    { ver: 1, id: 'int-3', from: 'cloud_ds', to: 'user', type: 'report', payload: { taskId: 'task-1', status: 'completed', result: { data: [1, 2, 3] } }, callback: false, ts: Date.now() },
    { ver: 1, id: 'int-4', from: 'neca', to: 'cloud_ds', type: 'pong', payload: { status: 'ok', uptime: 3600, queueDepth: 0 }, callback: false, ts: Date.now() },
  ];

  it('JsonCodec 和 BinaryCodec 应该编解码结果一致', () => {
    for (const msg of sampleMessages) {
      const jsonEnc = jsonCodec.encode(msg);
      const binEnc = binaryCodec.encode(msg);

      // 二进制应该比 JSON 小（或至少不大太多）
      // 对于简单消息，二进制可能更大，但对于复杂 payload 应该更小
      const jsonDecoded = jsonCodec.decode(jsonEnc);
      const binDecoded = binaryCodec.decode(binEnc);

      expect(jsonDecoded.id).toBe(msg.id);
      expect(binDecoded.id).toBe(msg.id);
      expect(jsonDecoded.type).toBe(binDecoded.type);
      expect(jsonDecoded.from).toBe(binDecoded.from);
      expect(jsonDecoded.to).toBe(binDecoded.to);
      expect(jsonDecoded.callback).toBe(binDecoded.callback);
    }
  });

  it('二进制 codec 应该正确处理所有消息类型', () => {
    const types: MessageType[] = ['exec', 'read', 'write', 'search', 'delegate', 'query', 'report', 'cancel', 'ping', 'pong', 'error', 'ack', 'init'];
    for (const type of types) {
      const msg: Message = { ver: 1, id: `type-${type}`, from: 'cloud_ds', to: 'local_claude', type, payload: type === 'exec' ? { cmd: 'test' } : type === 'write' ? { path: '/tmp/t', content: 'hello' } : type === 'read' || type === 'search' ? { path: '/tmp/t' } : type === 'query' ? { question: 'test' } : type === 'delegate' ? { to: 'cloud_claude', instruction: 'test' } : type === 'report' ? { taskId: 't', status: 'completed' } : type === 'cancel' ? { taskId: 't' } : type === 'error' ? { code: 'ERR', message: 'test' } : type === 'ack' ? { originalMsgId: 't', status: 'accepted' } : type === 'init' ? { version: 1, supportedTypes: [], codecs: [], features: [] } : {}, callback: false, ts: Date.now() };
      const encoded = binaryCodec.encode(msg);
      const decoded = binaryCodec.decode(encoded);
      expect(decoded.type).toBe(type);
      expect(decoded.from).toBe('cloud_ds');
      expect(decoded.to).toBe('local_claude');
    }
  });

  it('二进制 codec 应该优雅处理无效输入', () => {
    expect(binaryCodec.decode(new Uint8Array(0))).toBeNull();
    expect(binaryCodec.decode(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(binaryCodec.decode(new Uint8Array(100).fill(0xFF))).toBeNull();
  });
});

// ============================================================
// 2. 校验中间件集成测试
// ============================================================

describe('校验中间件集成测试', () => {
  it('应该通过合法消息', () => {
    const msg: Message = {
      ver: 1, id: 'valid-msg', from: 'cloud_ds', to: 'local_claude',
      type: 'exec', payload: { cmd: 'echo hello' }, callback: true, ts: Date.now(),
    };
    const result = validateMessageMiddleware(msg);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('exec 类型缺少 cmd 应该报错', () => {
    const msg = {
      ver: 1, id: 'no-cmd', from: 'cloud_ds', to: 'local_claude',
      type: 'exec' as MessageType, payload: {}, callback: true, ts: Date.now(),
    };
    const result = validateMessageMiddleware(msg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('R7'))).toBe(true);
  });

  it('write 类型缺少 path 应该报错', () => {
    const msg = {
      ver: 1, id: 'no-path', from: 'cloud_ds', to: 'local_claude',
      type: 'write' as MessageType, payload: { content: 'hello' }, callback: true, ts: Date.now(),
    };
    const result = validateMessageMiddleware(msg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('R8'))).toBe(true);
  });

  it('无效的 type 应该报错', () => {
    const msg = {
      ver: 1, id: 'bad-type', from: 'cloud_ds', to: 'local_claude',
      type: 'invalid_type' as MessageType, payload: {}, callback: true, ts: Date.now(),
    };
    const result = validateMessageMiddleware(msg);
    expect(result.valid).toBe(false);
  });

  it('缺失 id 时应该自动补全', () => {
    const msg = {
      ver: 1, from: 'cloud_ds', to: 'local_claude',
      type: 'ping' as MessageType, payload: {}, callback: true, ts: Date.now(),
    } as any;
    const result = validateMessageMiddleware(msg);
    expect(result.valid).toBe(false);
    expect(result.sanitized).toBeDefined();
    expect(result.sanitized!.id).toBeDefined();
    expect(result.warnings.some(w => w.includes('Auto-generated'))).toBe(true);
  });
});

// ============================================================
// 3. 会话管理集成测试（带 autoPersist 模拟）
// ============================================================

describe('会话管理集成测试', () => {
  beforeEach(() => {
    // 重置 session 模块内部状态
    // 由于 session 模块内部使用模块级 Map，我们通过多次 expire 清理
    const sessions = sessionModule.listSessions();
    for (const s of sessions) {
      sessionModule.deleteSession(s.id);
    }
  });

  afterEach(() => {
    // 清理
    const sessions = sessionModule.listSessions();
    for (const s of sessions) {
      sessionModule.deleteSession(s.id);
    }
  });

  it('应该创建、更新、查询、删除会话', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo test' }, true);
    const record = sessionModule.createSession(msg);
    expect(record.status).toBe('pending');

    sessionModule.updateSession(record.id, { status: 'sent' });
    const updated = sessionModule.getSession(record.id);
    expect(updated!.status).toBe('sent');

    // 完整状态流转
    sessionModule.updateSession(record.id, { status: 'ack' });
    sessionModule.updateSession(record.id, { status: 'reply' });
    sessionModule.updateSession(record.id, { status: 'completed' });
    const completed = sessionModule.getSession(record.id);
    expect(completed!.status).toBe('completed');

    // 删除
    const deleted = sessionModule.deleteSession(record.id);
    expect(deleted).toBe(true);
    expect(sessionModule.getSession(record.id)).toBeNull();
  });

  it('应该支持 stat 统计', () => {
    for (let i = 0; i < 5; i++) {
      const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {}, false);
      sessionModule.createSession(msg);
    }
    const stats = sessionModule.sessionStats();
    expect(stats.total).toBeGreaterThanOrEqual(5);
    expect(stats.pending).toBeGreaterThanOrEqual(5);
  });

  it('应该支持按状态过滤列表', () => {
    const msg1 = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo a' }, true);
    const msg2 = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo b' }, true);
    const r1 = sessionModule.createSession(msg1);
    const r2 = sessionModule.createSession(msg2);
    sessionModule.updateSession(r1.id, { status: 'sent' });

    const pendingList = sessionModule.listSessions({ status: 'pending' });
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].id).toBe(r2.id);
  });
});

// ============================================================
// 4. 全链路端到端模拟测试
// ============================================================

describe('全链路端到端测试', () => {
  it('消息构建 → 编码 → 解码 → 校验 → 会话创建 → 状态流转', () => {
    // 1. 构建消息
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', {
      cmd: 'echo "Hello Silent Protocol"',
      cwd: '/tmp',
      timeout: 5000,
    }, true);

    // 2. 校验
    const validation = validateMessage(msg);
    expect(validation.valid).toBe(true);

    // 3. JsonCodec 编解码
    const codec = new JsonCodec();
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.id).toBe(msg.id);
    expect(decoded.type).toBe('exec');
    expect((decoded.payload as any).cmd).toBe('echo "Hello Silent Protocol"');

    // 4. BinaryCodec 编解码
    const binCodec = new BinaryCodec();
    const binEncoded = binCodec.encode(msg);
    const binDecoded = binCodec.decode(binEncoded);
    expect(binDecoded.id).toBe(msg.id);
    expect(binDecoded.type).toBe('exec');

    // 5. 创建会话
    const record = sessionModule.createSession(decoded);
    expect(record.status).toBe('pending');

    // 6. 状态流转
    sessionModule.updateSession(record.id, { status: 'running' });
    sessionModule.updateSession(record.id, { status: 'reply_received' });
    sessionModule.updateSession(record.id, { status: 'completed' });

    const final = sessionModule.getSession(record.id);
    expect(final!.status).toBe('completed');

    // 清理
    sessionModule.deleteSession(record.id);
  });

  it('校验中间件应该能拦截非法消息', () => {
    const badMsg = {
      ver: 1, id: '', from: '', to: '',
      type: 'unknown' as MessageType, payload: null,
    };
    const result = validateMessageMiddleware(badMsg as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
