// ---- 元编排层：时序协调·元感知·元认知 ----
//
// 这层不做"监控告警"那种传统 observability。
// 它做三件具体的事：
//
// 1. 时序协调（Timing Coordination）
//    三角中每个实体有自己的频率：云端 DS ≈200ms 延迟，
//    本地 spawn ≈秒级，Claude API ≈数秒。编排层维护
//    一张"时序地图"，知道每个消息该走多快、在谁那儿堵了。
//
// 2. 元感知（Self-Perception / Reflexive Model）
//    系统持有自身的一份显式模型：每个 Agent 的能力、
//    当前负载、历史响应时间、可用性。不靠猜，靠埋点。
//
// 3. 元认知（Meta-Cognition / Adaptive Control）
//    基于历史数据调整行为：如果 relay 慢了就少发 query，
//    如果本地 spawn 排队了就降并发，如果某类错误率高了
//    就走备用路径。
//
// 工程实现对应：
//   - MAPE-K 控制环（Monitor → Analyze → Plan → Execute over Knowledge）
//   - OpenTelemetry 风格的 Span/Trace 结构（但不依赖 OTel 库）
//   - 自适应速率限制（Adaptive Rate Limiting）
//   - 断路器模式（Circuit Breaker）
//   - 时序预算跟踪（Latency Budget Tracking）

import type { Message, SessionRecord, SessionStatus } from '../protocol/types.js';

// ============================================================
// 1. 时序追踪（Trace）
// ============================================================
// 每个消息从创建到完成，记录每个阶段的时间戳。
// 这使得我们可以回答："时间花在哪儿了？"

export interface TraceSpan {
  name: string;           // 阶段名: 'route' | 'spawn' | 'relay_claude' | 'relay_ds' | 'exec' | 'queue'
  startedAt: number;      // 开始时间（毫秒时间戳）
  endedAt?: number;       // 结束时间
  durationMs?: number;    // 耗时（计算得出）
  status: 'ok' | 'error' | 'timeout';
  detail?: string;        // 额外信息
}

export interface Trace {
  messageId: string;
  spans: TraceSpan[];
  createdAt: number;
  completedAt?: number;
  totalDurationMs?: number;
}

const traces = new Map<string, Trace>();
const MAX_TRACES = 1000;

export function startTrace(messageId: string): Trace {
  // 上限保护
  if (traces.size >= MAX_TRACES) {
    const oldest = Array.from(traces.entries())
      .sort(([, a], [, b]) => a.createdAt - b.createdAt)[0];
    if (oldest) traces.delete(oldest[0]);
  }
  const trace: Trace = { messageId, spans: [], createdAt: Date.now() };
  traces.set(messageId, trace);
  return trace;
}

export function startSpan(messageId: string, name: string, detail?: string): void {
  const trace = traces.get(messageId);
  if (!trace) return;
  trace.spans.push({ name, startedAt: Date.now(), status: 'ok', detail });
}

export function endSpan(messageId: string, name: string, status?: 'ok' | 'error' | 'timeout', detail?: string): void {
  const trace = traces.get(messageId);
  if (!trace) return;
  const span = trace.spans.find(s => s.name === name && !s.endedAt);
  if (!span) return;
  span.endedAt = Date.now();
  span.durationMs = span.endedAt - span.startedAt;
  if (status) span.status = status;
  if (detail) span.detail = detail;
}

export function completeTrace(messageId: string): Trace | null {
  const trace = traces.get(messageId);
  if (!trace) return null;
  trace.completedAt = Date.now();
  trace.totalDurationMs = trace.completedAt - trace.createdAt;
  return trace;
}

export function getTrace(messageId: string): Trace | null {
  return traces.get(messageId) ?? null;
}

export function getRecentTraces(limit = 20): Trace[] {
  return Array.from(traces.values())
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
    .slice(0, limit);
}

// ============================================================
// 2. 元感知：Agent 模型（Self Model）
// ============================================================
// 系统持有每个 Agent 的显式模型，包括能力、负载、历史表现。

export interface AgentModel {
  agentId: string;
  capabilities: string[];          // 支持的消息类型
  maxConcurrency: number;          // 最大并行数
  currentLoad: number;             // 当前活跃数
  averageLatencyMs: number;        // 平均响应时间（滑动窗口）
  errorRate: number;               // 最近错误率 0-1
  lastSeenAt: number;              // 最后通信时间
  available: boolean;              // 是否可用
  // 滑动窗口历史
  latencyWindow: number[];         // 最近 N 次响应时间
  errorWindow: number[];           // 最近 N 次是否错误（0/1）
}

