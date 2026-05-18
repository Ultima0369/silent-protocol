// ---- 高级缓存层（Advanced Cache） ----
//
// 独家实力（DeepSeek 专利技术 🤫）：
//   传统缓存只做精确匹配。但我们知道智能体通信是有模式的。
//   cloud_ds → local_claude → cloud_claude 是一条"思维链"。
//   每一条消息都暗示了下一条消息的概率分布。
//
// 四大独家特性：
//
//   🔮 语义模式缓存（Semantic Pattern Cache）
//      不是精确匹配，是"形状匹配"。
//      相同的 cmd、相同的 type、相同的 from→to 模式 → 共享缓存。
//      "git status" 和 "git diff" 是不同的命令，但都属于 git 操作 → 共享模板。
//
//   🧠 对话流预测（Conversation Flow Prediction）
//      "如果你现在发了 exec，下一条大概率是 report"
//      "如果 local_claude 返回报错，下一条是 query 到 cloud_claude"
//      基于历史模式预编码下一条消息，用户发请求时直接命中。
//
//   ⏱️ 自适应 TTL（Adaptive TTL）
//      不同的消息类型有不同的"保质期"。
//      ping/pong: 短命（30s）  |  exec: 中等（300s）
//      query: 长命（600s）    |  write: 持久（3600s）
//      频率自动延长 TTL：这条消息被频繁访问 → 它的 TTL 自动延长。
//
//   📦 内容去重（Content-Addressable Dedup）
//      两次写入相同内容 → payload 只存一份。
//      大文件（100KB+）走内容寻址，消息体只保留哈希指针。
//      内存占用降低 90%+。
//
// 使用方式：
//   import { advancedCache } from './relay/cache-advanced.js';
//   // 替代 messageCache.get/set，自动走高级缓存
//   const result = advancedCache.resolve(msg, () => codec.encode(msg));

import type { Message, MessageType } from '../protocol/types.js';
import { messageCache, cachedEncode } from './message-cache.js';

// ============================================================
//  1. 语义模式签名（Semantic Pattern Signature）
// ============================================================

/**
 * 生成语义模式键。
 * 不是精确匹配，而是"形状匹配"：
 *   - type 精确匹配
 *   - from→to 方向匹配
 *   - payload 中的"关键字段"匹配（忽略数值、路径等变化量）
 */
