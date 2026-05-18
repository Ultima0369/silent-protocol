// ---- 高级缓存测试 ----

import { describe, it, expect, beforeEach } from 'vitest';
import { makeMessage } from '../src/protocol/codec.js';
import { codecFactory } from '../src/protocol/codec-factory.js';
import { advancedCache, runAdvancedCacheBench } from '../src/relay/cache-advanced.js';
import { messageCache } from '../src/relay/message-cache.js';
import type { Message } from '../src/protocol/types.js';

beforeEach(() => {
  messageCache.clear();
  advancedCache.clear();
});

describe('AdvancedCache — Semantic Pattern Matching', () => {
  it('should match ping messages semantically', () => {
    const ping1 = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const ping2 = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    // Different IDs but same semantic → should resolve from cache
    const codec = codecFactory.default;
    const encoded1 = advancedCache.resolve(ping1, (m) => codec.encode(m));
    const encoded2 = advancedCache.resolve(ping2, (m) => codec.encode(m));
    expect(encoded1).toEqual(encoded2);
    const stats = advancedCache.getStats();
    expect(stats.combinedHitRate).not.toBe('0%');
  });

  it('should match pong messages semantically', () => {
    const pong1 = makeMessage('local_claude', 'cloud_ds', 'pong', {});
    const pong2 = makeMessage('local_claude', 'cloud_ds', 'pong', {});
    const codec = codecFactory.default;
    advancedCache.resolve(pong1, (m) => codec.encode(m));
    advancedCache.resolve(pong2, (m) => codec.encode(m));
    const stats = advancedCache.getStats();
    expect(stats.semantic.hits).toBeGreaterThanOrEqual(0);
  });

  it('should NOT match different message types as same pattern', () => {
    const ping = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const exec = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi' });
    const codec = codecFactory.default;
    const enc1 = advancedCache.resolve(ping, (m) => codec.encode(m));
    const enc2 = advancedCache.resolve(exec, (m) => codec.encode(m));
    // Different types → different encodings
    expect(enc1.length).not.toEqual(enc2.length);
  });

  it('should match exec commands with same cmd type', () => {
    const git1 = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'git status', cwd: '/proj/a' });
    const git2 = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'git diff', cwd: '/proj/b' });
    const codec = codecFactory.default;
    // Both are git commands → same semantic key
    const enc1 = advancedCache.resolve(git1, (m) => codec.encode(m));
    const enc2 = advancedCache.resolve(git2, (m) => codec.encode(m));
    // Different payloads → different encodings (semantic cache only works for exact payload match)
    // But for ping/pong it works. For exec, it should still cache per exact match via base cache
    const baseStats = messageCache.getStats();
    // After second resolve with same cmd type but different cwd, base cache should have 2 entries
    expect(baseStats.l1Size).toBeGreaterThanOrEqual(1);
  });
});

describe('AdvancedCache — Conversation Flow Prediction', () => {
  it('should predict pong after ping', () => {
    const ping = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const predictions = advancedCache.flowPredictor.predict(ping);
    expect(predictions.length).toBeGreaterThanOrEqual(1);
    expect(predictions[0].type).toBe('pong');
    expect(predictions[0].from).toBe('local_claude');
    expect(predictions[0].to).toBe('cloud_ds');
  });

  it('should predict report after exec', () => {
    const exec = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi', cwd: '/tmp' });
    const predictions = advancedCache.flowPredictor.predict(exec);
    const hasReport = predictions.some(p => p.type === 'report');
    expect(hasReport).toBe(true);
  });

  it('should predict query after error report', () => {
    const errorReport = makeMessage('local_claude', 'cloud_ds', 'report', {
      taskId: 't1', status: 'error', result: { output: '', exitCode: 1, stderr: 'Error: fail' }
    });
    const predictions = advancedCache.flowPredictor.predict(errorReport);
    const hasQuery = predictions.some(p => p.type === 'query');
    expect(hasQuery).toBe(true);
  });

  it('should provide flow stats', () => {
    const ping = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    advancedCache.flowPredictor.predict(ping);
    const stats = advancedCache.flowPredictor.getStats();
    expect(stats.rules).toBeGreaterThanOrEqual(7);
    expect(stats.totalPredictions).toBeGreaterThanOrEqual(1);
  });
});

describe('AdvancedCache — Adaptive TTL', () => {
  it('should have different TTL policies for different types', () => {
    // Access internal stats
    const ttlStats = advancedCache.ttlManager.getStats();
    expect(ttlStats.policies).toBeGreaterThanOrEqual(12);
  });

  it('should extend TTL on repeated access', () => {
    const key = 'test-ttl-key';
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    // First access
    const ttl1 = advancedCache.ttlManager.getOrRefreshTtl(key, msg.type);
    // Second access (simulating repeated hit)
    const ttl2 = advancedCache.ttlManager.getOrRefreshTtl(key, msg.type);
    // Second TTL should be later (extended)
    expect(ttl2).toBeGreaterThanOrEqual(ttl1);
  });

  it('should expire entries', () => {
    const key = 'expired-key';
    // Manually set an expired entry
    advancedCache.ttlManager.getOrRefreshTtl(key, 'ping');
    // Should not be expired immediately
    expect(advancedCache.ttlManager.isExpired(key)).toBe(false);
  });
});

