// ---- Intent Execution Tests ----
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseIntent, needsClarification } from '../src/relay/intent-parser.js';
import { planExecution } from '../src/relay/exec-planner.js';
import { aggregateFeedback, getAcceptancePrompt } from '../src/relay/feedback-aggregator.js';
import {
  executeFromNaturalLanguage,
  getExecutionState,
  cancelExecution,
  submitFeedback,
  listExecutions,
  cleanupOldExecutions,
} from '../src/relay/intent-executor.js';
import { initRetryQueue, shutdownRetryQueue } from '../src/relay/retry-queue.js';
import { initSessionManager, shutdownSessionManager } from '../src/relay/session.js';

// 初始化依赖
beforeAll(() => {
  initRetryQueue();
  initSessionManager();
});

afterAll(() => {
  shutdownRetryQueue();
  shutdownSessionManager();
});

// ======================================
// 1. Intent Parser
// ======================================
describe('Intent Parser', () => {
  it('should parse exec intent', () => {
    const intent = parseIntent('帮我运行 npm test');
    expect(intent.type).toBe('exec');
    expect(intent.params['cmd']).toContain('npm test');
    expect(intent.confidence).toBeGreaterThan(0.8);
  });

  it('should parse query intent', () => {
    const intent = parseIntent('帮我查一下什么是Silent Protocol');
    expect(intent.type).toBe('query');
    // primaryTarget 可能包含查到的内容
    expect(intent.primaryTarget).toBeTruthy();
  });

  it('should parse scrape intent', () => {
    const intent = parseIntent('帮我爬一下AI论文');
    expect(intent.type).toBe('scrape');
    expect(intent.primaryTarget).toBeTruthy();
  });

  it('should parse write intent', () => {
    const intent = parseIntent('帮我写一个爬虫脚本');
    expect(intent.type).toBe('write');
  });

  it('should parse read intent', () => {
    const intent = parseIntent('帮我看看这个文件');
    expect(intent.type).toBe('read');
  });

  it('should parse search intent', () => {
    const intent = parseIntent('帮我搜索一下错误信息');
    expect(intent.type).toBe('search');
  });

  it('should parse install intent', () => {
    const intent = parseIntent('帮我安装lodash');
    expect(intent.type).toBe('install');
  });

  it('should parse analyze intent', () => {
    const intent = parseIntent('帮我分析一下这段代码');
    expect(intent.type).toBe('analyze');
  });

  it('should parse deploy intent', () => {
    const intent = parseIntent('帮我部署到服务器');
    expect(intent.type).toBe('deploy');
  });

  it('should extract timeout constraint', () => {
    const intent = parseIntent('帮我运行 npm test，5分钟内超时');
    const timeoutConstraint = intent.constraints.find(c => c.type === 'timeout');
    expect(timeoutConstraint).toBeDefined();
    expect(timeoutConstraint!.value).toBe(5 * 60 * 1000);
  });

  it('should return unknown for gibberish', () => {
    const intent = parseIntent('asdfghjkl');
    expect(intent.type).toBe('unknown');
    expect(intent.confidence).toBeLessThan(0.5);
  });

  it('should suggest clarification for unknown intent', () => {
    const msg = needsClarification({ type: 'unknown', primaryTarget: 'xxx', params: {}, constraints: [], confidence: 0.3, rawText: 'xxx' });
    expect(msg).not.toBeNull();
    expect(msg).toContain('不太确定');
  });

  it('should suggest clarification for scrape without url', () => {
    const msg = needsClarification({ type: 'scrape', primaryTarget: '', params: {}, constraints: [], confidence: 0.9, rawText: '帮我爬' });
    expect(msg).not.toBeNull();
    expect(msg).toContain('目标地址');
  });
});

// ======================================
// 2. Execution Planner
// ======================================
describe('Execution Planner', () => {
  it('should generate plan for exec intent', () => {
    const intent = parseIntent('帮我运行 ls -la');
    const plan = planExecution(intent);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].type).toBe('exec');
    expect(plan.steps[0].target).toBe('local_claude');
  });

  it('should generate plan for scrape intent with 2 steps', () => {
    const intent = parseIntent('帮我爬一下arxiv论文');
    const plan = planExecution(intent);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].type).toBe('exec');
    expect(plan.steps[1].type).toBe('exec');
    // Step 2 depends on step 1
    expect(plan.steps[1].dependsOn).toContain(plan.steps[0].id);
  });

  it('should generate plan for install intent with notify step', () => {
    const intent = parseIntent('帮我安装chalk');
    const plan = planExecution(intent);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[1].type).toBe('notify');
  });

  it('should generate plan for deploy intent with 2 steps', () => {
    const intent = parseIntent('帮我部署到服务器');
    const plan = planExecution(intent);
    expect(plan.steps.length).toBe(2);
    // Step 1: git status, Step 2: git push
    expect(plan.steps[0].payload['cmd']).toContain('git status');
    expect(plan.steps[1].payload['cmd']).toContain('git push');
  });

  it('should include timeout from constraints', () => {
    const intent = parseIntent('帮我运行 npm test，30秒超时');
    const plan = planExecution(intent);
    expect(plan.steps[0].timeout).toBe(30000);
  });

  it('should generate plan for unknown intent with cloud_ds fallback', () => {
    const intent = parseIntent('asdfghjkl');
    const plan = planExecution(intent);
    expect(plan.steps[0].target).toBe('cloud_ds');
    expect(plan.steps[0].type).toBe('query');
  });
});

