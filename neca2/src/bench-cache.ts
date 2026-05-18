// ---- 缓存基准测试模块 ----
// 展示消息缓存在不同场景下的性能提升
//
// 核心洞察：
//   结构化消息 = 确定性模板 = 可缓存
//   自然语言 = 每次都不同 = 不可缓存
//   
// 这就是紧凑协议对 NL 的真正降维打击：
//   不是"单条消息更小"，而是"同样的消息第二次不要钱"

import { makeMessage } from './protocol/codec.js';
import { codecFactory } from './protocol/codec-factory.js';
import { messageCache, cachedEncode, runCacheBench } from './relay/message-cache.js';
import type { Message } from './protocol/types.js';

// ---- 缓存场景定义 ----

export interface CacheScenarioResult {
  name: string;
  description: string;
  /** 核心洞察：为什么这个场景的缓存有效 */
  insight: string;
  /** 无缓存 vs 有缓存 */
  withoutCache: { totalTimeUs: number; avgUs: number };
  withCache: { totalTimeUs: number; avgUs: number };
  speedup: string;
  hitRate: string;
  /** 等效 NL 对比：NL 无法缓存，所以每次都要完整 LLM 解析 */
  nlEquivalentCost: string;
  /** 场景特有的缓存行为描述 */
  cacheBehavior: string;
}

// ---- 5 个缓存场景 ----

