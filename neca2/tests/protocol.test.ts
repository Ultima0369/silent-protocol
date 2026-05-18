/**
 * protocol.test.ts — 紧凑协议编解码单元测试
 * 
 * 覆盖：每种消息类型的序列化/反序列化、无效消息校验、边界条件
 * 
 * 运行: npx vitest run tests/protocol.test.ts
 * 或:   npx jest tests/protocol.test.ts --no-cache
 */

import { describe, it, expect } from 'vitest';
import { JsonCodec } from '../src/protocol/codec';
import { validateMessage } from '../src/protocol/types';
import type { Message, MessageType } from '../src/protocol/types';

const codec = new JsonCodec();

// ============================================================
// 基础编解码往返测试
// ============================================================

describe('JsonCodec 编解码往返', () => {
  it('应该正确编解码一条 exec 消息', () => {
    const msg: Message = {
      ver: 1, id: 'test-001', from: 'cloud_ds', to: 'local_claude',
      type: 'exec', payload: { cmd: 'echo hello', cwd: '.', timeout: 5000 },
      callback: true, ts: Date.now(),
    };
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.id).toBe('test-001');
    expect(decoded.type).toBe('exec');
    expect(decoded.payload.cmd).toBe('echo hello');
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(msg));
  });

  it('应该正确编解码一条 read 消息', () => {
    const msg: Message = {
      ver: 1, id: 'test-002', from: 'cloud_ds', to: 'local_claude',
      type: 'read', payload: { path: '/var/log/syslog', offset: 100, maxLines: 50 },
      callback: true, ts: Date.now(),
    };
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.type).toBe('read');
    expect(decoded.payload.path).toBe('/var/log/syslog');
    expect(decoded.payload.offset).toBe(100);
  });

  it('应该正确编解码一条 query 消息', () => {
    const msg: Message = {
      ver: 1, id: 'test-003', from: 'local_claude', to: 'cloud_claude',
      type: 'query', payload: { question: 'Best sorting algo?', context: 'Array of 1M ints', maxTokens: 500 },
      callback: true, ts: Date.now(),
    };
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.from).toBe('local_claude');
    expect(decoded.to).toBe('cloud_claude');
    expect(decoded.payload.question).toBe('Best sorting algo?');
  });

  it('应该正确编解码一条 report 消息', () => {
    const msg: Message = {
      ver: 1, id: 'test-004', from: 'local_claude', to: 'cloud_ds',
      type: 'report', payload: { taskId: 'task-1', status: 'completed', result: 'All good', error: '' },
      callback: false, ts: Date.now(),
    };
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.type).toBe('report');
    expect(decoded.payload.status).toBe('completed');
    expect(decoded.callback).toBe(false);
  });

  it('应该正确编解码 write、search、delegate、ping 消息', () => {
    const msgs: Message[] = [
      { ver: 1, id: 't-w', from: 'cloud_ds', to: 'local_claude', type: 'write', payload: { path: '/tmp/test.txt', content: 'hello', append: false }, callback: true, ts: Date.now() },
      { ver: 1, id: 't-s', from: 'cloud_ds', to: 'local_claude', type: 'search', payload: { path: '.', pattern: 'function.*main', contextLines: 3 }, callback: true, ts: Date.now() },
      { ver: 1, id: 't-d', from: 'cloud_ds', to: 'local_claude', type: 'delegate', payload: { to: 'cloud_claude', instruction: 'Review this code', priority: 1 }, callback: true, ts: Date.now() },
      { ver: 1, id: 't-p', from: 'cloud_ds', to: 'local_claude', type: 'ping', payload: {}, callback: false, ts: Date.now() },
    ];
    for (const msg of msgs) {
      const encoded = codec.encode(msg);
      const decoded = codec.decode(encoded);
      expect(decoded.type).toBe(msg.type);
      expect(JSON.stringify(decoded)).toBe(JSON.stringify(msg));
    }
  });
});

// ============================================================
// 消息校验测试
// ============================================================

describe('消息校验 (validateMessage)', () => {
  it('应该接受一条合法的消息', () => {
    const msg: Message = {
      ver: 1, id: 'valid-msg', from: 'cloud_ds', to: 'local_claude',
      type: 'exec', payload: { cmd: 'ls' }, callback: true, ts: Date.now(),
    };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('应该拒绝缺少 ver 的消息', () => {
    const msg = { id: 'no-ver', from: 'cloud_ds', to: 'local_claude', type: 'exec', payload: {}, callback: true, ts: Date.now() };
    const result = validateMessage(msg as Message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('ver');
  });

  it('应该拒绝缺少 type 的消息', () => {
    const msg = { ver: 1, id: 'no-type', from: 'cloud_ds', to: 'local_claude', payload: {}, callback: true, ts: Date.now() };
    const result = validateMessage(msg as Message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('type');
  });

  it('应该拒绝无效的 type 值', () => {
    const msg: Message = {
      ver: 1, id: 'bad-type', from: 'cloud_ds', to: 'local_claude',
      type: 'invalid_type' as MessageType, payload: {}, callback: true, ts: Date.now(),
    };
    const result = validateMessage(msg);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('type');
  });

  it('应该拒绝无效的 from/to', () => {
    const msg: Message = {
      ver: 1, id: 'bad-from', from: 'unknown_entity', to: 'local_claude',
      type: 'exec', payload: { cmd: 'ls' }, callback: true, ts: Date.now(),
    };
    const result = validateMessage(msg as Message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('from');
  });

  it('exec 类型缺少 cmd 应该报错', () => {
    const msg: Message = {
      ver: 1, id: 'no-cmd', from: 'cloud_ds', to: 'local_claude',
      type: 'exec', payload: {}, callback: true, ts: Date.now(),
    };
    const result = validateMessage(msg);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cmd');
  });
});

// ============================================================
// 边界条件测试
// ============================================================

describe('边界条件', () => {
  it('应该处理空 payload', () => {
    const msg: Message = {
      ver: 1, id: 'empty-payload', from: 'cloud_ds', to: 'local_claude',
      type: 'ping', payload: {}, callback: false, ts: Date.now(),
    };
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.type).toBe('ping');
  });

  it('应该处理超长字符串 payload', () => {
    const longStr = 'A'.repeat(10000);
    const msg: Message = {
      ver: 1, id: 'long-payload', from: 'cloud_ds', to: 'local_claude',
      type: 'write', payload: { path: '/tmp/big.txt', content: longStr },
      callback: true, ts: Date.now(),
    };
    const encoded = codec.encode(msg);
    const decoded = codec.decode(encoded);
    expect(decoded.payload.content.length).toBe(10000);
  });

  it('应该处理大量消息', () => {
    const count = 100;
    const msgs: Message[] = Array.from({ length: count }, (_, i) => ({
      ver: 1, id: `stress-${i}`, from: 'cloud_ds', to: 'local_claude',
      type: 'ping' as MessageType, payload: {}, callback: false, ts: Date.now(),
    }));
    for (const msg of msgs) {
      const encoded = codec.encode(msg);
      const decoded = codec.decode(encoded);
      expect(decoded.id).toBe(`stress-${parseInt(decoded.id.split('-')[1])}`);
    }
  });
});