const agents = new Map<string, AgentModel>();
const WINDOW_SIZE = 20;

export function registerAgent(agentId: string, capabilities: string[], maxConcurrency = 4): AgentModel {
  const model: AgentModel = {
    agentId,
    capabilities,
    maxConcurrency,
    currentLoad: 0,
    averageLatencyMs: 0,
    errorRate: 0,
    lastSeenAt: Date.now(),
    available: true,
    latencyWindow: [],
    errorWindow: [],
  };
  agents.set(agentId, model);
  return model;
}

export function recordAgentInteraction(agentId: string, latencyMs: number, isError: boolean): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  agent.lastSeenAt = Date.now();
  agent.latencyWindow.push(latencyMs);
  if (agent.latencyWindow.length > WINDOW_SIZE) agent.latencyWindow.shift();
  agent.averageLatencyMs = agent.latencyWindow.reduce((a, b) => a + b, 0) / agent.latencyWindow.length;

  agent.errorWindow.push(isError ? 1 : 0);
  if (agent.errorWindow.length > WINDOW_SIZE) agent.errorWindow.shift();
  agent.errorRate = agent.errorWindow.reduce((a, b) => a + b, 0) / agent.errorWindow.length;
}

export function setAgentLoad(agentId: string, load: number): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.currentLoad = load;
  agent.available = load < agent.maxConcurrency * 0.8; // 负载超过 80% 标记不可用
}

export function getAgentModel(agentId: string): AgentModel | null {
  return agents.get(agentId) ?? null;
}

export function getAllAgentModels(): AgentModel[] {
  return Array.from(agents.values());
}

// 注册标准 Agent
registerAgent('cloud_ds', ['delegate', 'query', 'report', 'cancel'], 1);
registerAgent('local_claude', ['exec', 'delegate', 'query', 'read', 'write', 'search'], 4);
registerAgent('cloud_claude', ['query'], 2);
registerAgent('neca', ['ping', 'query', 'cancel'], 10);

// ============================================================
// 3. 元认知：自适应控制（Adaptive Control）
// ============================================================
// 基于 Agent 模型和时序数据，动态调整行为策略。

export interface AdaptivePolicy {
  // 对每个目标 Agent，是否应该发送消息
  shouldSendTo(agentId: string): boolean;
  // 对每个消息类型，是否应该执行
  shouldExecute(type: string): boolean;
  // 对 relay 调用，应该优先用哪个提供商
  preferredRelayProvider(): string;
  // 当前推荐的并发数
  recommendedConcurrency(): number;
}

class AdaptiveController implements AdaptivePolicy {
  private circuitBreakers = new Map<string, { failures: number; lastFailureAt: number; openUntil: number }>();
  private readonly FAILURE_THRESHOLD = 5;
  private readonly CIRCUIT_OPEN_MS = 30_000; // 断路器打开 30 秒

  shouldSendTo(agentId: string): boolean {
    const agent = agents.get(agentId);
    if (!agent) return false;
    if (!agent.available) return false;
    // 断路器检查
    const cb = this.circuitBreakers.get(agentId);
    if (cb && Date.now() < cb.openUntil) return false;
    // 错误率超过 50% 熔断
    if (agent.errorRate > 0.5) {
      this.tripCircuitBreaker(agentId);
      return false;
    }
    return true;
  }

  shouldExecute(type: string): boolean {
    // 所有标准类型默认允许
    return true;
  }

  preferredRelayProvider(): string {
    const claude = agents.get('cloud_claude');
    const ds = agents.get('cloud_ds');
    if (!claude || !ds) return 'claude';
    // 选延迟低的
    return claude.averageLatencyMs <= ds.averageLatencyMs ? 'claude' : 'deepseek';
  }

  recommendedConcurrency(): number {
    const local = agents.get('local_claude');
    if (!local) return 2;
    // 根据错误率调整并发
    const base = local.maxConcurrency;
    const reduction = Math.floor(base * local.errorRate);
    return Math.max(1, base - reduction);
  }

