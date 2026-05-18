// ---- 多模型路由调度器 ----
// 支持三种调度策略：RoundRobin、Priority、LeastLoaded。
//
// 设计原则：
//   1. 公平调度 — RR 确保所有模型平等使用
//   2. 优先级感知 — Priority 确保高优消息先处理
//   3. 负载感知 — LeastLoaded 将消息路由到最空闲的模型
//   4. 可扩展 — 新增调度策略只需实现 Scheduler 接口

import type { Message, AgentId } from '../protocol/types.js';

// ---- 调度策略枚举 ----

export type SchedulerStrategy = 'round-robin' | 'priority' | 'least-loaded';

// ---- 模型端点定义 ----

export interface ModelEndpoint {
  /** 模型标识（如 'claude-sonnet-4', 'deepseek-chat'） */
  name: string;
  /** 对应的 agent 目标 */
  target: string;
  /** 当前负载（并发请求数） */
  load: number;
  /** 最大并发数 */
  maxConcurrency: number;
  /** 权重（用于 Priority 调度） */
  weight: number;
  /** 是否可用 */
  available: boolean;
  /** 最近平均延迟（ms） */
  avgLatencyMs: number;
  /** 错误计数 */
  errorCount: number;
}

// ---- 调度器接口 ----

export interface Scheduler {
  /** 选择一个模型端点来处理消息 */
  select(endpoints: ModelEndpoint[], msg: Message): ModelEndpoint | null;
  /** 策略名称 */
  readonly strategy: SchedulerStrategy;
}

// ============================================================
// RoundRobin — 轮询调度
// ============================================================

class RoundRobinScheduler implements Scheduler {
  readonly strategy = 'round-robin' as const;
  private index = 0;

  select(endpoints: ModelEndpoint[], _msg: Message): ModelEndpoint | null {
    const available = endpoints.filter(e => e.available && e.load < e.maxConcurrency);
    if (available.length === 0) return null;

    // 从上一次的位置继续轮询
    const start = this.index % available.length;
    const selected = available[start];
    this.index = (start + 1) % available.length;
    return selected;
  }

  /** 重置轮询位置 */
  reset(): void { this.index = 0; }
}

// ============================================================
// Priority — 优先级调度
// ============================================================

class PriorityScheduler implements Scheduler {
  readonly strategy = 'priority' as const;

  select(endpoints: ModelEndpoint[], msg: Message): ModelEndpoint | null {
    const available = endpoints.filter(e => e.available && e.load < e.maxConcurrency);
    if (available.length === 0) return null;

    // 权重越高，选择概率越大（加权随机）
    const msgPriority = msg.priority === 'high' ? 2 : msg.priority === 'low' ? 0 : 1;

    // 高优先级的消息选择权重最高的模型
    if (msgPriority >= 2) {
      const sorted = [...available].sort((a, b) => b.weight - a.weight);
      return sorted[0];
    }

    // 普通/低优先级：加权随机选择
    const totalWeight = available.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;
    for (const ep of available) {
      random -= ep.weight;
      if (random <= 0) return ep;
    }
    return available[available.length - 1];
  }
}

// ============================================================
// LeastLoaded — 最少负载调度
// ============================================================

class LeastLoadedScheduler implements Scheduler {
  readonly strategy = 'least-loaded' as const;

  select(endpoints: ModelEndpoint[], msg: Message): ModelEndpoint | null {
    const available = endpoints.filter(e => e.available && e.load < e.maxConcurrency);
    if (available.length === 0) return null;

    // 选择负载率最低的模型
    // 负载率 = load / maxConcurrency
    const sorted = [...available].sort((a, b) => {
      const ratioA = a.load / a.maxConcurrency;
      const ratioB = b.load / b.maxConcurrency;
      if (ratioA !== ratioB) return ratioA - ratioB;
      // 负载率相同，选延迟低的
      return a.avgLatencyMs - b.avgLatencyMs;
    });

    return sorted[0];
  }
}

// ============================================================
// 调度管理器
// ============================================================

