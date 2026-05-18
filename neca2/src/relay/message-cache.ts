// ---- 消息缓存层（Message Cache） ----
//
// 核心洞察：结构化消息是确定性的。
// 相同的 (from, to, type, payload) → 永远产生相同的编码字节。
// 这意味着：
//   1. 缓存命中的消息直接返回编码结果，零编解码开销
//   2. 消息不可变，无需缓存失效
//   3. 多轮对话中相同模板反复命中，效率随轮数线性增长
//
// 三层缓存架构：
//   L1: Hot Cache (Map, LRU)    — 最近使用，极速访问
//   L2: Template Cache (Map)    — 按模板键缓存，持久化
//   L3: Predictive Cache        — 预编码预测的下一条消息
//
// 使用方式：
//   import { messageCache } from './relay/message-cache.js';
//   messageCache.get(msg) ?? messageCache.set(msg, codec.encode(msg));

import type { Message } from '../protocol/types.js';

// ---- 缓存统计 ----
export interface CacheStats {
  l1Hits: number;
  l2Hits: number;
  l3Hits: number;
  misses: number;
  totalLookups: number;
  hitRate: string;
  l1Size: number;
  l2Size: number;
  l3Prefetched: number;
  l3HitRate: string;
  estimatedTimeSaved: string;  // 基于平均编码延迟估算
  estimatedBytesSaved: number; // 避免重复编码节省的 CPU 时间等价
}

// ---- 缓存条目 ----
interface CacheEntry {
  encoded: Uint8Array;
  frequency: number;
  lastAccessed: number;
}

// ---- 生成模板键 ----
// 使用 from+to+type+payload 的结构化摘要作为键
// 忽略 ts、id 等可变字段
function makeTemplateKey(msg: Message): string {
  // payload 按 key 排序确保一致性
  const sortedPayload = Object.keys(msg.payload)
    .sort()
    .reduce((acc: Record<string, unknown>, k) => {
      acc[k] = (msg.payload as Record<string, unknown>)[k];
      return acc;
    }, {});
  return `${msg.from}|${msg.to}|${msg.type}|${JSON.stringify(sortedPayload)}`;
}

// ---- 消息缓存 ----

class MessageCache {
  // L1: Hot Cache (最近最多使用，上限 1024)
  private l1 = new Map<string, CacheEntry>();
  private readonly L1_MAX = 1024;

  // L2: Template Cache (冷数据下沉，上限 4096)
  private l2 = new Map<string, CacheEntry>();
  private readonly L2_MAX = 4096;

  // L3: Predictive Cache (预取)
  private l3 = new Map<string, Uint8Array>();
  private l3Hits = 0;
  private l3Lookups = 0;

  // 命中统计
  private l1Hits = 0;
  private l2Hits = 0;
  private misses = 0;
  private l1Promotions = 0;  // L2→L1 提升次数

  // 热度追踪
  private frequencyMap = new Map<string, number>();

  constructor() {
    // 预热常见模板
    this.warmup();
  }

  private warmup(): void {
    // 预热最常见的消息模板
    const commonTemplates = [
      { from: 'cloud_ds', to: 'local_claude', type: 'ping', payload: {} },
      { from: 'local_claude', to: 'cloud_ds', type: 'pong', payload: {} },
      { from: 'cloud_ds', to: 'local_claude', type: 'ack', payload: {} },
    ];
    for (const t of commonTemplates) {
      const key = makeTemplateKey(t as unknown as Message);
      // 这些在 L1 中预占位，但 encoded 为 null，首次使用时填充
      this.l2.set(key, { encoded: new Uint8Array(0), frequency: 1, lastAccessed: Date.now() });
    }
  }

  /** 生成模板键（公开，用于外部查询） */
  makeKey(msg: Message): string {
    return makeTemplateKey(msg);
  }

