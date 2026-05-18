// ---- Stream Protocol v2 测试 ----
import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeFrame,
  decodeFrame,
  messageToFrames,
  framesToMessage,
  TYPE_REGISTRY,
  TYPE_REVERSE,
  FLAG_END,
  FLAG_PUSH,
  FLAG_STREAM,
  MultiplexedConnection,
  multiplexedConnection,
  compareProtocolVersions,
} from '../src/protocol/stream-protocol.js';
import type { Message } from '../src/protocol/types.js';

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    ver: 2,
    id: 'test-' + Math.random().toString(36).substring(2, 8),
    from: 'cloud_ds',
    to: 'local_claude',
    type: 'exec',
    payload: { cmd: 'echo hello', cwd: '/tmp', timeout: 5000 },
    callback: true,
    ts: Date.now(),
    ...overrides,
  };
}

describe('Stream Protocol v2 — 帧编解码', () => {
  it('应正确编码和解码帧', () => {
    const frame = {
      streamId: 1,
      flags: FLAG_END,
      typeCode: TYPE_REGISTRY['exec'],
      payloadLength: 5,
      payload: new TextEncoder().encode('hello'),
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.frame.streamId).toBe(1);
    expect(decoded!.frame.flags).toBe(FLAG_END);
    expect(decoded!.frame.typeCode).toBe(TYPE_REGISTRY['exec']);
    expect(new TextDecoder().decode(decoded!.frame.payload)).toBe('hello');
  });

  it('应正确编码大 streamId（varint 测试）', () => {
    const frame = { streamId: 65535, flags: 0, typeCode: 0x09, payloadLength: 0, payload: new Uint8Array(0) };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.frame.streamId).toBe(65535);
  });

  it('应处理空 payload', () => {
    const frame = { streamId: 1, flags: FLAG_END, typeCode: TYPE_REGISTRY['ping'], payloadLength: 0, payload: new Uint8Array(0) };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.frame.payloadLength).toBe(0);
  });

  it('类型注册表应完整可逆', () => {
    for (const [type, code] of Object.entries(TYPE_REGISTRY)) {
      expect(TYPE_REVERSE[code]).toBe(type);
    }
    expect(Object.keys(TYPE_REGISTRY).length).toBe(13);
  });
});

describe('Stream Protocol v2 — 消息 ↔ 帧转换', () => {
  it('应将消息编码为单帧', () => {
    const msg = makeMsg();
    const frames = messageToFrames(msg, 99999);
    expect(frames.length).toBe(1);
    expect(frames[0].flags & FLAG_END).toBe(FLAG_END);
    expect(frames[0].typeCode).toBe(TYPE_REGISTRY['exec']);
  });

  it('大消息应分片为多帧', () => {
    const msg = makeMsg({ type: 'write', payload: { path: '/tmp/big', content: 'x'.repeat(5000) } });
    const frames = messageToFrames(msg, 1000);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[frames.length - 1].flags & FLAG_END).toBe(FLAG_END);
    for (let i = 0; i < frames.length - 1; i++) {
      expect(frames[i].flags & FLAG_STREAM).toBe(FLAG_STREAM);
    }
  });

  it('应正确重组多帧为消息', () => {
    const original = makeMsg({ type: 'query', payload: { question: 'What is the meaning of life?', context: 'deep thought', maxTokens: 100 } });
    const frames = messageToFrames(original, 50);
    expect(frames.length).toBeGreaterThan(1);
    const reconstructed = framesToMessage(frames, original.from, original.to);
    expect(reconstructed.type).toBe(original.type);
    expect(reconstructed.ver).toBe(2);
    expect(reconstructed.from).toBe(original.from);
    expect(reconstructed.to).toBe(original.to);
    expect((reconstructed.payload as any).question).toBe('What is the meaning of life?');
  });
});

describe('Stream Protocol v2 — 多路复用连接', () => {
  it('应管理多个流', () => {
    const conn = new MultiplexedConnection();
    const msg1 = makeMsg({ id: 's1', type: 'exec' });
    const msg2 = makeMsg({ id: 's2', type: 'query' });
    const msg3 = makeMsg({ id: 's3', type: 'ping' });

    const sid1 = conn.openStream(msg1);
    const sid2 = conn.openStream(msg2);
    const sid3 = conn.openStream(msg3);

    expect(sid1).toBe(1);
    expect(sid2).toBe(2);
    expect(sid3).toBe(3);

    const f1 = messageToFrames(msg1);
    f1.forEach(f => conn.addFrame(sid1, f));
    const f2 = messageToFrames(msg2);
    f2.forEach(f => conn.addFrame(sid2, f));
    const f3 = messageToFrames(msg3);
    f3.forEach(f => conn.addFrame(sid3, f));

    const r1 = conn.getCompletedMessage(sid1);
    expect(r1).not.toBeNull();
    expect(r1!.type).toBe('exec');
    expect(r1!.from).toBe(msg1.from);
    expect(r1!.to).toBe(msg1.to);

    const r2 = conn.getCompletedMessage(sid2);
    expect(r2).not.toBeNull();
    expect(r2!.type).toBe('query');

    const r3 = conn.getCompletedMessage(sid3);
    expect(r3).not.toBeNull();
    expect(r3!.type).toBe('ping');
  });

  it('应正确过期旧流', () => {
    const conn = new MultiplexedConnection();
    const msg = makeMsg();
    conn.openStream(msg);
    // 用 -1 强制过期（因为 lastFrame 是 Date.now()，now - lastFrame >= 1ms）
    const evicted = conn.evictExpired(-1);
    expect(evicted).toBe(1);
  });

  it('应计算帧开销节省', () => {
    const conn = new MultiplexedConnection();
    for (let i = 0; i < 10; i++) {
      const msg = makeMsg({ id: `m${i}` });
      conn.openStream(msg);
      const frames = messageToFrames(msg);
      frames.forEach(f => conn.addFrame(i + 1, f));
    }
    const savings = conn.getFrameOverheadSavings(10);
    expect(savings).toContain('%');
  });
});

describe('Stream Protocol v2 — 版本对比', () => {
  it('v2 应比 v1 节省带宽', () => {
    const messages = [
      makeMsg({ type: 'ping', payload: {} }),
      makeMsg({ type: 'exec', payload: { cmd: 'npm test', cwd: '/project', timeout: 30000 } }),
      makeMsg({ type: 'report', payload: { taskId: 't1', status: 'completed', result: { output: 'ok' } } }),
      makeMsg({ type: 'query', payload: { question: 'test?', maxTokens: 500 } }),
    ];
    const result = compareProtocolVersions(messages);
    expect(result.v2Bytes).toBeLessThan(result.v1Bytes);
    expect(parseFloat(result.savings)).toBeGreaterThan(0);
    console.log(`  v1: ${result.v1Bytes}B, v2: ${result.v2Bytes}B, 节省: ${result.savings}`);
  });

  it('大消息的节省更明显', () => {
    const msgs = [makeMsg({ type: 'write', payload: { path: '/tmp/f', content: 'A'.repeat(10000) } })];
    const result = compareProtocolVersions(msgs);
    expect(result.v2Bytes).toBeLessThan(result.v1Bytes);
    console.log(`  大消息: v1: ${result.v1Bytes}B, v2: ${result.v2Bytes}B, 节省: ${result.savings}`);
  });
});