export class SchedulerManager {
  private schedulers: Map<SchedulerStrategy, Scheduler>;
  private currentStrategy: SchedulerStrategy;
  private endpoints: Map<string, ModelEndpoint> = new Map();

  constructor() {
    this.schedulers = new Map();
    this.schedulers.set('round-robin', new RoundRobinScheduler());
    this.schedulers.set('priority', new PriorityScheduler());
    this.schedulers.set('least-loaded', new LeastLoadedScheduler());
    this.currentStrategy = 'round-robin';

    // 注册默认端点
    this.registerEndpoint({
      name: 'claude-sonnet-4',
      target: 'cloud_claude',
      load: 0,
      maxConcurrency: 2,
      weight: 10,
      available: true,
      avgLatencyMs: 0,
      errorCount: 0,
    });
    this.registerEndpoint({
      name: 'deepseek-chat',
      target: 'cloud_ds',
      load: 0,
      maxConcurrency: 2,
      weight: 8,
      available: true,
      avgLatencyMs: 0,
      errorCount: 0,
    });
    this.registerEndpoint({
      name: 'local-claude-code',
      target: 'local_claude',
      load: 0,
      maxConcurrency: 4,
      weight: 6,
      available: true,
      avgLatencyMs: 0,
      errorCount: 0,
    });
  }

  /** 注册/更新一个模型端点 */
  registerEndpoint(ep: ModelEndpoint): void {
    this.endpoints.set(ep.name, ep);
  }

  /** 获取指定名称的端点 */
  getEndpoint(name: string): ModelEndpoint | undefined {
    return this.endpoints.get(name);
  }

  /** 获取所有端点 */
  getAllEndpoints(): ModelEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /** 更新端点负载 */
  updateLoad(name: string, load: number): void {
    const ep = this.endpoints.get(name);
    if (ep) {
      ep.load = Math.max(0, load);
      ep.available = ep.load < ep.maxConcurrency * 0.9;
    }
  }

  /** 记录一次成功调用 */
  recordSuccess(name: string, latencyMs: number): void {
    const ep = this.endpoints.get(name);
    if (ep) {
      ep.avgLatencyMs = ep.avgLatencyMs === 0
        ? latencyMs
        : ep.avgLatencyMs * 0.8 + latencyMs * 0.2; // EMA
    }
  }

  /** 记录一次失败 */
  recordFailure(name: string): void {
    const ep = this.endpoints.get(name);
    if (ep) {
      ep.errorCount++;
      ep.available = ep.errorCount < 5; // 连续 5 次错误标记不可用
    }
  }

  /** 重置错误计数（恢复可用性） */
  resetErrors(name: string): void {
    const ep = this.endpoints.get(name);
    if (ep) {
      ep.errorCount = 0;
      ep.available = true;
    }
  }

  /** 切换调度策略 */
  setStrategy(strategy: SchedulerStrategy): void {
    this.currentStrategy = strategy;
  }

  /** 获取当前策略 */
  get currentStrategyName(): SchedulerStrategy {
    return this.currentStrategy;
  }

  /** 选择一个端点来处理消息 */
  selectFor(msg: Message): ModelEndpoint | null {
    const scheduler = this.schedulers.get(this.currentStrategy);
    if (!scheduler) return null;
    return scheduler.select(this.getAllEndpoints(), msg);
  }

  /** 获取所有可用调度策略 */
  get availableStrategies(): SchedulerStrategy[] {
    return Array.from(this.schedulers.keys());
  }

  /** 调度统计 */
  getStats() {
    return {
      strategy: this.currentStrategy,
      endpoints: this.getAllEndpoints().map(ep => ({
        name: ep.name,
        target: ep.target,
        load: ep.load,
        maxConcurrency: ep.maxConcurrency,
        available: ep.available,
        avgLatencyMs: Math.round(ep.avgLatencyMs),
        errorCount: ep.errorCount,
        loadRatio: `${Math.round((ep.load / ep.maxConcurrency) * 100)}%`,
      })),
    };
  }
}

/** 全局调度器实例 */
export const schedulerManager = new SchedulerManager();