  /** 查找缓存 */
  get(msg: Message): Uint8Array | null {
    const key = makeTemplateKey(msg);
    this.frequencyMap.set(key, (this.frequencyMap.get(key) || 0) + 1);

    // L1 查找
    const l1Entry = this.l1.get(key);
    if (l1Entry) {
      l1Entry.lastAccessed = Date.now();
      l1Entry.frequency++;
      this.l1Hits++;
      return l1Entry.encoded;
    }

    // L2 查找
    const l2Entry = this.l2.get(key);
    if (l2Entry) {
      l2Entry.lastAccessed = Date.now();
      l2Entry.frequency++;
      this.l2Hits++;
      
      // 如果 L2 条目访问频繁，提升到 L1
      if (l2Entry.frequency >= 3 && this.l1.size < this.L1_MAX) {
        this.l1.set(key, l2Entry);
        this.l1Promotions++;
      }
      
      return l2Entry.encoded;
    }

    // L3 查找（预测缓存）
    this.l3Lookups++;
    const l3Data = this.l3.get(key);
    if (l3Data) {
      this.l3Hits++;
      // 提升到 L1
      if (this.l1.size < this.L1_MAX) {
        this.l1.set(key, { encoded: l3Data, frequency: 1, lastAccessed: Date.now() });
      }
      return l3Data;
    }

    this.misses++;
    return null;
  }

  /** 写入缓存 */
  set(msg: Message, encoded: Uint8Array): void {
    const key = makeTemplateKey(msg);
    const entry: CacheEntry = {
      encoded,
      frequency: 1,
      lastAccessed: Date.now(),
    };

    // 总是写入 L1（如果未满）
    if (this.l1.size < this.L1_MAX) {
      this.l1.set(key, entry);
    } else {
      // L1 满：淘汰最久未使用到 L2
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [k, v] of this.l1) {
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const evicted = this.l1.get(oldestKey)!;
        this.l1.delete(oldestKey);
        // 写入 L2（如果未满）
        if (this.l2.size < this.L2_MAX) {
          this.l2.set(oldestKey, evicted);
        }
      }
      this.l1.set(key, entry);
    }
  }

  /** 批量写入（用于预热） */
  setBatch(messages: Array<{ msg: Message; encoded: Uint8Array }>): void {
    for (const { msg, encoded } of messages) {
      this.set(msg, encoded);
    }
  }

  /** 预取：预测下一条消息并预编码 */
  prefetch(predictedMessages: Message[], codecEncode: (msg: Message) => Uint8Array): number {
    let prefetched = 0;
    for (const msg of predictedMessages) {
      const key = makeTemplateKey(msg);
      if (!this.l1.has(key) && !this.l2.has(key)) {
        try {
          const encoded = codecEncode(msg);
          this.l3.set(key, encoded);
          prefetched++;
        } catch {
          // 忽略编码失败
        }
      }
    }
    // 限制 L3 大小
    if (this.l3.size > 512) {
      const keys = [...this.l3.keys()].slice(0, 256);
      for (const k of keys) this.l3.delete(k);
    }
    return prefetched;
  }

  /** 获取热度排名 */
  getHeatmap(limit = 20): Array<{ key: string; frequency: number }> {
    return [...this.frequencyMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, frequency]) => ({ key, frequency }));
  }

  /** 清除缓存 */
  clear(): void {
    this.l1.clear();
    this.l2.clear();
    this.l3.clear();
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.l3Hits = 0;
    this.l3Lookups = 0;
    this.misses = 0;
    this.frequencyMap.clear();
    this.warmup();
  }

  /** 获取统计 */
  getStats(): CacheStats {
    const total = this.l1Hits + this.l2Hits + this.misses + this.l3Hits;
    const l3Lookups = this.l3Lookups || 1;
    return {
      l1Hits: this.l1Hits,
      l2Hits: this.l2Hits,
      l3Hits: this.l3Hits,
      misses: this.misses,
      totalLookups: total,
      hitRate: total > 0 ? ((this.l1Hits + this.l2Hits + this.l3Hits) / total * 100).toFixed(1) + '%' : '0%',
      l1Size: this.l1.size,
      l2Size: this.l2.size,
      l3Prefetched: this.l3.size,
      l3HitRate: l3Lookups > 0 ? (this.l3Hits / l3Lookups * 100).toFixed(1) + '%' : '0%',
      estimatedTimeSaved: this.#estimateTimeSaved(total),
      estimatedBytesSaved: this.#estimateBytesSaved(),
    };
  }

  /** 估算节省的编码时间 */
  #estimateTimeSaved(totalLookups: number): string {
    // 平均编码时间 ~2μs (JSON) + ~6μs (Binary)
    const avgEncodeTimeUs = 4;
    const savedUs = (this.l1Hits + this.l2Hits + this.l3Hits) * avgEncodeTimeUs;
    if (savedUs < 1000) return `${savedUs.toFixed(0)} μs`;
    if (savedUs < 1_000_000) return `${(savedUs / 1000).toFixed(1)} ms`;
    return `${(savedUs / 1_000_000).toFixed(2)} s`;
  }

  /** 估算节省的带宽（避免重复传输相同内容） */
  #estimateBytesSaved(): number {
    let total = 0;
    for (const entry of this.l1.values()) total += entry.encoded.length * (entry.frequency - 1);
    for (const entry of this.l2.values()) total += entry.encoded.length * (entry.frequency - 1);
    return total;
  }

  /** 获取缓存命中 vs 未命中的比率详情 */
  getHitBreakdown(): string {
    const total = this.l1Hits + this.l2Hits + this.l3Hits + this.misses;
    if (total === 0) return 'No data';
    const l1Pct = (this.l1Hits / total * 100).toFixed(1);
    const l2Pct = (this.l2Hits / total * 100).toFixed(1);
    const l3Pct = (this.l3Hits / total * 100).toFixed(1);
    const missPct = (this.misses / total * 100).toFixed(1);
    return `L1:${l1Pct}% L2:${l2Pct}% L3:${l3Pct}% Miss:${missPct}%`;
  }
}

