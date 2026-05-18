/**
 * PCT — Protocol Compliance Tests（协议合规性测试套件）
 *
 * 验证 neca2 的协议实现是否完全符合 compact-protocol-spec.md。
 *
 * 测试分类：
 *   PCT-CORE:   核心消息结构合规
 *   PCT-TYPES:  所有 13 种消息类型的编解码合规
 *   PCT-AGENTS: Agent 标识符合规
 *   PCT-EDGE:   边界条件和错误处理合规
 *   PCT-CODEC:  双编解码器一致性
 *
 * 运行: npx vitest run tests/pct.test.ts
 */

import { describe, it, expect } from 'vitest';
import { JsonCodec, makeMessage, makeErrorMessage, generateId, now } from '../src/protocol/codec';
import { BinaryCodec, compressionRatio } from '../src/protocol/binary-codec';
import { validateMessage } from '../src/protocol/types';
import { validateMessageMiddleware } from '../src/protocol/validator';
import { ERROR_CODES, STANDARD_AGENTS, STANDARD_MESSAGE_TYPES } from '../src/protocol/types';
import type { Message, MessageType, AgentId } from '../src/protocol/types';

const jsonCodec = new JsonCodec();
const binaryCodec = new BinaryCodec();

// ============================================================
// PCT-CORE: 核心消息结构合规
// ============================================================

describe('PCT-CORE: 核心消息结构', () => {
  it('CORE-1: 消息必须包含 ver, id, from, to, type, payload, ts 字段', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const requiredFields = ['ver', 'id', 'from', 'to', 'type', 'payload', 'ts'];
    for (const field of requiredFields) {
      expect(msg).toHaveProperty(field);
    }
  });

  it('CORE-2: ver 必须是正整数', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    expect(typeof msg.ver).toBe('number');
    expect(Number.isInteger(msg.ver)).toBe(true);
    expect(msg.ver).toBeGreaterThan(0);
  });

  it('CORE-3: id 必须是非空字符串', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
  });

  it('CORE-4: from 和 to 必须是合法 agent 标识', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    expect(STANDARD_AGENTS).toContain(msg.from);
    expect(STANDARD_AGENTS).toContain(msg.to);
  });

  it('CORE-5: type 必须是标准消息类型', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    expect(STANDARD_MESSAGE_TYPES).toContain(msg.type);
  });

  it('CORE-6: callback 必须是 boolean', () => {
    const msgWithCallback = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'ls' }, true);
    const msgWithoutCallback = makeMessage('cloud_ds', 'local_claude', 'ping', {}, false);
    expect(typeof msgWithCallback.callback).toBe('boolean');
    expect(typeof msgWithoutCallback.callback).toBe('boolean');
    expect(msgWithCallback.callback).toBe(true);
    expect(msgWithoutCallback.callback).toBe(false);
  });

  it('CORE-7: ts 必须是正整数时间戳', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    expect(typeof msg.ts).toBe('number');
    expect(msg.ts).toBeGreaterThan(0);
  });
});

// ============================================================
// PCT-TYPES: 所有消息类型的编解码合规
// ============================================================