export const CACHE_SCENARIOS: Array<{
  name: string;
  description: string;
  insight: string;
  nlEquivalentCost: string;
  cacheBehavior: string;
  run: () => { wcTime: number; cTime: number; hitRate: string; speedup: string };
}> = [
  // 场景 1: 同一条消息反复发送
  {
    name: '高频重复指令',
    description: '1000 次循环发送完全相同的 ping 消息',
    insight: 'ping 在协议中永远只有一种模板。第 2 次以后全是缓存命中。',
    nlEquivalentCost: 'NL 每次都要 LLM 解析"ping"，1000 次要等 1000 次 (~500s)',
    cacheBehavior: '第 1 次编码并缓存 → 第 2-1000 次直接命中 L1，零编码开销',
    run: () => {
      const jsonCodec = codecFactory.get('json')!;
      const msg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
      const ITER = 1000;

      // 无缓存
      messageCache.clear();
      const wcStart = process.hrtime.bigint();
      for (let i = 0; i < ITER; i++) jsonCodec.encode(msg);
      const wcEnd = process.hrtime.bigint();

      // 有缓存
      messageCache.clear();
      const cStart = process.hrtime.bigint();
      for (let i = 0; i < ITER; i++) cachedEncode(msg, (m) => jsonCodec.encode(m));
      const cEnd = process.hrtime.bigint();

      const wcNs = Number(wcEnd - wcStart);
      const cNs = Number(cEnd - cStart);
      const stats = messageCache.getStats();
      return {
        wcTime: Math.round(wcNs / 1000),
        cTime: Math.round(cNs / 1000),
        hitRate: stats.hitRate,
        speedup: cNs > 0 ? (wcNs / cNs).toFixed(2) + 'x' : 'N/A',
      };
    },
  },

  // 场景 2: 多轮对话中的重复模式
  {
    name: '多轮重复模式（10轮×100次）',
    description: '10 轮对话重复 100 次（共 1000 条），每轮包含 exec + report 对',
    insight: '多轮对话中 exec/report 模板高度重复，缓存命中率随轮数接近 100%',
    nlEquivalentCost: 'NL 每轮都用不同措辞，"请执行一下""麻烦运行""帮我跑一下"——无法缓存',
    cacheBehavior: '10 个模板各编码 1 次 → 990 次缓存命中，命中率 99%',
    run: () => {
      const jsonCodec = codecFactory.get('json')!;
      const templates: Message[] = [];
      for (let i = 0; i < 10; i++) {
        templates.push(makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: `step_${i}`, cwd: '/project', timeout: 30000 }));
        templates.push(makeMessage('local_claude', 'cloud_ds', 'report', { taskId: `t${i}`, status: 'completed', result: { output: `result_${i}` } }));
      }
      const ITER = 1000;

      messageCache.clear();
      const wcStart = process.hrtime.bigint();
      for (let i = 0; i < ITER; i++) jsonCodec.encode(templates[i % templates.length]);
      const wcEnd = process.hrtime.bigint();

      messageCache.clear();
      const cStart = process.hrtime.bigint();
      for (let i = 0; i < ITER; i++) cachedEncode(templates[i % templates.length], (m) => jsonCodec.encode(m));
      const cEnd = process.hrtime.bigint();

      const wcNs = Number(wcEnd - wcStart);
      const cNs = Number(cEnd - cStart);
      const stats = messageCache.getStats();
      return {
        wcTime: Math.round(wcNs / 1000),
        cTime: Math.round(cNs / 1000),
        hitRate: stats.hitRate,
        speedup: cNs > 0 ? (wcNs / cNs).toFixed(2) + 'x' : 'N/A',
      };
    },
  },

  // 场景 3: 高吞吐消息队列（有重复）
  {
    name: '高吞吐队列（50% 重复率）',
    description: '1000 条消息，50% 是重复模板（500 种唯一 + 500 次命中）',
    insight: '实际场景中消息模板往往集中在少数模式，帕累托分布让缓存极度高效',
    nlEquivalentCost: 'NL 无法做任何去重，1000 条 = 1000 次完整 LLM 解析',
    cacheBehavior: '500 种唯一模板编码 500 次 → 500 次缓存命中，命中率 50%',
    run: () => {
      const jsonCodec = codecFactory.get('json')!;
      const uniqueMsgs: Message[] = [];
      for (let i = 0; i < 500; i++) {
        uniqueMsgs.push(makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: `cmd_${i}`, cwd: '/project', timeout: 30000 }));
      }
      // 混合：500 唯一 + 500 重复（重复前 100 种模板各 5 次）
      const allMsgs = [...uniqueMsgs];
      for (let i = 0; i < 500; i++) allMsgs.push(uniqueMsgs[i % 100]);
      const ITER = allMsgs.length;

      messageCache.clear();
      const wcStart = process.hrtime.bigint();
      for (const msg of allMsgs) jsonCodec.encode(msg);
      const wcEnd = process.hrtime.bigint();

      messageCache.clear();
      const cStart = process.hrtime.bigint();
      for (const msg of allMsgs) cachedEncode(msg, (m) => jsonCodec.encode(m));
      const cEnd = process.hrtime.bigint();

      const wcNs = Number(wcEnd - wcStart);
      const cNs = Number(cEnd - cStart);
      const stats = messageCache.getStats();
      return {
        wcTime: Math.round(wcNs / 1000),
        cTime: Math.round(cNs / 1000),
        hitRate: stats.hitRate,
        speedup: cNs > 0 ? (wcNs / cNs).toFixed(2) + 'x' : 'N/A',
      };
    },
  },

  // 场景 4: 会话恢复（全部缓存）
  {
    name: '会话恢复（缓存预热）',
    description: '服务器重启后 50 个会话的模板已缓存，恢复时零编码开销',
    insight: '持久化不仅存会话状态，还能存消息模板。重启后预热缓存，恢复如飞。',
    nlEquivalentCost: 'NL 恢复需要 LLM 重新理解所有上下文，无法预热',
    cacheBehavior: '50 个模板在持久化时已缓存到 L2，恢复时全部 L2 命中',
    run: () => {
      const jsonCodec = codecFactory.get('json')!;
      const sessions: Message[] = [];
      for (let i = 0; i < 50; i++) {
        sessions.push(makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: `task_${i}`, cwd: '/project', timeout: 30000 }));
      }

      // 预热：先把模板写入缓存
      messageCache.clear();
      for (const msg of sessions) {
        messageCache.set(msg, jsonCodec.encode(msg));
      }

      // 模拟恢复：所有消息应全部缓存命中
      const cStart = process.hrtime.bigint();
      for (const msg of sessions) {
        const cached = messageCache.get(msg);
        if (!cached) {
          // 缓存未命中则编码（不应该发生）
          messageCache.set(msg, jsonCodec.encode(msg));
        }
      }
      const cEnd = process.hrtime.bigint();

      // 无缓存基线（正常编码）
      const wcStart = process.hrtime.bigint();
      for (const msg of sessions) jsonCodec.encode(msg);
      const wcEnd = process.hrtime.bigint();

      const wcNs = Number(wcEnd - wcStart);
      const cNs = Number(cEnd - cStart);
      const stats = messageCache.getStats();
      return {
        wcTime: Math.round(wcNs / 1000),
        cTime: Math.round(cNs / 1000),
        hitRate: stats.hitRate,
        speedup: cNs > 0 ? (wcNs / cNs).toFixed(2) + 'x' : 'N/A',
      };
    },
  },

  // 场景 5: 预测预取
  {
    name: '预测预取（智能预编码）',
    description: 'router 根据历史模式预测下一条消息，后台预编码',
    insight: '协议路由是可预测的：exec 之后大概率跟 report，ping 之后跟 pong。预取让"下一次"零等待。',
    nlEquivalentCost: 'NL 完全无法预测下一条消息的内容',
    cacheBehavior: '预取模块在空闲时预编码预测的模板，命中时从 L3 直接返回',
    run: () => {
      const jsonCodec = codecFactory.get('json')!;
      const execMsg = makeMessage('cloud_ds', 'local_claude', 'exec', { cmd: 'npm test', cwd: '/project', timeout: 60000 });
      const reportMsg = makeMessage('local_claude', 'cloud_ds', 'report', { taskId: 't1', status: 'completed', result: { output: 'PASS' } });
      const pingMsg = makeMessage('cloud_ds', 'local_claude', 'ping', {});
      const pongMsg = makeMessage('local_claude', 'cloud_ds', 'pong', {});

      messageCache.clear();

      // 模拟路由器预取：编解码器在后台预编码预测的消息
      const predicted = [reportMsg, pongMsg]; // 路由器预测 exec 后会有 report，ping 后会有 pong
      messageCache.prefetch(predicted, (m) => jsonCodec.encode(m));

      // 测试：发送 exec（L1 未命中，正常编码）→ 收到 report（L3 命中！）
      const cStart = process.hrtime.bigint();

      // exec: miss, 正常编码
      cachedEncode(execMsg, (m) => jsonCodec.encode(m));
      // report: L3 命中！直接从预测缓存返回
      cachedEncode(reportMsg, (m) => jsonCodec.encode(m));
      // ping: miss
      cachedEncode(pingMsg, (m) => jsonCodec.encode(m));
      // pong: L3 命中！
      cachedEncode(pongMsg, (m) => jsonCodec.encode(m));
      // 重复一轮：全部 L1 命中
      cachedEncode(execMsg, (m) => jsonCodec.encode(m));
      cachedEncode(reportMsg, (m) => jsonCodec.encode(m));
      cachedEncode(pingMsg, (m) => jsonCodec.encode(m));
      cachedEncode(pongMsg, (m) => jsonCodec.encode(m));

      const cEnd = process.hrtime.bigint();

      // 无缓存基线
      const wcStart = process.hrtime.bigint();
      const msgs = [execMsg, reportMsg, pingMsg, pongMsg, execMsg, reportMsg, pingMsg, pongMsg];
      for (const m of msgs) jsonCodec.encode(m);
      const wcEnd = process.hrtime.bigint();

      const wcNs = Number(wcEnd - wcStart);
      const cNs = Number(cEnd - cStart);
      const stats = messageCache.getStats();
      return {
        wcTime: Math.round(wcNs / 1000),
        cTime: Math.round(cNs / 1000),
        hitRate: stats.hitRate,
        speedup: cNs > 0 ? (wcNs / cNs).toFixed(2) + 'x' : 'N/A',
      };
    },
  },
];