// ---- 单例 ----
export const messageCache = new MessageCache();

// ---- 缓存感知的编解码包装器 ----
// 使用方式：替代 codec.encode(msg)，自动走缓存

export function cachedEncode(
  msg: Message,
  codecEncode: (msg: Message) => Uint8Array
): Uint8Array {
  const cached = messageCache.get(msg);
  if (cached && cached.length > 0) {
    return cached;
  }
  const encoded = codecEncode(msg);
  messageCache.set(msg, encoded);
  return encoded;
}

// ---- 缓存基准辅助函数 ----

export interface CacheBenchResult {
  scenario: string;
  iterations: number;
  withoutCache: { totalTimeUs: number; avgUs: number };
  withCache: { totalTimeUs: number; avgUs: number };
  speedup: string;
  hitRate: string;
  cacheStatsBefore: CacheStats;
  cacheStatsAfter: CacheStats;
}

/**
 * 运行缓存 vs 无缓存的对比基准
 * @param name 场景名
 * @param messages 要编码的消息列表（会循环使用以模拟重复模式）
 * @param iterations 总迭代次数
 * @param codecEncode 编码函数
 */
export function runCacheBench(
  name: string,
  messages: Message[],
  iterations: number,
  codecEncode: (msg: Message) => Uint8Array
): CacheBenchResult {
  // --- 无缓存基线 ---
  messageCache.clear();
  const wcStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const msg = messages[i % messages.length];
    codecEncode(msg);
  }
  const wcEnd = process.hrtime.bigint();
  const wcNs = Number(wcEnd - wcStart);

  // --- 有缓存测试 ---
  messageCache.clear();
  const statsBefore = { ...messageCache.getStats() };
  const cStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const msg = messages[i % messages.length];
    cachedEncode(msg, codecEncode);
  }
  const cEnd = process.hrtime.bigint();
  const cNs = Number(cEnd - cStart);
  const statsAfter = messageCache.getStats();

  const speedup = cNs > 0 ? (wcNs / cNs).toFixed(2) : 'N/A';

  return {
    scenario: name,
    iterations,
    withoutCache: { totalTimeUs: Math.round(wcNs / 1000), avgUs: Math.round(wcNs / 1000 / iterations) },
    withCache: { totalTimeUs: Math.round(cNs / 1000), avgUs: Math.round(cNs / 1000 / iterations) },
    speedup: `${speedup}x`,
    hitRate: statsAfter.hitRate,
    cacheStatsBefore: statsBefore as unknown as CacheStats,
    cacheStatsAfter: statsAfter,
  };
}