describe('PCT-TYPES: 消息类型合规', () => {
  const typeTestCases: Array<{ type: MessageType; payload: any; validatePayload?: (decoded: Message) => void }> = [
    { type: 'exec', payload: { cmd: 'echo hello', cwd: '/tmp', timeout: 5000, maxOutput: 1024 } },
    { type: 'read', payload: { path: '/var/log/syslog', offset: 0, maxLines: 100 } },
    { type: 'write', payload: { path: '/tmp/test.txt', content: 'hello world', append: false } },
    { type: 'search', payload: { path: '/home', pattern: 'function.*main', contextLines: 3, maxResults: 10 } },
    { type: 'delegate', payload: { to: 'cloud_claude', instruction: 'Analyze this code', priority: 'high', maxSteps: 20 } },
    { type: 'query', payload: { question: 'What is the meaning of life?', context: '42', maxTokens: 500, temperature: 0.8 } },
    { type: 'report', payload: { taskId: 'task-001', status: 'completed', result: { output: 'done' }, duration: 1234 } },
    { type: 'cancel', payload: { taskId: 'task-001', reason: 'timeout' } },
    { type: 'ping', payload: {} },
    { type: 'pong', payload: { status: 'ok', uptime: 3600, queueDepth: 0, memoryUsage: 0.5 } },
    { type: 'error', payload: { code: 'TIMEOUT', message: 'Request timed out', originalMsgId: 'msg-001', hint: 'Try again later' } },
    { type: 'ack', payload: { originalMsgId: 'msg-001', status: 'accepted', reason: 'will process' } },
    { type: 'init', payload: { version: 1, supportedTypes: ['exec', 'query'], codecs: ['json', 'binary'], features: ['callback', 'persistence'] } },
  ];

  for (const { type, payload } of typeTestCases) {
    it(`TYPES-${type}: ${type} 消息应该能正确编解码往返`, () => {
      const msg = makeMessage('cloud_ds', 'local_claude', type, payload);

      // JSON codec
      const jsonEnc = jsonCodec.encode(msg);
      const jsonDec = jsonCodec.decode(jsonEnc);
      expect(jsonDec.type).toBe(type);
      expect(jsonDec.from).toBe('cloud_ds');
      expect(jsonDec.to).toBe('local_claude');

      // Binary codec
      const binEnc = binaryCodec.encode(msg);
      const binDec = binaryCodec.decode(binEnc);
      expect(binDec.type).toBe(type);
      expect(binDec.from).toBe('cloud_ds');
      expect(binDec.to).toBe('local_claude');

      // 两种 codec 解码结果一致性
      expect(jsonDec.id).toBe(binDec.id);
      expect(jsonDec.ver).toBe(binDec.ver);
    });
  }
});

// ============================================================
// PCT-AGENTS: Agent 标识符合规
// ============================================================

describe('PCT-AGENTS: Agent 标识符合规', () => {
  it('AGENTS-1: 标准 Agent 列表必须包含 cloud_ds, local_claude, cloud_claude, user, neca', () => {
    expect(STANDARD_AGENTS).toContain('cloud_ds');
    expect(STANDARD_AGENTS).toContain('local_claude');
    expect(STANDARD_AGENTS).toContain('cloud_claude');
    expect(STANDARD_AGENTS).toContain('user');
    expect(STANDARD_AGENTS).toContain('neca');
  });

  it('AGENTS-2: 所有标准 Agent 都能用于消息的 from/to', () => {
    for (const agent of STANDARD_AGENTS) {
      const msg = makeMessage(agent, agent === 'cloud_ds' ? 'local_claude' : 'cloud_ds', 'ping', {});
      const validation = validateMessage(msg);
      expect(validation.valid).toBe(true);
    }
  });

  it('AGENTS-3: ext_ 前缀的 Agent 应该被允许', () => {
    const msg: Message = {
      ver: 1, id: 'ext-test', from: 'ext_github_bot', to: 'local_claude',
      type: 'exec', payload: { cmd: 'git status' }, callback: true, ts: Date.now(),
    };
    // types.ts 的 validateMessage 检查 ext_ 前缀
    const validation = validateMessage(msg);
    expect(validation.valid).toBe(true);
  });
});

// ============================================================
// PCT-EDGE: 边界条件和错误处理合规
// ============================================================

