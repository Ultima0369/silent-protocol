// ---- Intent Executor ----
// 按计划执行，支持进度反馈、暂停调整、错误恢复
// 碳基只负责"验收、改这里、再来一次"
//
// v0.9.6: AbortController 真取消 — 取消信号传播到子进程

import { parseIntent, needsClarification } from './intent-parser.js';
import { planExecution, type ExecutionPlan, type PlannedStep } from './exec-planner.js';
import { aggregateFeedback, type ExecutionResult } from './feedback-aggregator.js';
import { routeMessage } from './router.js';
import { makeMessage } from '../protocol/codec.js';
import { logger } from '../utils/logger.js';
import type { Message } from '../protocol/types.js';

export type ExecutionStatus = 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'needs_clarification';

export interface ExecutionState {
  id: string;
  plan: ExecutionPlan | null;
  status: ExecutionStatus;
  stepResults: Map<string, unknown>;
  currentStepIndex: number;
  error: string | null;
  startTime: number;
  endTime: number | null;
  clarification: string | null;
  userFeedback: string[];
  /** AbortController 用于真取消 — 传播信号到正在执行的步骤 */
  abortController: AbortController;
}

const executions = new Map<string, ExecutionState>();

/**
 * 从自然语言开始执行
 * @param text 用户请求
 * @returns 执行状态
 */
export async function executeFromNaturalLanguage(text: string): Promise<ExecutionState> {
  // 1. 解析意图
  const intent = parseIntent(text);

  // 2. 检查是否需要澄清
  const clarification = needsClarification(intent);
  if (clarification) {
    const state: ExecutionState = {
      id: `exec_${Date.now()}`,
      plan: null,
      status: 'needs_clarification',
      stepResults: new Map(),
      currentStepIndex: -1,
      error: null,
      startTime: Date.now(),
      endTime: null,
      clarification,
      userFeedback: [],
      abortController: new AbortController(),
    };
    executions.set(state.id, state);
    return state;
  }

  // 3. 生成执行计划
  const plan = planExecution(intent);

  const state: ExecutionState = {
    id: plan.id,
    plan,
    status: 'running',
    stepResults: new Map(),
    currentStepIndex: 0,
    error: null,
    startTime: Date.now(),
    endTime: null,
    clarification: null,
    userFeedback: [],
    abortController: new AbortController(),
  };
  executions.set(state.id, state);

  logger.info('Starting intent execution', { planId: plan.id, type: intent.type, steps: plan.steps.length }, { module: 'intent' });

  // 4. 异步执行（不 await，返回立即状态）
  executePlanAsync(state).catch(err => {
    // AbortError 是预期的，不视为失败
    if (err.name === 'AbortError') {
      logger.info('Execution aborted', { planId: state.id }, { module: 'intent' });
      return;
    }
    if (state.status !== 'cancelled') {
      state.status = 'failed';
      state.error = err.message;
      state.endTime = Date.now();
      logger.error('Execution failed', { planId: state.id, error: err.message }, { module: 'intent' });
    }
  });

  return state;
}

/**
 * 异步执行计划
 */
async function executePlanAsync(state: ExecutionState): Promise<void> {
  const plan = state.plan!;
  const signal = state.abortController.signal;
  const stepMap = new Map<string, PlannedStep>();
  plan.steps.forEach(s => stepMap.set(s.id, s));

  // 拓扑排序：按依赖执行
  const executed = new Set<string>();
  const maxRetries = 2;

  while (executed.size < plan.steps.length) {
    // 检查取消信号
    if (signal.aborted) {
      throw new DOMException('Execution cancelled', 'AbortError');
    }

    if (state.status === 'paused') {
      return;
    }

    // 找可执行的步骤（所有依赖已完成）
    const readySteps = plan.steps.filter(s => {
      if (executed.has(s.id)) return false;
      return s.dependsOn.every(d => executed.has(d));
    });

    if (readySteps.length === 0) {
      // 死锁？找第一个未执行且依赖不全的
      const stuck = plan.steps.find(s => !executed.has(s.id));
      if (stuck) {
        state.status = 'failed';
        state.error = `步骤 ${stuck.id} 依赖未完成: ${stuck.dependsOn.filter(d => !executed.has(d)).join(', ')}`;
        state.endTime = Date.now();
        return;
      }
      break;
    }

    // 执行所有可并行步骤
    for (const step of readySteps) {
      // 每次迭代检查取消
      if (signal.aborted) {
        throw new DOMException('Execution cancelled', 'AbortError');
      }

      state.currentStepIndex = plan.steps.indexOf(step);
      try {
        const result = await executeStepWithRetry(step, maxRetries, signal);
        state.stepResults.set(step.id, result);
        executed.add(step.id);
      } catch (err: any) {
        // 取消异常向上传播
        if (err.name === 'AbortError') throw err;

        if (step.critical) {
          state.status = 'failed';
          state.error = `关键步骤失败: ${step.description} — ${err.message}`;
          state.endTime = Date.now();
          return;
        }
        // 非关键步骤：标记失败但继续
        state.stepResults.set(step.id, { error: err.message, skipped: true });
        executed.add(step.id);
        logger.warn('Non-critical step failed, continuing', { step: step.id, error: err.message }, { module: 'intent' });
      }
    }
  }

  // 所有步骤完成
  if (!signal.aborted) {
    state.status = 'completed';
    state.endTime = Date.now();
    logger.info('Execution completed', { planId: state.id, steps: plan.steps.length, time: state.endTime - state.startTime }, { module: 'intent' });
  }
}