// ======================================
// 3. Feedback Aggregator
// ======================================
describe('Feedback Aggregator', () => {
  it('should generate success summary for completed exec', () => {
    const intent = parseIntent('帮我运行 npm test');
    const plan = planExecution(intent);
    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { stdout: 'All tests passed!', exitCode: 0 });

    const result = aggregateFeedback(plan, results);
    expect(result.success).toBe(true);
    expect(result.summary).toContain('✅');
    expect(result.completedSteps).toBe(1);
    expect(result.failedSteps).toBe(0);
  });

  it('should generate partial success summary (not all steps done)', () => {
    const intent = parseIntent('帮我爬一下arxiv论文');
    const plan = planExecution(intent);
    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { stdout: 'paper data', exitCode: 0 });
    // step 2 not completed

    const result = aggregateFeedback(plan, results);
    expect(result.completedSteps).toBe(1);
    expect(result.failedSteps).toBe(0);
    expect(result.summary).toContain('进度');
  });

  it('should generate failure summary', () => {
    const intent = parseIntent('帮我运行 npm test');
    const plan = planExecution(intent);
    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { error: 'command not found', skipped: true });

    const result = aggregateFeedback(plan, results);
    expect(result.failedSteps).toBe(1);
  });

  it('should generate acceptance prompt for success', () => {
    const intent = parseIntent('帮我运行 ls');
    const plan = planExecution(intent);
    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { stdout: 'files', exitCode: 0 });
    const result = aggregateFeedback(plan, results);
    const prompt = getAcceptancePrompt(result);
    expect(prompt).toContain('可以');
    expect(prompt).toContain('改');
    expect(prompt).toContain('重来');
  });
});

// ======================================
// 4. Intent Executor
// ======================================
describe('Intent Executor', () => {
  it('should create execution state from natural language', async () => {
    // 使用 exec 类型（更容易匹配）
    const state = await executeFromNaturalLanguage('帮我运行 ls');
    expect(state.status).toBe('running');
    expect(state.plan.intent.type).toBe('exec');
    expect(state.startTime).toBeGreaterThan(0);
  });

  it('should request clarification for unknown intent', async () => {
    const state = await executeFromNaturalLanguage('asdfghjkl');
    expect(state.status).toBe('needs_clarification');
    expect(state.clarification).not.toBeNull();
  });

  it('should cancel running execution', async () => {
    const state = await executeFromNaturalLanguage('帮我运行 ls');
    expect(state.status).toBe('running');
    const cancelled = cancelExecution(state.id);
    expect(cancelled).toBe(true);
    // 再次取消应该失败
    expect(cancelExecution(state.id)).toBe(false);
  });

  it('should handle "可以" feedback as acceptance', async () => {
    const state = await executeFromNaturalLanguage('帮我运行 ls');
    expect(state.status).toBe('running');

    const result = await submitFeedback(state.id, '可以');
    expect(result.status).toBe('completed');
    expect(result.result).not.toBeNull();
  });

  it('should handle "重来" feedback as restart', async () => {
    const state = await executeFromNaturalLanguage('帮我运行 ls');
    const result = await submitFeedback(state.id, '重来');
    expect(result.status).toBe('running');
    expect(result.adjusted).toBe(true);
  });

  it('should list executions', async () => {
    await executeFromNaturalLanguage('帮我运行 ls');
    const all = listExecutions();
    expect(all.length).toBeGreaterThan(0);
  });

  it('should cleanup old executions', () => {
    const count = cleanupOldExecutions(-1); // 清理所有
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('should handle "改" feedback', async () => {
    const state = await executeFromNaturalLanguage('帮我运行 ls');
    await new Promise(r => setTimeout(r, 50));
    const result = await submitFeedback(state.id, '改这里');
    expect(result.result).not.toBeNull();
  });
});

// ======================================
// 5. 完整流程集成测试
// ======================================
describe('Full Flow: 爬取并分析', () => {
  it('should parse → plan → aggregate for scrape scenario', () => {
    // 模拟用户说"帮我爬一下某方面论文"
    const text = '帮我爬一下某方面论文';
    const intent = parseIntent(text);
    expect(intent.type).toBe('scrape');

    const plan = planExecution(intent);
    expect(plan.steps.length).toBe(2);

    // 模拟结果
    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { stdout: '<html>paper content</html>', exitCode: 0 });
    results.set(plan.steps[1].id, { answer: '总结：这篇论文是关于...', tokens: 500 });

    const feedback = aggregateFeedback(plan, results);
    expect(feedback.summary).toContain('✅');
    expect(feedback.completedSteps).toBe(2);
  });

  it('should parse → plan → aggregate for install scenario', () => {
    const text = '帮我安装lodash';
    const intent = parseIntent(text);
    expect(intent.type).toBe('install');

    const plan = planExecution(intent);
    expect(plan.steps.length).toBe(2);

    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { stdout: '+ lodash@4.17.21', exitCode: 0 });
    results.set(plan.steps[1].id, { notified: true });

    const feedback = aggregateFeedback(plan, results);
    expect(feedback.summary).toContain('安装完成');
  });

  it('should parse → plan → aggregate for analyze scenario', () => {
    const text = '帮我分析一下这段代码';
    const intent = parseIntent(text);
    expect(intent.type).toBe('analyze');

    const plan = planExecution(intent);
    expect(plan.steps.length).toBe(2);

    const results = new Map<string, unknown>();
    results.set(plan.steps[0].id, { stdout: 'function hello() { return 42; }', exitCode: 0 });
    results.set(plan.steps[1].id, { answer: '这是一个简单的函数，返回42。', tokens: 100 });

    const feedback = aggregateFeedback(plan, results);
    expect(feedback.summary).toContain('分析完成');
  });
});
