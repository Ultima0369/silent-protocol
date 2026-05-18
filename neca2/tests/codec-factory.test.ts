/**
 * codec-factory.test.ts — CodecFactory 注册机制单元测试
 *
 * 覆盖：注册/注销、选择、自动选择、协商、压缩率统计
 *
 * 运行: npx vitest run tests/codec-factory.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { codecFactory, encode, decode, getCodecStats } from '../src/protocol/codec-factory';
import { makeMessage } from '../src/protocol/codec';
import type { Message, MessageType } from '../src/protocol/types';
import { JsonCodec } from '../src/protocol/codec';
import { BinaryCodec } from '../src/protocol/binary-codec';

describe('CodecFactory', () => {
  // ============================================================
  // 注册与查询
  // ============================================================

  describe('注册与查询', () => {
    it('应该默认注册 json 和 binary codec', () => {
      expect(codecFactory.has('json')).toBe(true);
      expect(codecFactory.has('binary')).toBe(true);
      expect(codecFactory.size).toBeGreaterThanOrEqual(2);
    });

    it('应该能获取已注册的 codec', () => {
      const json = codecFactory.get('json');
      expect(json).toBeDefined();
      expect(json!.type).toBe('json');

      const binary = codecFactory.get('binary');
      expect(binary).toBeDefined();
      expect(binary!.type).toBe('binary');
    });

    it('获取未注册的 codec 应返回 undefined', () => {
      expect(codecFactory.get('nonexistent')).toBeUndefined();
    });

    it('应该能列出所有已注册 codec 名称', () => {
      const names = codecFactory.names;
      expect(names).toContain('json');
      expect(names).toContain('binary');
    });

    it('默认 codec 应该是 json', () => {
      expect(codecFactory.default.type).toBe('json');
    });

    it('应该能设置默认 codec', () => {
      expect(codecFactory.setDefault('binary')).toBe(true);
      expect(codecFactory.default.type).toBe('binary');
      // 恢复
      codecFactory.setDefault('json');
      expect(codecFactory.default.type).toBe('json');
    });

    it('设置不存在的默认 codec 应返回 false', () => {
      expect(codecFactory.setDefault('nonexistent')).toBe(false);
    });

    it('禁止注销 json codec', () => {
      expect(codecFactory.unregister('json')).toBe(false);
      expect(codecFactory.has('json')).toBe(true);
    });
  });

  // ============================================================
  // encode/decode 便捷函数
  // ============================================================

  describe('encode/decode 便捷函数', () => {
    it('encode 应使用默认 codec', () => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
      const encoded = encode(msg);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('encode 应支持指定 codec', () => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'ls' });
      const jsonEncoded = encode(msg, 'json');
      const binEncoded = encode(msg, 'binary');
      expect(jsonEncoded).toBeInstanceOf(Uint8Array);
      expect(binEncoded).toBeInstanceOf(Uint8Array);
    });

    it('decode 应尝试所有 codec', () => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
      const jsonEncoded = encode(msg, 'json');
      const decoded = decode(jsonEncoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(msg.id);
    });

    it('decode 应支持指定 codec', () => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
      const jsonEncoded = encode(msg, 'json');
      const decoded = decode(jsonEncoded, 'json');
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(msg.id);
    });

    it('decode 应返回 null 对无效数据', () => {
      const badData = new Uint8Array([0, 1, 2, 3, 4, 5]);
      const decoded = decode(badData);
      expect(decoded).toBeNull();
    });
  });

  // ============================================================
  // 自动选择
  // ============================================================

  describe('自动选择', () => {
    it('小 payload 应选择 json', () => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
      const selected = codecFactory.autoSelect(msg);
      expect(selected.type).toBe('json');
    });

    it('大 payload（>1KB）应选择 binary', () => {
      const largeContent = 'A'.repeat(2000);
      const msg = makeMessage('cloud_ds', 'local_claude', 'write', {
        path: '/tmp/big.txt',
        content: largeContent,
      });
      const selected = codecFactory.autoSelect(msg);
      expect(selected.type).toBe('binary');
    });
  });

  // ============================================================
  // 内容协商
  // ============================================================

  describe('内容协商', () => {
    it('应优先选择 binary 如果对方支持', () => {
      const negotiated = codecFactory.negotiate(['binary', 'json']);
      expect(negotiated.type).toBe('binary');
    });

    it('应降级到 json 如果不支持 binary', () => {
      const negotiated = codecFactory.negotiate(['json']);
      expect(negotiated.type).toBe('json');
    });

    it('对空列表应返回默认 codec', () => {
      const negotiated = codecFactory.negotiate([]);
      expect(negotiated.type).toBe('json');
    });
  });

  // ============================================================
  // 压缩率统计
  // ============================================================

  describe('压缩率统计', () => {
    it('应返回所有 codec 的字节数和压缩率', () => {
      const msg = makeMessage('cloud_ds', 'local_claude', 'exec', {
        cmd: 'echo hello world',
        cwd: '/tmp',
        timeout: 5000,
      });
      const stats = getCodecStats(msg);
      expect(stats.json).toBeDefined();
      expect(stats.binary).toBeDefined();
      expect(stats.json.bytes).toBeGreaterThan(0);
      expect(stats.binary.bytes).toBeGreaterThan(0);
      expect(typeof stats.json.ratio).toBe('string');
      expect(typeof stats.binary.ratio).toBe('string');
    });
  });
});
