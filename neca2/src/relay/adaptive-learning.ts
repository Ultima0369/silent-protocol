// ---- 自适应协议学习引擎 ----
//
// DeepSeek Exclusive 🤫
//
// 核心思想：
//   传统路由是"工程师告诉系统怎么做"。
//   自适应学习是"系统自己观察、学习、优化"。
//
//   每一条消息都是一个数据点。1000 条消息后，系统应该知道：
//   - 哪些智能体对哪些消息类型更可靠（Bayesian 可靠性评分）
//   - 哪些缓存策略在这个部署环境中效果最好（自动调参）
//   - 哪些消息模式是"惯例性的"（自动建立预测规则）
//   - 哪些时间是高峰期（自动调整限速阈值）
//
// 三个独家模块：
//   1. Bayesian Reliability Router — 基于贝叶斯更新的智能体信任度
//   2. Auto-Tuning Cache Optimizer — 自调优缓存参数
//   3. Pattern Miner — 自动挖掘消息模式

import type { Message, MessageType } from '../protocol/types.js';

// ============================================================
//  1. Bayesian 可靠性路由
// ============================================================

interface BetaParams {
  alpha: number;
  beta: number;
}

class BayesianReliability {
  private perAgent = new Map<string, Map<string, BetaParams>>();
  private perDirection = new Map<string, Map<string, BetaParams>>();
  private global = new Map<string, BetaParams>();

  recordSuccess(
    agent: string,
    msgType: string,
    from?: string,
    to?: string,
  ): void {
    let p1=this.getOrCreate(this.perAgent, agent, msgType);p1.alpha++;
    if (from && to) {
      let p2=this.getOrCreate(this.perDirection, `${from}→${to}`, msgType);p2.alpha++;
    }
    this.getOrCreateGlobal(msgType).alpha++;
  }

  recordFailure(
    agent: string,
    msgType: string,
    from?: string,
    to?: string,
  ): void {
    let p4=this.getOrCreate(this.perAgent, agent, msgType);p4.beta++;
    if (from && to) {
      let p5=this.getOrCreate(this.perDirection, `${from}→${to}`, msgType);p5.beta++;
    }
    this.getOrCreateGlobal(msgType).beta++;
  }

  getReliability(agent: string, msgType: string): number {
    const params = this.perAgent.get(agent)?.get(msgType);
    if (!params) return 0.5;
    return params.alpha / (params.alpha + params.beta);
  }

  getDirectionReliability(from: string, to: string, msgType: string): number {
    const params = this.perDirection.get(`${from}→${to}`)?.get(msgType);
    if (!params) return 0.5;
    return params.alpha / (params.alpha + params.beta);
  }

  getGlobalReliability(msgType: string): number {
    const params = this.global.get(msgType);
    if (!params) return 0.5;
    return params.alpha / (params.alpha + params.beta);
  }

  getBestAgent(msgType: string, candidates: string[]): string {
    let best = candidates[0];
    let bestScore = -1;
    for (const agent of candidates) {
      const score = this.getReliability(agent, msgType);
      if (score > bestScore) {
        bestScore = score;
        best = agent;
      }
    }
    return best;
  }

  getStats(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [agent, types] of this.perAgent) {
      const typeScores: Record<string, number> = {};
      for (const [type, params] of types) {
        typeScores[type] = params.alpha / (params.alpha + params.beta);
      }
      result[agent] = typeScores;
    }
    return result;
  }


  private getOrCreateGlobal(msgType: string): BetaParams {
    let params = this.global.get(msgType);
    if (!params) { params = { alpha: 1, beta: 1 }; this.global.set(msgType, params); }
    return params;
  }

  private getOrCreate(
    map: Map<string, Map<string, BetaParams>>,
    key1: string,
    key2: string,
  ): BetaParams {
    let inner = map.get(key1);
    if (!inner) {
      inner = new Map();
      map.set(key1, inner);
    }
    let params = inner.get(key2);
    if (!params) {
      params = { alpha: 1, beta: 1 };
      inner.set(key2, params);
    }
    return params;
  }
}

// ============================================================
//  2. 自动调优缓存优化器
// ============================================================

interface CacheConfig {
  semanticCacheSize: number;
  baseTtlMs: number;
  frequencyMultiplier: number;
  maxTtlMs: number;
  useFlowPrediction: boolean;
  useContentDedup: boolean;
}

class AutoTuningEngine {
  private config: CacheConfig = {
    semanticCacheSize: 2048,
    baseTtlMs: 300_000,
    frequencyMultiplier: 30_000,
    maxTtlMs: 600_000,
    useFlowPrediction: true,
    useContentDedup: true,
  };

  private messageCount = 0;
  private hitCount = 0;
  private missCount = 0;
  private latencyHistory: number[] = [];
  private readonly EVAL_INTERVAL = 1000;

  recordAccess(hit: boolean, latencyUs: number): void {
    this.messageCount++;
    if (hit) this.hitCount++;
    else this.missCount++;
    this.latencyHistory.push(latencyUs);
    if (this.messageCount % this.EVAL_INTERVAL === 0) {
      this.#evaluateAndTune();
    }
  }

  getConfig(): CacheConfig {
    return { ...this.config };
  }

