// ---- 自适应协议学习引擎测试 ----
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BayesianReliability,
  AutoTuningEngine,
  PatternMiner,
  adaptiveEngine,
} from '../src/relay/adaptive-learning.js';
import type { Message, MessageType } from '../src/protocol/types.js';

function makeMsg(type: MessageType = 'exec'): Message {
  return {
    ver: 1, id: 't', from: 'cloud_ds', to: 'local_claude',
    type, payload: { cmd: 'echo x' }, callback: false, ts: Date.now(),
  };
}

describe('Bayesian 可靠性路由', () => {
  it('初始可靠性应为中性 0.5', () => {
    const br = new BayesianReliability();
    expect(br.getReliability('cloud_ds', 'exec')).toBe(0.5);
  });

  it('多次成功后可靠性应趋近 1', () => {
    const br = new BayesianReliability();
    for (let i = 0; i < 100; i++) {
      br.recordSuccess('cloud_ds', 'exec');
    }
    const reliability = br.getReliability('cloud_ds', 'exec');
    expect(reliability).toBeGreaterThan(0.95);
    expect(reliability).toBeLessThanOrEqual(1);
  });

  it('多次失败后可靠性应趋近 0', () => {
    const br = new BayesianReliability();
    for (let i = 0; i < 100; i++) {
      br.recordFailure('local_claude', 'exec');
    }
    const reliability = br.getReliability('local_claude', 'exec');
    expect(reliability).toBeLessThan(0.05);
  });

  it('应选出最佳智能体', () => {
    const br = new BayesianReliability();
    // local_claude 对 exec 成功率高
    for (let i = 0; i < 50; i++) br.recordSuccess('local_claude', 'exec');
    // cloud_claude 对 exec 成功率低
    for (let i = 0; i < 40; i++) br.recordFailure('cloud_claude', 'exec');
    for (let i = 0; i < 10; i++) br.recordSuccess('cloud_claude', 'exec');

    const best = br.getBestAgent('exec', ['local_claude', 'cloud_claude', 'neca']);
    expect(best).toBe('local_claude');
  });

  it('应记录方向可靠性', () => {
    const br = new BayesianReliability();
    br.recordSuccess('local_claude', 'exec', 'cloud_ds', 'local_claude');
    br.recordSuccess('local_claude', 'exec', 'cloud_ds', 'local_claude');
    br.recordFailure('local_claude', 'exec', 'cloud_ds', 'local_claude');
    const dir = br.getDirectionReliability('cloud_ds', 'local_claude', 'exec');
    expect(dir).toBeGreaterThan(0.5);
    expect(dir).toBeLessThan(1);
  });
});

describe('自动调优缓存优化器', () => {
  it('初始配置应为默认值', () => {
    const at = new AutoTuningEngine();
    const config = at.getConfig();
    expect(config.semanticCacheSize).toBe(2048);
    expect(config.useFlowPrediction).toBe(true);
  });

  it('应记录访问并计算命中率', () => {
    const at = new AutoTuningEngine();
    expect(at.getHitRate()).toBe('0%');
    at.recordAccess(true, 10);
    at.recordAccess(true, 12);
    at.recordAccess(false, 50);
    expect(at.getHitRate()).toBe('66.7%');
  });

  it('大量访问后应返回统计', () => {
    const at = new AutoTuningEngine();
    for (let i = 0; i < 1000; i++) {
      at.recordAccess(i % 3 !== 0, Math.random() * 50); // ~66% hit rate
    }
    const stats = at.getStats();
    expect(stats.messageCount).toBe(1000);
    expect((stats as any).config).toBeDefined();
  });
});

describe('模式挖掘引擎', () => {
  it('初始应无模式', () => {
    const pm = new PatternMiner();
    expect(pm.getPatterns().length).toBe(0);
  });

  it('应挖掘简单模式', () => {
    const pm = new PatternMiner();
    const exec = makeMsg('exec');
    const report = makeMsg('report');
    pm.record(exec);
    pm.record(report);
    const patterns = pm.getPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].pattern).toBe('exec→report');
    expect(patterns[0].frequency).toBe(1);
  });

  it('高频模式应有高置信度', () => {
    const pm = new PatternMiner();
    for (let i = 0; i < 20; i++) {
      pm.record(makeMsg('exec'));
      pm.record(makeMsg('report'));
    }
    const patterns = pm.getPatterns();
    const execReport = patterns.find(p => p.pattern === 'exec→report');
    expect(execReport).toBeDefined();
    expect(execReport!.frequency).toBe(20);
    expect(execReport!.confidence).toBeGreaterThan(0.7);
  });

  it('应只返回高置信度模式', () => {
    const pm = new PatternMiner();
    for (let i = 0; i < 10; i++) {
      pm.record(makeMsg('exec'));
      pm.record(makeMsg('report'));
      pm.record(makeMsg('ping'));
      pm.record(makeMsg('pong'));
    }
    const highConf = pm.getHighConfidencePatterns(0.5);
    expect(highConf.length).toBeGreaterThanOrEqual(1);
  });
});