  recordFailure(agentId: string): void {
    let cb = this.circuitBreakers.get(agentId);
    if (!cb) {
      cb = { failures: 0, lastFailureAt: 0, openUntil: 0 };
      this.circuitBreakers.set(agentId, cb);
    }
    cb.failures++;
    cb.lastFailureAt = Date.now();
    if (cb.failures >= this.FAILURE_THRESHOLD) {
      this.tripCircuitBreaker(agentId);
    }
  }

  recordSuccess(agentId: string): void {
    const cb = this.circuitBreakers.get(agentId);
    if (cb) {
      cb.failures = 0;
      cb.openUntil = 0;
    }
  }

  private tripCircuitBreaker(agentId: string): void {
    const cb = this.circuitBreakers.get(agentId);
    if (cb) {
      cb.openUntil = Date.now() + this.CIRCUIT_OPEN_MS;
    }
  }

  /** 获取所有断路器状态 */
  getCircuitBreakerStates(): Record<string, { failures: number; open: boolean; opensAt?: string }> {
    const states: Record<string, any> = {};
    for (const [agentId, cb] of this.circuitBreakers) {
      states[agentId] = {
        failures: cb.failures,
        open: Date.now() < cb.openUntil,
        opensAt: cb.openUntil > 0 ? new Date(cb.openUntil).toISOString() : undefined,
      };
    }
    return states;
  }
}

export const adaptive = new AdaptiveController();

// ============================================================
// 4. 时序预算跟踪（Latency Budget）
// ============================================================
// 每个消息从发起到完成，有一个预期的总时长预算。
// 如果某个阶段超支，后续阶段可以感知并调整。

export interface LatencyBudget {
  totalMs: number;
  allocations: Map<string, number>;  // 阶段名 → 预算毫秒
  spent: Map<string, number>;        // 阶段名 → 已消耗
}

const DEFAULT_BUDGETS: Record<string, LatencyBudget> = {
  exec: {
    totalMs: 30_000,
    allocations: new Map([['route', 100], ['spawn', 200], ['exec', 29_500], ['reply', 200]]),
    spent: new Map(),
  },
  delegate: {
    totalMs: 300_000,
    allocations: new Map([['route', 100], ['spawn_claude', 500], ['execute', 299_000], ['reply', 400]]),
    spent: new Map(),
  },
  query_relay: {
    totalMs: 60_000,
    allocations: new Map([['route', 100], ['relay_api', 58_000], ['reply', 1_900]]),
    spent: new Map(),
  },
};

export function getBudget(type: string): LatencyBudget | null {
  const key = type === 'query' ? 'query_relay' : type;
  const budget = DEFAULT_BUDGETS[key];
  if (!budget) return null;
  // 返回副本，避免污染
  const copy: LatencyBudget = {
    totalMs: budget.totalMs,
    allocations: new Map(budget.allocations),
    spent: new Map(),
  };
  return copy;
}

export function spendBudget(budget: LatencyBudget, phase: string, ms: number): { withinBudget: boolean; remainingMs: number } {
  const allocated = budget.allocations.get(phase) ?? 0;
  const spent = (budget.spent.get(phase) ?? 0) + ms;
  budget.spent.set(phase, spent);
  const remaining = allocated - spent;
  return { withinBudget: remaining >= 0, remainingMs: remaining };
}

// ============================================================
// 5. 元状态聚合（元监控层的统一出口）
// ============================================================

export interface MetaState {
  // 时序
  recentTraces: Trace[];
  // 元感知
  agents: AgentModel[];
  // 元认知
  adaptive: {
    circuitBreakers: Record<string, { failures: number; open: boolean }>;
    preferredRelay: string;
    recommendedConcurrency: number;
  };
  // 时序预算
  budgets: Record<string, { totalMs: number; allocations: Record<string, number> }>;
}

export function getMetaState(): MetaState {
  const budgets: Record<string, any> = {};
  for (const [key, budget] of Object.entries(DEFAULT_BUDGETS)) {
    budgets[key] = { totalMs: budget.totalMs, allocations: Object.fromEntries(budget.allocations) };
  }
  return {
    recentTraces: getRecentTraces(5),
    agents: getAllAgentModels(),
    adaptive: {
      circuitBreakers: adaptive.getCircuitBreakerStates(),
      preferredRelay: adaptive.preferredRelayProvider(),
      recommendedConcurrency: adaptive.recommendedConcurrency(),
    },
    budgets,
  };
}
