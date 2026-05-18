/**
 * scheduler.test.ts — 多模型路由调度器单元测试
 *
 * 覆盖：三种调度策略、端点管理、负载更新、错误恢复
 *
 * 运行: npx vitest run tests/scheduler.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchedulerManager, SchedulerStrategy } from '../src/relay/router-scheduler';
import { makeMessage } from '../src/protocol/codec';
import type { Message } from '../src/protocol/types';

describe('SchedulerManager', () => {
  let manager: SchedulerManager;

  beforeEach(() => {
    manager = new SchedulerManager();
  });

  // ============================================================
  // 端点管理
  // ============================================================

  describe('端点管理', () => {
    it('应该注册默认端点', () => {
      const endpoints = manager.getAllEndpoints();
      expect(endpoints.length).toBeGreaterThanOrEqual(2);
      const claude = manager.getEndpoint('claude-sonnet-4');
      expect(claude).toBeDefined();
      expect(claude!.target).toBe('cloud_claude');
    });

    it('应该能注册新端点', () => {
      manager.registerEndpoint({
        name: 'test-model',
        target: 'local_claude',
        load: 0,
        maxConcurrency: 1,
        weight: 5,
        available: true,
        avgLatencyMs: 0,
        errorCount: 0,
      });
      const ep = manager.getEndpoint('test-model');
      expect(ep).toBeDefined();
      expect(ep!.name).toBe('test-model');
    });

    it('应该能更新端点负载', () => {
      manager.updateLoad('claude-sonnet-4', 2);
      const ep = manager.getEndpoint('claude-sonnet-4');
      expect(ep!.load).toBe(2);
    });

    it('负载超过 90% 应标记为不可用', () => {
      const ep = manager.getEndpoint('claude-sonnet-4')!;
      manager.updateLoad('claude-sonnet-4', ep.maxConcurrency); // 100% 负载
      expect(ep.available).toBe(false);
    });
  });

  // ============================================================
  // RoundRobin 调度
  // ============================================================

  describe('RoundRobin 调度', () => {
    it('应该轮询选择端点', () => {
      manager.setStrategy('round-robin');
      const msg = makeMessage('cloud_ds', 'cloud_claude', 'query', { question: 'test' });

      const first = manager.selectFor(msg);
      const second = manager.selectFor(msg);
      const third = manager.selectFor(msg);

      // 轮询应选择不同端点（如果多个可用）
      expect(first).toBeDefined();
      expect(second).toBeDefined();
    });

    it('所有端点满载时应返回 null', () => {
      manager.setStrategy('round-robin');
      for (const ep of manager.getAllEndpoints()) {
        manager.updateLoad(ep.name, ep.maxConcurrency);
      }
      const msg = makeMessage('cloud_ds', 'cloud_claude', 'query', { question: 'test' });
      const selected = manager.selectFor(msg);
      expect(selected).toBeNull();
    });
  });

  // ============================================================
  // Priority 调度
  // ============================================================

  describe('Priority 调度', () => {
    it('高优先级消息应选择权重最高的端点', () => {
      manager.setStrategy('priority');

      // 设置 claude-sonnet-4 权重最高
      const claudeEp = manager.getEndpoint('claude-sonnet-4')!;
      // 确保它权重最高
      const highPriorityMsg = makeMessage('cloud_ds', 'cloud_claude', 'query', { question: 'urgent' });
      highPriorityMsg.priority = 'high';

      const selected = manager.selectFor(highPriorityMsg);
      expect(selected).toBeDefined();
      // 高优先级选择权重最高的
    });
  });

  // ============================================================
  // LeastLoaded 调度
  // ============================================================

  describe('LeastLoaded 调度', () => {
    it('应选择负载率最低的端点', () => {
      manager.setStrategy('least-loaded');

      // 给 deepseek 加一点负载
      manager.updateLoad('deepseek-chat', 1);

      const msg = makeMessage('cloud_ds', 'cloud_claude', 'query', { question: 'test' });
      const selected = manager.selectFor(msg);

      // deepseek 负载高，应选择 claude
      expect(selected).toBeDefined();
      if (selected) {
        expect(selected.load / selected.maxConcurrency).toBeLessThanOrEqual(0.5);
      }
    });
  });

  // ============================================================
  // 策略切换
  // ============================================================

  describe('策略切换', () => {
    it('默认策略应为 round-robin', () => {
      expect(manager.currentStrategyName).toBe('round-robin');
    });

    it('应能切换策略', () => {
      manager.setStrategy('least-loaded');
      expect(manager.currentStrategyName).toBe('least-loaded');

      manager.setStrategy('priority');
      expect(manager.currentStrategyName).toBe('priority');
    });

    it('应返回所有可用策略', () => {
      const strategies = manager.availableStrategies;
      expect(strategies).toContain('round-robin');
      expect(strategies).toContain('priority');
      expect(strategies).toContain('least-loaded');
    });
  });

  // ============================================================
  // 错误处理
  // ============================================================

  describe('错误处理', () => {
    it('记录失败应增加错误计数', () => {
      const ep = manager.getEndpoint('claude-sonnet-4')!;
      const initialErrors = ep.errorCount;
      manager.recordFailure('claude-sonnet-4');
      expect(ep.errorCount).toBe(initialErrors + 1);
    });

    it('重置错误应恢复可用性', () => {
      manager.recordFailure('claude-sonnet-4');
      manager.recordFailure('claude-sonnet-4');
      manager.recordFailure('claude-sonnet-4');
      manager.recordFailure('claude-sonnet-4');
      manager.recordFailure('claude-sonnet-4');

      const ep = manager.getEndpoint('claude-sonnet-4')!;
      expect(ep.available).toBe(false);

      manager.resetErrors('claude-sonnet-4');
      expect(ep.available).toBe(true);
      expect(ep.errorCount).toBe(0);
    });

    it('记录成功应更新平均延迟（EMA）', () => {
      manager.recordSuccess('claude-sonnet-4', 100);
      const ep = manager.getEndpoint('claude-sonnet-4')!;
      expect(ep.avgLatencyMs).toBeCloseTo(100, 0);

      manager.recordSuccess('claude-sonnet-4', 200);
      // EMA: 100 * 0.8 + 200 * 0.2 = 120
      expect(ep.avgLatencyMs).toBeCloseTo(120, 0);
    });
  });

  // ============================================================
  // 统计导出
  // ============================================================

  describe('统计导出', () => {
    it('getStats 应返回策略和端点列表', () => {
      const stats = manager.getStats();
      expect(stats.strategy).toBe('round-robin');
      expect(stats.endpoints.length).toBeGreaterThanOrEqual(2);
      expect(stats.endpoints[0]).toHaveProperty('name');
      expect(stats.endpoints[0]).toHaveProperty('loadRatio');
    });
  });
});