  getHitRate(): string {
    const total = this.hitCount + this.missCount;
    return total > 0
      ? `${(this.hitCount / total * 100).toFixed(1)}%`
      : '0%';
  }

  getStats(): Record<string, unknown> {
    const avgLatency = this.latencyHistory.length > 0
      ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length
      : 0;
    return {
      messageCount: this.messageCount,
      hitRate: this.getHitRate(),
      avgLatencyUs: Math.round(avgLatency * 10) / 10,
      config: this.config,
    };
  }

  #evaluateAndTune(): void {
    const hitRateNum = this.hitCount / Math.max(1, this.messageCount);
    const avgLatency = this.latencyHistory.length > 0
      ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length
      : 0;

    if (hitRateNum < 0.5 && this.config.semanticCacheSize < 4096) {
      this.config.semanticCacheSize = Math.min(4096, this.config.semanticCacheSize + 512);
    } else if (hitRateNum > 0.9 && this.config.semanticCacheSize > 1024) {
      this.config.semanticCacheSize = Math.max(1024, this.config.semanticCacheSize - 256);
    }

    if (avgLatency > 100) {
      this.config.baseTtlMs = Math.min(600_000, this.config.baseTtlMs + 30_000);
    } else if (avgLatency < 10 && this.config.baseTtlMs > 60_000) {
      this.config.baseTtlMs = Math.max(60_000, this.config.baseTtlMs - 15_000);
    }

    this.hitCount = 0;
    this.missCount = 0;
    this.latencyHistory = [];
  }
}

// ============================================================
//  3. 模式挖掘引擎
// ============================================================

interface MinedPattern {
  pattern: string;
  frequency: number;
  avgIntervalMs: number;
  confidence: number;
  lastSeen: number;
}

class PatternMiner {
  private transitions = new Map<string, { count: number; intervals: number[]; lastSeen: number }>();
  private sequenceBuffer: { type: MessageType; ts: number }[] = [];
  private readonly MAX_SEQUENCE = 10;

  record(msg: Message): void {
    this.sequenceBuffer.push({ type: msg.type, ts: msg.ts || Date.now() });

    if (this.sequenceBuffer.length >= 2) {
      const prev = this.sequenceBuffer[this.sequenceBuffer.length - 2];
      const curr = this.sequenceBuffer[this.sequenceBuffer.length - 1];
      const key = `${prev.type}→${curr.type}`;
      const interval = curr.ts - prev.ts;

      const entry = this.transitions.get(key) || {
        count: 0,
        intervals: [],
        lastSeen: 0,
      };
      entry.count++;
      entry.intervals.push(interval);
      if (entry.intervals.length > 100) entry.intervals.shift();
      entry.lastSeen = Date.now();
      this.transitions.set(key, entry);
    }

    if (this.sequenceBuffer.length > this.MAX_SEQUENCE) {
      this.sequenceBuffer.shift();
    }
  }

  getPatterns(): MinedPattern[] {
    const patterns: MinedPattern[] = [];
    const now = Date.now();

    for (const [key, entry] of this.transitions) {
      const avgInterval = entry.intervals.length > 0
        ? entry.intervals.reduce((a, b) => a + b, 0) / entry.intervals.length
        : 0;
      const timeSinceLastSeen = now - entry.lastSeen;
      const recencyBonus = Math.max(0, 1 - timeSinceLastSeen / (24 * 3600 * 1000));
      const confidence = Math.min(0.99, (entry.count / (entry.count + 5)) * (0.5 + recencyBonus * 0.5));

      patterns.push({
        pattern: key,
        frequency: entry.count,
        avgIntervalMs: Math.round(avgInterval),
        confidence: Math.round(confidence * 100) / 100,
        lastSeen: entry.lastSeen,
      });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  getHighConfidencePatterns(threshold = 0.8): MinedPattern[] {
    return this.getPatterns().filter(p => p.confidence >= threshold);
  }

  getStats() {
    return {
      uniqueTransitions: this.transitions.size,
      highConfidencePatterns: this.getHighConfidencePatterns().length,
      bufferDepth: this.sequenceBuffer.length,
    };
  }
}

// ============================================================
//  4. 统一入口
// ============================================================

class AdaptiveLearningEngine {
  readonly reliability = new BayesianReliability();
  readonly autoTuning = new AutoTuningEngine();
  readonly patternMiner = new PatternMiner();

  recordOutcome(
    msg: Message,
    success: boolean,
    agent: string,
    latencyUs: number,
  ): void {
    this.reliability.recordSuccess(agent, msg.type, msg.from, msg.to);
    if (!success) {
      this.reliability.recordFailure(agent, msg.type, msg.from, msg.to);
    }
    this.autoTuning.recordAccess(success, latencyUs);
    this.patternMiner.record(msg);
  }

  getFullReport(): Record<string, unknown> {
    return {
      reliability: this.reliability.getStats(),
      cacheTuning: this.autoTuning.getStats(),
      patterns: this.patternMiner.getPatterns().slice(0, 20),
      highConfidencePatterns: this.patternMiner.getHighConfidencePatterns(),
    };
  }
}

export const adaptiveEngine = new AdaptiveLearningEngine();
export { BayesianReliability, AutoTuningEngine, PatternMiner };