describe('PCT-EDGE: 边界条件和错误处理', () => {
  it('EDGE-1: 空 payload 应该被接受（ping 类型）', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const encoded = jsonCodec.encode(msg);
    const decoded = jsonCodec.decode(encoded);
    expect(decoded.type).toBe('ping');
    expect(decoded.payload).toEqual({});
  });

  it('EDGE-2: 超大 payload（100KB）应该能正常编解码', () => {
    const largeContent = 'X'.repeat(100_000);
    const msg = makeMessage('cloud_ds', 'local_claude', 'write', {
      path: '/tmp/big.txt',
      content: largeContent,
    });
    const encoded = jsonCodec.encode(msg);
    const decoded = jsonCodec.decode(encoded);
    expect((decoded.payload as any).content.length).toBe(100_000);
  });

  it('EDGE-3: 超长消息 ID（128 字符）应该能处理', () => {
    const longId = 'A'.repeat(128);
    const msg = { ver: 1, id: longId, from: 'cloud_ds', to: 'local_claude', type: 'ping' as MessageType, payload: {}, callback: false, ts: Date.now() };
    const validation = validateMessage(msg);
    expect(validation.valid).toBe(true);
  });

  it('EDGE-4: 大量消息批处理（200 条）应该不报错', () => {
    const msgs: Message[] = Array.from({ length: 200 }, (_, i) =>
      makeMessage('cloud_ds', 'local_claude', 'ping', {}),
    );
    for (const msg of msgs) {
      const encoded = jsonCodec.encode(msg);
      const decoded = jsonCodec.decode(encoded);
      expect(decoded.type).toBe('ping');
    }
  });

  it('EDGE-5: 错误消息应包含标准错误码', () => {
    const origMsg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'ls' });
    const errMsg = makeErrorMessage(origMsg, ERROR_CODES.TIMEOUT, 'Request timed out', 'Try again');
    expect(errMsg.type).toBe('error');
    expect(errMsg.payload).toHaveProperty('code', 'TIMEOUT');
    expect(errMsg.payload).toHaveProperty('message', 'Request timed out');
    expect(errMsg.payload).toHaveProperty('originalMsgId', origMsg.id);
    expect(errMsg.payload).toHaveProperty('hint', 'Try again');
  });
});

// ============================================================
// PCT-CODEC: 双编解码器一致性
// ============================================================

describe('PCT-CODEC: 双编解码器一致性', () => {
  it('CODEC-1: JsonCodec 和 BinaryCodec 应该都实现 Codec 接口', () => {
    expect(jsonCodec.type).toBe('json');
    expect(binaryCodec.type).toBe('binary');
    expect(typeof jsonCodec.encode).toBe('function');
    expect(typeof jsonCodec.decode).toBe('function');
    expect(typeof binaryCodec.encode).toBe('function');
    expect(typeof binaryCodec.decode).toBe('function');
  });

  it('CODEC-2: 对同一消息，两种 codec 解码后的核心字段应一致', () => {
    const testMsgs = [
      makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'ls' }),
      makeMessage('local_claude', 'cloud_claude', 'query', { question: 'Hello' }),
      makeMessage('cloud_claude', 'cloud_ds', 'report', { taskId: 't', status: 'completed' }),
      makeMessage('user', 'neca', 'ping', {}),
      makeMessage('neca', 'user', 'pong', { status: 'ok', uptime: 100, queueDepth: 0 }),
    ];

    for (const msg of testMsgs) {
      const jsonDec = jsonCodec.decode(jsonCodec.encode(msg));
      const binDec = binaryCodec.decode(binaryCodec.encode(msg));
      expect(jsonDec.id).toBe(binDec.id);
      expect(jsonDec.from).toBe(binDec.from);
      expect(jsonDec.to).toBe(binDec.to);
      expect(jsonDec.type).toBe(binDec.type);
      expect(jsonDec.ver).toBe(binDec.ver);
    }
  });

  it('CODEC-3: BinaryCodec 应能处理所有标准 Agent', () => {
    const agents: AgentId[] = ['cloud_ds', 'local_claude', 'cloud_claude', 'user', 'neca'];
    for (const from of agents) {
      for (const to of agents) {
        if (from === to) continue;
        const msg = makeMessage(from, to, 'ping', {});
        const encoded = binaryCodec.encode(msg);
        const decoded = binaryCodec.decode(encoded);
        expect(decoded.from).toBe(from);
        expect(decoded.to).toBe(to);
      }
    }
  });

  it('CODEC-4: compressionRatio 辅助函数计算正确', () => {
    expect(compressionRatio(1000, 500)).toBe('50.0%');
    expect(compressionRatio(1000, 1000)).toBe('0.0%');
    expect(compressionRatio(0, 0)).toBe('0%');
  });
});
