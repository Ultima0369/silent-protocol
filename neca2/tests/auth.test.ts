// ---- Auth 测试 ----
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initKeys,
  signMessage,
  verifyMessageSignature,
  verifyTimestamp,
  authenticateMessage,
  makeSignedMessage,
  getKeySummary,
} from '../src/utils/auth.js';
import { makeMessage } from '../src/protocol/codec.js';

describe('Agent 认证', () => {
  beforeEach(() => {
    initKeys({
      cloud_ds: 'dGVzdC1rZXktY2xvdWQtZHM=',
      local_claude: 'dGVzdC1rZXktbG9jYWwtY2xhdWRl',
      cloud_claude: 'dGVzdC1rZXktY2xvdWQtY2xhdWRl',
      user: 'dGVzdC1rZXktdXNlcg==',
      neca: 'dGVzdC1rZXktbmVjYQ==',
    });
  });

  it('应为消息生成签名', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const sig = signMessage(msg);
    expect(sig).toBeDefined();
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  it('签名验证应通过', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const sig = signMessage(msg);
    const result = verifyMessageSignature(msg, sig);
    expect(result.valid).toBe(true);
  });

  it('篡改消息后签名验证应失败', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const sig = signMessage(msg);
    msg.type = 'query'; // 篡改
    const result = verifyMessageSignature(msg, sig);
    expect(result.valid).toBe(false);
  });

  it('无密钥的 Agent 签名应抛出错误', () => {
    const msg = makeMessage('unknown_agent', 'local_claude', 'ping', {});
    expect(() => signMessage(msg)).toThrow();
  });

  it('应验证时间戳（在允许范围内）', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const result = verifyTimestamp(msg, 300_000); // 5分钟偏差
    expect(result.valid).toBe(true);
  });

  it('makeSignedMessage 应生成带签名的消息', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'npm test' });
    const signed = makeSignedMessage(msg);
    const payload = signed.payload as any;
    expect(payload.auth).toBeDefined();
    expect(payload.auth.signature).toBeDefined();
    expect(typeof payload.auth.signature).toBe('string');
  });

  it('authenticateMessage 应通过带签名的消息', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const signed = makeSignedMessage(msg);
    const result = authenticateMessage(signed, { requireAuth: true });
    expect(result.authenticated).toBe(true);
    expect(result.verifiedAgent).toBe('cloud_ds');
  });

  it('authenticateMessage 对无签名的消息应拒绝', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const result = authenticateMessage(msg, { requireAuth: true });
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('auth.signature missing');
  });

  it('authenticateMessage 不要求认证时应通过', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const result = authenticateMessage(msg, { requireAuth: false });
    expect(result.authenticated).toBe(true);
  });

  it('getKeySummary 应返回密钥摘要', () => {
    const summary = getKeySummary();
    expect(summary.agents).toBeDefined();
    expect(summary.agents.length).toBeGreaterThanOrEqual(5);
    expect(summary.keyFile).toContain('agent-keys.json');
  });
});