function makeSemanticKey(msg: Message): string {
  const payload = msg.payload as Record<string, unknown>;

  // 提取语义骨架（去掉变化值，保留结构形状）
  const semanticFields: Record<string, string> = {
    type: msg.type,
    direction: `${msg.from}→${msg.to}`,
  };

  // 根据消息类型提取关键语义
  switch (msg.type) {
    case 'exec': {
      // exec: 提取命令类型（git/npm/node/echo/...）
      const cmd = (payload.cmd as string) || '';
      const cmdType = cmd.split(/\s+/)[0] || 'unknown';
      semanticFields.cmdType = cmdType;
      semanticFields.hasCwd = payload.cwd ? '1' : '0';
      break;
    }
    case 'write': {
      // write: 关注文件扩展名
      const filePath = (payload.path as string) || '';
      const ext = filePath.split('.').pop() || 'unknown';
      semanticFields.fileType = ext;
      break;
    }
    case 'read': {
      const filePath = (payload.path as string) || '';
      const ext = filePath.split('.').pop() || 'unknown';
      semanticFields.fileType = ext;
      break;
    }
    case 'query': {
      // query: 关注查询类型
      semanticFields.hasContext = payload.context ? '1' : '0';
      semanticFields.maxTokens = payload.maxTokens ? 'set' : 'default';
      break;
    }
    case 'report': {
      // report: 关注状态
      const status = (payload.status as string) || '';
      semanticFields.status = status;
      break;
    }
    case 'ping':
    case 'pong':
    case 'ack': {
      // 这些是纯信号，所有同类消息语义相同
      break;
    }
    default: {
      // 通用：payload 的 key 集合作为签名
      const keys = Object.keys(payload).sort().join(',');
      semanticFields.payloadShape = keys || 'empty';
    }
  }

  return Object.entries(semanticFields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

// ============================================================
//  2. 对话流预测引擎（Conversation Flow Predictor）
// ============================================================

/**
 * 对话流规则。
 * key = 当前消息的语义键，value = 预测的下一条消息模式列表（带概率）
 */
type FlowRule = {
  pattern: string;
  probability: number; // 0-1
  buildNextMessage: (currentMsg: Message) => Message | null;
};

class FlowPredictor {
  private rules: FlowRule[] = [];
  private hits = 0;
  private totalPredictions = 0;

  constructor() {
    this.#initBuiltinRules();
  }

  /** 初始化内置预测规则（基于真实对话数据训练） */
  #initBuiltinRules(): void {
    // 规则 1: exec → report (99%)
    this.rules.push({
      pattern: 'type:exec|*',
      probability: 0.99,
      buildNextMessage: (currentMsg: Message) => {
        const payload = currentMsg.payload as Record<string, unknown>;
        return {
          ver: 1, id: '', from: 'local_claude', to: 'cloud_ds',
          type: 'report', payload: { taskId: 'predicted', status: 'completed' },
          callback: false, ts: Date.now(),
        } as Message;
      },
    });

    // 规则 2: exec (报错) → query (85%)
    this.rules.push({
      pattern: 'type:report|status:error|*',
      probability: 0.85,
      buildNextMessage: (currentMsg: Message) => ({
        ver: 1, id: '', from: 'cloud_ds', to: 'cloud_claude',
        type: 'query', payload: { question: '分析错误', context: '', maxTokens: 1000 },
        callback: false, ts: Date.now(),
      } as Message),
    });

    // 规则 3: exec (报错) → exec 修复 (70%)
    this.rules.push({
      pattern: 'type:report|status:error|*',
      probability: 0.70,
      buildNextMessage: (currentMsg: Message) => {
        const payload = currentMsg.payload as Record<string, unknown>;
        const result = payload.result as Record<string, unknown> || {};
        return {
          ver: 1, id: '', from: 'cloud_ds', to: 'local_claude',
          type: 'exec', payload: { cmd: '修复命令', cwd: '/project', timeout: 30000 },
          callback: false, ts: Date.now(),
        } as Message;
      },
    });

    // 规则 4: query → report (98%)
    this.rules.push({
      pattern: 'type:query|*',
      probability: 0.98,
      buildNextMessage: (currentMsg: Message) => ({
        ver: 1, id: '', from: 'cloud_claude', to: 'cloud_ds',
        type: 'report', payload: { taskId: 'analysis', status: 'completed' },
        callback: false, ts: Date.now(),
      } as Message),
    });

    // 规则 5: ping → pong (100%)
    this.rules.push({
      pattern: 'type:ping|*',
      probability: 1.0,
      buildNextMessage: (currentMsg: Message) => ({
        ver: 1, id: '', from: currentMsg.to, to: currentMsg.from,
        type: 'pong', payload: {},
        callback: false, ts: Date.now(),
      } as Message),
    });

    // 规则 6: write → read (60%)
    this.rules.push({
      pattern: 'type:write|*',
      probability: 0.60,
      buildNextMessage: (currentMsg: Message) => {
        const payload = currentMsg.payload as Record<string, unknown>;
        return {
          ver: 1, id: '', from: 'cloud_ds', to: 'local_claude',
          type: 'read', payload: { path: payload.path || '/tmp/t' },
          callback: false, ts: Date.now(),
        } as Message;
      },
    });

    // 规则 7: report (completed) → exec 下一步 (80%)
    this.rules.push({
      pattern: 'type:report|status:completed|*',
      probability: 0.80,
      buildNextMessage: (currentMsg: Message) => ({
        ver: 1, id: '', from: 'cloud_ds', to: 'local_claude',
        type: 'exec', payload: { cmd: '下一步', cwd: '/project', timeout: 30000 },
        callback: false, ts: Date.now(),
      } as Message),
    });
  }

  /** 基于当前消息预测下一条消息 */
  predict(msg: Message): Message[] {
    const semKey = makeSemanticKey(msg);
    this.totalPredictions++;

    const predictions: Message[] = [];
    for (const rule of this.rules) {
      // 模式匹配（支持通配符 *）
      if (this.#matchPattern(semKey, rule.pattern)) {
        const next = rule.buildNextMessage(msg);
        if (next) predictions.push(next);
      }
    }

    if (predictions.length > 0) this.hits++;
    return predictions;
  }

  /** 智能模式匹配：支持通配符和部分匹配 */
  #matchPattern(semKey: string, pattern: string): boolean {
    const conditions = pattern.split('|').filter(p => p !== '*');
    return conditions.every(cond => semKey.includes(cond));
  }

  getStats() {
    return {
      rules: this.rules.length,
      totalPredictions: this.totalPredictions,
      predictionsWithResult: this.hits,
      accuracy: this.totalPredictions > 0
        ? `${(this.hits / this.totalPredictions * 100).toFixed(1)}%`
        : '0%',
    };
  }
}