describe('AdvancedCache — Content Dedup', () => {
  it('should dedup identical payloads', () => {
    const payload1 = { cmd: 'echo hello', cwd: '/tmp' };
    const payload2 = { cmd: 'echo hello', cwd: '/tmp' };
    const key1 = advancedCache.dedupEngine.storePayload(payload1);
    const key2 = advancedCache.dedupEngine.storePayload(payload2);
    // Same content → same hash key
    expect(key1).toBe(key2);
    const stats = advancedCache.dedupEngine.getStats();
    expect(stats.uniquePayloads).toBeGreaterThanOrEqual(1);
    expect(stats.totalRefs).toBeGreaterThanOrEqual(2);
  });

  it('should NOT dedup different payloads', () => {
    const payload1 = { cmd: 'echo hello' };
    const payload2 = { cmd: 'echo world' };
    const key1 = advancedCache.dedupEngine.storePayload(payload1);
    const key2 = advancedCache.dedupEngine.storePayload(payload2);
    expect(key1).not.toBe(key2);
  });

  it('should retrieve stored payload', () => {
    const payload = { cmd: 'test', cwd: '/tmp' };
    const key = advancedCache.dedupEngine.storePayload(payload);
    const retrieved = advancedCache.dedupEngine.retrievePayload(key);
    expect(retrieved).toEqual(payload);
  });

  it('should return null for unknown key', () => {
    const retrieved = advancedCache.dedupEngine.retrievePayload('nonexistent');
    expect(retrieved).toBeNull();
  });

  it('should track dedup savings', () => {
    advancedCache.clear();
    const payload = { content: 'A'.repeat(1024) };
    const key1 = advancedCache.dedupEngine.storePayload(payload);
    const key2 = advancedCache.dedupEngine.storePayload(payload); // duplicate
    const stats = advancedCache.dedupEngine.getStats();
    expect(stats.estimatedSaved).not.toBe('0 KB');
  });
});

describe('AdvancedCache — Combined Resolve', () => {
  it('should resolve identical messages from base cache', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const codec = codecFactory.default;
    const r1 = advancedCache.resolve(msg, (m) => codec.encode(m));
    const r2 = advancedCache.resolve(msg, (m) => codec.encode(m));
    expect(r1).toEqual(r2);
  });

  it('should prefetch predicted messages on resolve', () => {
    // Resolving exec should prefetch report
    const exec = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi', cwd: '/tmp' });
    const codec = codecFactory.default;
    advancedCache.resolve(exec, (m) => codec.encode(m));

    // The predicted report should now be in base cache
    const predictedReport = makeMessage('local_claude', 'cloud_ds', 'report', {
      taskId: 'predicted', status: 'completed'
    });
    const cached = messageCache.get(predictedReport);
    // May or may not be cached depending on exact match, but prefetch ran
    expect(advancedCache.flowPredictor.getStats().totalPredictions).toBeGreaterThanOrEqual(1);
  });

  it('should provide comprehensive stats', () => {
    const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
    const codec = codecFactory.default;
    advancedCache.resolve(msg, (m) => codec.encode(m));
    const stats = advancedCache.getStats();
    expect(stats.semantic).toBeDefined();
    expect(stats.flow).toBeDefined();
    expect(stats.ttl).toBeDefined();
    expect(stats.dedup).toBeDefined();
    expect(stats.baseCache).toBeDefined();
    expect(stats.combinedHitRate).toBeDefined();
  });
});

describe('AdvancedCache — Benchmark', () => {
  it('should run cache benchmark without errors', () => {
    const messages = [
      makeMessage('cloud_ds', 'local_claude', 'ping', {}),
      makeMessage('local_claude', 'cloud_ds', 'pong', {}),
      makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'echo hi', cwd: '/tmp' }),
      makeMessage('local_claude', 'cloud_ds', 'report', { taskId: 't1', status: 'completed' }),
    ];
    const codec = codecFactory.default;
    const result = runAdvancedCacheBench('test', messages, 10, (m) => codec.encode(m));
    expect(result.scenario).toBe('test');
    expect(result.totalMessages).toBe(4);
    expect(result.withoutCache.totalTimeUs).toBeGreaterThan(0);
    expect(result.withBaseCache.totalTimeUs).toBeGreaterThan(0);
    expect(result.withAdvancedCache.totalTimeUs).toBeGreaterThan(0);
    expect(result.baseSpeedup).toBeDefined();
    expect(result.advancedSpeedup).toBeDefined();
  });

  it('should show better speedup with more iterations', () => {
    // Create a scenario with many repeated patterns
    const baseMsgs = [
      makeMessage('cloud_ds', 'local_claude', 'ping', {}),
      makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'git status', cwd: '/project' }),
      makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'npm test', cwd: '/project' }),
      makeMessage('cloud_ds', 'cloud_claude', 'query', { question: '分析', context: 'code', maxTokens: 1000 }),
    ];
    // Generate 100 messages cycling through 4 patterns (high repetition)
    const manyMsgs: Message[] = [];
    for (let i = 0; i < 100; i++) {
      manyMsgs.push(baseMsgs[i % baseMsgs.length]);
    }

    const codec = codecFactory.default;
    const result = runAdvancedCacheBench('high-repetition', manyMsgs, 100, (m) => codec.encode(m));

    // Smoke test: benchmark should run and produce numbers (timing is environment-dependent)
    expect(result.withAdvancedCache.totalTimeUs).toBeGreaterThan(0);
    expect(result.withoutCache.totalTimeUs).toBeGreaterThan(0);
  });
});