// ---- 运行所有缓存场景 ----

export function runCacheBenchmarks(): CacheScenarioResult[] {
  const results: CacheScenarioResult[] = [];

  for (const scenario of CACHE_SCENARIOS) {
    const result = scenario.run();
    results.push({
      name: scenario.name,
      description: scenario.description,
      insight: scenario.insight,
      withoutCache: { totalTimeUs: result.wcTime, avgUs: Math.round(result.wcTime / 100) },
      withCache: { totalTimeUs: result.cTime, avgUs: Math.round(result.cTime / 100) },
      speedup: result.speedup,
      hitRate: result.hitRate,
      nlEquivalentCost: scenario.nlEquivalentCost,
      cacheBehavior: scenario.cacheBehavior,
    });
  }

  return results;
}

// ---- 缓存 vs NL 效率对比 ----

export function getCacheVsNLSummary(): string {
  const results = runCacheBenchmarks();
  const avgSpeedup = results.reduce((a, r) => {
    const s = parseFloat(r.speedup);
    return a + (isNaN(s) ? 0 : s);
  }, 0) / results.length;

  return [
    `缓存平均加速: ${avgSpeedup.toFixed(1)}x`,
    `NL 等效: 不可缓存（每次都要 LLM 解析）`,
    `核心洞察: 紧凑协议的消息是确定性的 → 缓存命中率可达 99%+`,
    `NL 的致命弱点: 每次措辞不同 → 缓存率为 0%`,
  ].join('\n');
}