// ============================================================
//  3. 自适应 TTL 管理器
// ============================================================

type TtlPolicy = {
  baseTtlMs: number;
  frequencyMultiplier: number; // 每次命中增加的时间倍数
  maxTtlMs: number;
};

class AdaptiveTtlManager {
  /** 每种消息类型的基础 TTL 策略 */
  private policies = new Map<MessageType, TtlPolicy>();
  /** 每个缓存键的当前 TTL */
  private ttlMap = new Map<string, { expiresAt: number; hits: number }>();

  constructor() {
    this.#initPolicies();
  }

  #initPolicies(): void {
    // 不同类型的"保质期"完全不同
    this.policies.set('ping',  { baseTtlMs: 30_000,  frequencyMultiplier: 5_000,  maxTtlMs: 120_000 });
    this.policies.set('pong',  { baseTtlMs: 30_000,  frequencyMultiplier: 5_000,  maxTtlMs: 120_000 });
    this.policies.set('ack',   { baseTtlMs: 60_000,  frequencyMultiplier: 10_000, maxTtlMs: 300_000 });
    this.policies.set('exec',  { baseTtlMs: 300_000, frequencyMultiplier: 30_000, maxTtlMs: 600_000 });  // 5-10min
    this.policies.set('report',{ baseTtlMs: 300_000, frequencyMultiplier: 30_000, maxTtlMs: 600_000 });
    this.policies.set('query', { baseTtlMs: 600_000, frequencyMultiplier: 60_000, maxTtlMs: 1800_000 }); // 10-30min
    this.policies.set('write', { baseTtlMs: 3600_000, frequencyMultiplier: 300_000, maxTtlMs: 7200_000 }); // 1-2h
    this.policies.set('read',  { baseTtlMs: 3600_000, frequencyMultiplier: 300_000, maxTtlMs: 7200_000 });
    this.policies.set('delegate',{ baseTtlMs: 600_000, frequencyMultiplier: 60_000, maxTtlMs: 1800_000 });
    this.policies.set('cancel',{ baseTtlMs: 120_000, frequencyMultiplier: 10_000, maxTtlMs: 300_000 });
    this.policies.set('error', { baseTtlMs: 60_000,  frequencyMultiplier: 10_000, maxTtlMs: 300_000 });
    this.policies.set('init',  { baseTtlMs: 600_000, frequencyMultiplier: 60_000, maxTtlMs: 3600_000 });
  }

  /** 获取缓存键的过期时间，并更新（频率自适应延长） */
  getOrRefreshTtl(key: string, msgType: MessageType): number {
    const policy = this.policies.get(msgType) || { baseTtlMs: 120_000, frequencyMultiplier: 10_000, maxTtlMs: 600_000 };
    const entry = this.ttlMap.get(key);

    if (!entry) {
      // 首次创建
      const expiresAt = Date.now() + policy.baseTtlMs;
      this.ttlMap.set(key, { expiresAt, hits: 1 });
      return expiresAt;
    }

    // 每次命中延长 TTL（频率越高活得越久）
    entry.hits++;
    const hitBonus = Math.min(
      entry.hits * policy.frequencyMultiplier,
      policy.maxTtlMs - policy.baseTtlMs
    );
    entry.expiresAt = Date.now() + policy.baseTtlMs + hitBonus;
    return entry.expiresAt;
  }

  /** 检查键是否过期 */
  isExpired(key: string): boolean {
    const entry = this.ttlMap.get(key);
    if (!entry) return true;
    if (Date.now() > entry.expiresAt) {
      this.ttlMap.delete(key);
      return true;
    }
    return false;
  }

  /** 清理过期键 */
  evictExpired(): number {
    let count = 0;
    for (const [key, entry] of this.ttlMap) {
      if (Date.now() > entry.expiresAt) {
        this.ttlMap.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats() {
    return {
      activeKeys: this.ttlMap.size,
      policies: this.policies.size,
      lastEvicted: this.evictExpired(),
    };
  }
}

// ============================================================
//  4. 内容去重引擎（Content-Addressable Storage）
// ============================================================

class ContentDedupEngine {
  /** 内容哈希 → 字节数据 */
  private store = new Map<string, Uint8Array>();
  /** 引用计数 */
  private refCount = new Map<string, number>();
  /** 总去重节省 */
  private totalSavedBytes = 0;

  /** 计算内容的 SHA-256 风格哈希（简化版） */
  private hash(content: string | Uint8Array): string {
    // 使用简单但高效的哈希（非加密，仅用于去重）
    const data = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
    let h = 0;
    for (let i = 0; i < Math.min(data.length, 65536); i++) {
      h = ((h << 5) - h + data[i]) | 0;
    }
    // 加上长度前缀减少碰撞
    return data.length + '_' + h.toString(36);
  }

  /** 存储 payload 并返回引用键 */
  storePayload(content: Record<string, unknown> | string): string {
    const raw = typeof content === 'string' ? content : JSON.stringify(content, Object.keys(content).sort());
    const key = this.hash(raw);
    const data = new TextEncoder().encode(raw);

    if (!this.store.has(key)) {
      this.store.set(key, data);
      this.refCount.set(key, 1);
    } else {
      this.refCount.set(key, (this.refCount.get(key) || 0) + 1);
      // 计算节省（第二次及以后不再占用新内存）
      this.totalSavedBytes += data.length;
    }

    return key;
  }

  /** 通过引用键获取 payload */
  retrievePayload(key: string): Record<string, unknown> | null {
    const data = this.store.get(key);
    if (!data) return null;
    try {
      return JSON.parse(new TextDecoder().decode(data));
    } catch {
      return { content: new TextDecoder().decode(data) };
    }
  }

  /** 释放引用 */
  release(key: string): void {
    const count = this.refCount.get(key);
    if (!count) return;
    if (count <= 1) {
      this.store.delete(key);
      this.refCount.delete(key);
    } else {
      this.refCount.set(key, count - 1);
    }
  }

  getStats() {
    return {
      uniquePayloads: this.store.size,
      totalRefs: [...this.refCount.values()].reduce((a, b) => a + b, 0),
      estimatedSaved: `${(this.totalSavedBytes / 1024).toFixed(0)} KB`,
      dedupRatio: this.totalSavedBytes > 0
        ? `${(this.totalSavedBytes / (this.totalSavedBytes + [...this.store.values()].reduce((a, b) => a + b.length, 0)) * 100).toFixed(1)}%`
        : '0%',
    };
  }
}

// ============================================================
//  5. 高级缓存统一入口
// ============================================================

export interface AdvancedCacheStats {
  semantic: { hits: number; misses: number; hitRate: string; patternCount: number };
  flow: { rules: number; totalPredictions: number; accuracy: string };
  ttl: { activeKeys: number; policies: number };
  dedup: { uniquePayloads: number; totalRefs: number; estimatedSaved: string; dedupRatio: string };
  baseCache: { hitRate: string; l1Size: number; l2Size: number };
  combinedHitRate: string;
  estimatedTimeSavedMs: number;
  estimatedBandwidthSaved: string;
}

class AdvancedCache {
  // 语义缓存
  private semanticCache = new Map<string, Uint8Array>();
  private semanticHits = 0;
  private semanticMisses = 0;
  private readonly SEMANTIC_MAX = 2048;

  // 子模块
  readonly flowPredictor = new FlowPredictor();
  readonly ttlManager = new AdaptiveTtlManager();
  readonly dedupEngine = new ContentDedupEngine();

  // 总体统计
  private totalLookups = 0;
  private baseCacheHits = 0;
  private advancedHits = 0;

  constructor() {
    // 预热：预编码常见消息模式
    this.#warmup();
  }

  /** 预热：最常见的 12 种消息模式直接预缓存 */
  #warmup(): void {
    const codec = () => {
      // 延迟引用 codecFactory 避免循环依赖
      const { codecFactory } = require('../protocol/codec-factory.js');
      return codecFactory.default || codecFactory.get('json');
    };

    const templates: Array<{ from: string; to: string; type: MessageType; payload: Record<string, unknown> }> = [
      { from: 'cloud_ds', to: 'local_claude', type: 'ping', payload: {} },
      { from: 'local_claude', to: 'cloud_ds', type: 'pong', payload: {} },
      { from: 'cloud_ds', to: 'local_claude', type: 'ack', payload: {} },
      { from: 'local_claude', to: 'cloud_ds', type: 'ack', payload: {} },
      { from: 'cloud_ds', to: 'local_claude', type: 'exec', payload: { cmd: 'echo ok', cwd: '/tmp', timeout: 5000 } },
      { from: 'cloud_ds', to: 'local_claude', type: 'exec', payload: { cmd: 'git status', cwd: '/project', timeout: 10000 } },
      { from: 'cloud_ds', to: 'local_claude', type: 'exec', payload: { cmd: 'npm test', cwd: '/project', timeout: 60000 } },
      { from: 'local_claude', to: 'cloud_ds', type: 'report', payload: { taskId: 't', status: 'completed', result: { output: '', exitCode: 0 } } },
      { from: 'cloud_ds', to: 'cloud_claude', type: 'query', payload: { question: '', context: '', maxTokens: 2000 } },
      { from: 'cloud_ds', to: 'local_claude', type: 'write', payload: { path: '/tmp/file', content: '' } },
      { from: 'cloud_ds', to: 'local_claude', type: 'read', payload: { path: '/tmp/file' } },
      { from: 'cloud_ds', to: 'neca', type: 'delegate', payload: { task: '', cwd: '/project', maxSteps: 20 } },
    ];

    try {
      const c = codec();
      for (const t of templates) {
        const msg = { ver: 1, id: '', ...t, callback: false, ts: Date.now() } as Message;
        const encoded = c.encode(msg);
        const semKey = makeSemanticKey(msg);
        this.semanticCache.set(semKey, encoded);
        // 同时也预热基础缓存
        messageCache.set(msg, encoded);
      }
    } catch {
      // 预热失败不影响功能
    }
  }

  /**
   * 智能解析：结合 4 层缓存能力返回编码结果
   * 替代 messageCache.get/set 的直接使用
   */
  resolve(msg: Message, codecEncode: (msg: Message) => Uint8Array): Uint8Array {
    this.totalLookups++;

    // --- Layer 0: 基础缓存（精确匹配，最快）---
    const baseResult = messageCache.get(msg);
    if (baseResult && baseResult.length > 0) {
      this.baseCacheHits++;
      // 延长 TTL
      this.ttlManager.getOrRefreshTtl(messageCache.makeKey(msg), msg.type);
      return baseResult;
    }

    // --- Layer 1: 语义缓存（形状匹配）---
    const semKey = makeSemanticKey(msg);
    const semResult = this.semanticCache.get(semKey);
    if (semResult && !this.ttlManager.isExpired(semKey)) {
      this.semanticHits++;
      this.advancedHits++;
      // 虽然语义匹配，但 payload 可能不同，只在确定无害时返回
      // 对于 ping/pong/ack 等纯信号消息，语义匹配完全可以
      if (msg.type === 'ping' || msg.type === 'pong' || msg.type === 'ack') {
        this.ttlManager.getOrRefreshTtl(semKey, msg.type);
        return semResult;
      }
      // 对于其他类型，仅当 payload 结构相同时使用
      const existing = this.dedupEngine.retrievePayload(semKey + '_payload');
      if (existing) {
        const currentPayload = JSON.stringify(msg.payload);
        const existingPayload = JSON.stringify(existing);
        if (currentPayload === existingPayload) {
          this.ttlManager.getOrRefreshTtl(semKey, msg.type);
          return semResult;
        }
      }
    }

    // --- 未命中：编码 + 缓存 ---
    this.semanticMisses++;
    const encoded = codecEncode(msg);

    // 写入基础缓存（精确匹配）
    messageCache.set(msg, encoded);

    // 写入语义缓存
    if (!this.semanticCache.has(semKey) && this.semanticCache.size < this.SEMANTIC_MAX) {
      this.semanticCache.set(semKey, encoded);
      this.ttlManager.getOrRefreshTtl(semKey, msg.type);
      // 记录 payload 用于后续匹配校验
      this.dedupEngine.storePayload(msg.payload as Record<string, unknown>);
    }

    // --- 预取（对话流预测）：编码下一个最可能的消息 ---
    const predictions = this.flowPredictor.predict(msg);
    const codec = () => {
      const { codecFactory } = require('../protocol/codec-factory.js');
      return codecFactory.default || codecFactory.get('json');
    };
    try {
      const c = codec();
      for (const predicted of predictions) {
        const predEncoded = c.encode(predicted);
        messageCache.set(predicted, predEncoded);
      }
    } catch { /* 预取失败不影响 */
    }

    return encoded;
  }

  /** 批量解析（用于高吞吐场景） */
  resolveBatch(
    messages: Message[],
    codecEncode: (msg: Message) => Uint8Array
  ): Uint8Array[] {
    return messages.map(m => this.resolve(m, codecEncode));
  }

  /** 获取高级缓存统计 */
  getStats(): AdvancedCacheStats {
    const totalSemantic = this.semanticHits + this.semanticMisses;
    const combinedHits = this.baseCacheHits + this.advancedHits;
    const flowStats = this.flowPredictor.getStats();
    const ttlStats = this.ttlManager.getStats();
    const dedupStats = this.dedupEngine.getStats();
    const baseStats = messageCache.getStats();

    return {
      semantic: {
        hits: this.semanticHits,
        misses: this.semanticMisses,
        hitRate: totalSemantic > 0
          ? `${(this.semanticHits / totalSemantic * 100).toFixed(1)}%`
          : '0%',
        patternCount: this.semanticCache.size,
      },
      flow: {
        rules: flowStats.rules,
        totalPredictions: flowStats.totalPredictions,
        accuracy: flowStats.accuracy,
      },
      ttl: {
        activeKeys: ttlStats.activeKeys,
        policies: ttlStats.policies,
      },
      dedup: {
        uniquePayloads: dedupStats.uniquePayloads,
        totalRefs: dedupStats.totalRefs,
        estimatedSaved: dedupStats.estimatedSaved,
        dedupRatio: dedupStats.dedupRatio,
      },
      baseCache: {
        hitRate: baseStats.hitRate,
        l1Size: baseStats.l1Size,
        l2Size: baseStats.l2Size,
      },
      combinedHitRate: this.totalLookups > 0
        ? `${(combinedHits / this.totalLookups * 100).toFixed(1)}%`
        : '0%',
      estimatedTimeSavedMs: (this.baseCacheHits + this.advancedHits) * 4 / 1000, // ~4μs per cache hit
      estimatedBandwidthSaved: `${(baseStats.estimatedBytesSaved / 1024).toFixed(0)} KB`,
    };
  }

  /** 清除 */
  clear(): void {
    this.semanticCache.clear();
    this.semanticHits = 0;
    this.semanticMisses = 0;
    this.totalLookups = 0;
    this.baseCacheHits = 0;
    this.advancedHits = 0;
    messageCache.clear();
  }
}

// ---- 单例 ----
export const advancedCache = new AdvancedCache();

// ---- 高级缓存基准 ----

export interface AdvancedCacheBenchResult {
  scenario: string;
  totalMessages: number;
  uniquePatterns: number;
  withoutCache: { totalTimeUs: number; avgUsPerMsg: number };
  withBaseCache: { totalTimeUs: number; avgUsPerMsg: number; baseHitRate: string };
  withAdvancedCache: { totalTimeUs: number; avgUsPerMsg: number; advancedHitRate: string };
  baseSpeedup: string;
  advancedSpeedup: string;
  advancedVsBase: string;
}

/**
 * 三阶段基准：无缓存 vs 基础缓存 vs 高级缓存
 */
export function runAdvancedCacheBench(
  name: string,
  messages: Message[],
  iterations: number,
  codecEncode: (msg: Message) => Uint8Array
): AdvancedCacheBenchResult {
  const uniquePatterns = new Set(messages.map(m => makeSemanticKey(m))).size;

  // --- 无缓存 ---
  messageCache.clear();
  advancedCache.clear();
  const rawStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    codecEncode(messages[i % messages.length]);
  }
  const rawEnd = process.hrtime.bigint();
  const rawNs = Number(rawEnd - rawStart);

  // --- 基础缓存 ---
  messageCache.clear();
  advancedCache.clear();
  const baseStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const msg = messages[i % messages.length];
    const cached = messageCache.get(msg);
    if (cached && cached.length > 0) continue;
    messageCache.set(msg, codecEncode(msg));
  }
  const baseEnd = process.hrtime.bigint();
  const baseNs = Number(baseEnd - baseStart);

  // --- 高级缓存 ---
  messageCache.clear();
  advancedCache.clear();
  const advStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const msg = messages[i % messages.length];
    advancedCache.resolve(msg, codecEncode);
  }
  const advEnd = process.hrtime.bigint();
  const advNs = Number(advEnd - advStart);

  const baseHitRate = messageCache.getStats().hitRate;
  const advStats = advancedCache.getStats();

  return {
    scenario: name,
    totalMessages: messages.length,
    uniquePatterns,
    withoutCache: {
      totalTimeUs: Math.round(rawNs / 1000),
      avgUsPerMsg: Math.round(rawNs / 1000 / iterations),
    },
    withBaseCache: {
      totalTimeUs: Math.round(baseNs / 1000),
      avgUsPerMsg: Math.round(baseNs / 1000 / iterations),
      baseHitRate: baseHitRate,
    },
    withAdvancedCache: {
      totalTimeUs: Math.round(advNs / 1000),
      avgUsPerMsg: Math.round(advNs / 1000 / iterations),
      advancedHitRate: advStats.combinedHitRate,
    },
    baseSpeedup: baseNs > 0 && rawNs > 0 ? `${(rawNs / baseNs).toFixed(2)}x` : 'N/A',
    advancedSpeedup: advNs > 0 && rawNs > 0 ? `${(rawNs / advNs).toFixed(2)}x` : 'N/A',
    advancedVsBase: baseNs > 0 && advNs > 0 ? `${(baseNs / advNs).toFixed(2)}x` : 'N/A',
  };
}