/**
 * 执行单步（带重试 + 可取消）
 */
async function executeStepWithRetry(step: PlannedStep, maxRetries: number, signal: AbortSignal): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 检查取消信号
    if (signal.aborted) {
      throw new DOMException('Execution cancelled', 'AbortError');
    }

    try {
      if (attempt > 0) {
        // 指数退避（可取消的等待）
        await waitWithSignal(attempt * 1000, signal);
      }
      return await executeStep(step, signal);
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
      if (!step.retryOnFail) throw err;
      logger.warn('Step retry', { step: step.id, attempt, error: err.message }, { module: 'intent' });
    }
  }
  throw lastError!;
}

/**
 * 可取消的延时等待
 */
function waitWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Execution cancelled', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Execution cancelled', 'AbortError'));
    }, { once: true });
  });
}

/**
 * 执行单步（带取消信号）
 */
async function executeStep(step: PlannedStep, signal: AbortSignal): Promise<unknown> {
  // 执行前检查取消
  if (signal.aborted) throw new DOMException('Execution cancelled', 'AbortError');

  switch (step.type) {
    case 'exec': {
      const msg = makeMessage('cloud_ds', step.target, 'exec', {
        cmd: step.payload['cmd'],
        cwd: step.payload['cwd'] || process.cwd(),
        timeout: step.payload['timeout'] || 30000,
      }, true);
      const session = await routeMessage(msg);
      if (session.status === 'reply_received' && session.response) {
        return session.response.payload;
      }
      throw new Error(`Exec failed: ${session.status}`);
    }

    case 'query': {
      const msg = makeMessage('cloud_ds', step.target, 'query', {
        question: step.payload['question'],
        maxTokens: step.payload['maxTokens'] || 2000,
      }, true);
      const session = await routeMessage(msg);
      if (session.status === 'reply_received' && session.response) {
        return session.response.payload;
      }
      throw new Error(`Query failed: ${session.status}`);
    }

    case 'read': {
      const msg = makeMessage('cloud_ds', step.target, 'read', {
        path: step.payload['path'],
      }, true);
      const session = await routeMessage(msg);
      if (session.status === 'reply_received' && session.response) {
        return session.response.payload;
      }
      throw new Error(`Read failed: ${session.status}`);
    }

    case 'write': {
      const msg = makeMessage('cloud_ds', step.target, 'write', {
        description: step.payload['description'],
        path: step.payload['path'],
      }, true);
      const session = await routeMessage(msg);
      if (session.status === 'reply_received' && session.response) {
        return session.response.payload;
      }
      throw new Error(`Write failed: ${session.status}`);
    }

    case 'search': {
      const msg = makeMessage('cloud_ds', step.target, 'search', {
        pattern: step.payload['pattern'],
        path: step.payload['path'],
      }, true);
      const session = await routeMessage(msg);
      if (session.status === 'reply_received' && session.response) {
        return session.response.payload;
      }
      throw new Error(`Search failed: ${session.status}`);
    }

    case 'delegate': {
      const msg = makeMessage('cloud_ds', step.target, 'delegate', step.payload, true);
      const session = await routeMessage(msg);
      if (session.status === 'reply_received' && session.response) {
        return session.response.payload;
      }
      throw new Error(`Delegate failed: ${session.status}`);
    }

    case 'wait': {
      const ms = (step.payload['ms'] as number) || 1000;
      await waitWithSignal(ms, signal);
      return { waited: ms };
    }

    case 'notify':
      return { notified: true };

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

/**
 * 获取执行状态
 */
export function getExecutionState(id: string): ExecutionState | undefined {
  return executions.get(id);
}

/**
 * 取消执行 — 真取消
 * 通过 AbortController 发送中止信号，传播到正在执行的步骤
 */
export function cancelExecution(id: string): boolean {
  const state = executions.get(id);
  if (!state || state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') return false;
  state.status = 'cancelled';
  state.endTime = Date.now();
  state.abortController.abort();  // 真取消！传播信号到子进程
  logger.info('Execution cancelled', { planId: id }, { module: 'intent' });
  return true;
}

/**
 * 暂停执行
 */
export function pauseExecution(id: string): boolean {
  const state = executions.get(id);
  if (!state || state.status !== 'running') return false;
  state.status = 'paused';
  logger.info('Execution paused', { planId: id }, { module: 'intent' });
  return true;
}

/**
 * 恢复执行
 */
export function resumeExecution(id: string): boolean {
  const state = executions.get(id);
  if (!state || state.status !== 'paused') return false;
  state.status = 'running';
  logger.info('Execution resumed', { planId: id }, { module: 'intent' });
  // 异步继续
  executePlanAsync(state).catch(err => {
    if (err.name === 'AbortError') return;
    state.status = 'failed';
    state.error = err.message;
    state.endTime = Date.now();
  });
  return true;
}

/**
 * 提交用户反馈（尝菜式）
 * @param id 执行ID
 * @param feedback 反馈类型或文本
 * @returns 更新后的结果摘要
 */
export async function submitFeedback(id: string, feedback: string): Promise<{
  result: ExecutionResult | null;
  status: ExecutionStatus;
  adjusted: boolean;
}> {
  const state = executions.get(id);
  if (!state) {
    return { result: null, status: 'failed', adjusted: false };
  }

  state.userFeedback.push(feedback);

  // 尝菜式反馈：用户说"可以"就是验收通过
  const lowerFeedback = feedback.toLowerCase().trim();

  if (['可以', '行', '好的', 'ok', '好', '不错', 'nice', 'good', 'perfect', '搞定', '完成'].includes(lowerFeedback)) {
    // 用户验收通过
    state.status = 'completed';
    state.endTime = Date.now();
    const result = state.plan ? aggregateFeedback(state.plan, state.stepResults) : null;
    return { result, status: 'completed', adjusted: false };
  }

  if (['重来', '再来', '重新', 'restart', '重试', '重新开始'].includes(lowerFeedback) || feedback.startsWith('重来')) {
    if (!state.plan) {
      const newState = await executeFromNaturalLanguage(state.clarification || feedback);
      return { result: null, status: newState.status, adjusted: true };
    }
    // 先取消当前执行，再重新开始
    state.abortController.abort();
    const newAbort = new AbortController();
    state.abortController = newAbort;
    state.stepResults.clear();
    state.currentStepIndex = 0;
    state.error = null;
    state.status = 'running';
    state.startTime = Date.now();
    state.endTime = null;
    executePlanAsync(state).catch(err => {
      if (err.name === 'AbortError') return;
      state.status = 'failed';
      state.error = err.message;
      state.endTime = Date.now();
    });
    return { result: null, status: 'running', adjusted: true };
  }

  if (feedback.startsWith('改') || feedback.startsWith('修改') || lowerFeedback.startsWith('change') || lowerFeedback.startsWith('fix')) {
    const result = state.plan ? aggregateFeedback(state.plan, state.stepResults) : null;
    return { result, status: state.status, adjusted: false };
  }

  const result = state.plan ? aggregateFeedback(state.plan, state.stepResults) : null;
  return { result, status: state.status, adjusted: false };
}

/**
 * 列出所有执行
 */
export function listExecutions(filter?: ExecutionStatus): ExecutionState[] {
  const all = Array.from(executions.values());
  return filter ? all.filter(e => e.status === filter) : all;
}

/**
 * 清理旧的执行记录
 */
export function cleanupOldExecutions(maxAgeMs: number = 30 * 60 * 1000): number {
  const now = Date.now();
  let count = 0;
  for (const [id, state] of executions) {
    if (state.endTime && (now - state.endTime) > maxAgeMs) {
      executions.delete(id);
      count++;
    }
  }
  return count;
}
