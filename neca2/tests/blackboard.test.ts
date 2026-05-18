/**
 * blackboard.test.ts — 统一黑板报单元测试
 *
 * 覆盖：读写黑板报、状态更新、消息记录、neca 状态检测
 *
 * 运行: npx vitest run tests/blackboard.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'silent-protocol-blackboard-test');
const SHARED_FILE = path.join(TEST_DIR, '.neca', 'shared-blackboard.json');

// 重置模块缓存，确保每次 import 都重新初始化
function resetModules(): void {
  for (const key of Object.keys(import.meta)) {
    // vitest 环境下无法清除缓存，但我们可以直接删除文件
  }
  try { fs.rmSync(path.join(TEST_DIR, '.neca'), { recursive: true }); } catch {}
  try { fs.mkdirSync(path.join(TEST_DIR, '.neca'), { recursive: true }); } catch {}
}

// 设置 HOME 环境变量指向测试目录
const originalHome = process.env.HOME || process.env.USERPROFILE || '';
process.env.HOME = TEST_DIR;
process.env.USERPROFILE = TEST_DIR;

describe('Blackboard', () => {
  beforeEach(() => {
    // 清理黑板报文件
    try { fs.rmSync(path.join(TEST_DIR, '.neca'), { recursive: true }); } catch {}
    try { fs.mkdirSync(path.join(TEST_DIR, '.neca'), { recursive: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(path.join(TEST_DIR, '.neca'), { recursive: true }); } catch {}
  });

  // ============================================================
  // 读写黑板报
  // ============================================================

  describe('读写黑板报', () => {
    it('读取空黑板报应返回 null', async () => {
      const { readBlackboard } = await import('../src/shared/blackboard');
      const bb = readBlackboard();
      expect(bb).toBeNull();
    });

    it('写入后应能读取', async () => {
      const { writeSelfStatus, readBlackboard } = await import('../src/shared/blackboard');
      const result = writeSelfStatus('neca2', 'alive');
      expect(result).toBe(true);

      const bb = readBlackboard();
      expect(bb).not.toBeNull();
      expect(bb!.agents.neca2).toBeDefined();
      expect(bb!.agents.neca2!.status).toBe('alive');
    });

    it('黑板报应包含 session 统计', async () => {
      const { writeSelfStatus, readBlackboard } = await import('../src/shared/blackboard');
      writeSelfStatus('neca2', 'alive');
      const bb = readBlackboard();
      expect(bb!.sessions).toBeDefined();
      expect(typeof bb!.sessions.total).toBe('number');
    });

    it('黑板报应包含 retry 队列统计', async () => {
      const { writeSelfStatus, readBlackboard } = await import('../src/shared/blackboard');
      writeSelfStatus('neca2', 'alive');
      const bb = readBlackboard();
      expect(bb!.retryQueue).toBeDefined();
      expect(typeof bb!.retryQueue.depth).toBe('number');
    });
  });

  // ============================================================
  // 消息记录
  // ============================================================

  describe('消息记录', () => {
    it('添加消息应在黑板报中可见', async () => {
      const { addMessageToBlackboard, readBlackboard } = await import('../src/shared/blackboard');
      addMessageToBlackboard('cloud_ds', 'local_claude', 'exec', 'echo hello');

      const bb = readBlackboard();
      expect(bb!.recentMessages.length).toBe(1);
      expect(bb!.recentMessages[0].from).toBe('cloud_ds');
      expect(bb!.recentMessages[0].to).toBe('local_claude');
      expect(bb!.recentMessages[0].type).toBe('exec');
    });

    it('最多保留 20 条消息', async () => {
      const { addMessageToBlackboard, readBlackboard } = await import('../src/shared/blackboard');
      for (let i = 0; i < 25; i++) {
        addMessageToBlackboard('test', 'test', 'ping', `msg ${i}`);
      }
      const bb = readBlackboard();
      expect(bb!.recentMessages.length).toBe(20);
    });
  });

  // ============================================================
  // 摘要
  // ============================================================

  describe('摘要', () => {
    it('getBlackboardSummary 应返回包含 agent 信息的字符串', async () => {
      const { writeSelfStatus, getBlackboardSummary } = await import('../src/shared/blackboard');
      writeSelfStatus('neca2', 'alive');
      const summary = getBlackboardSummary();
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).toContain('neca2');
    });

    it('isNecaAlive 当 neca 不在黑板报时应返回 false', async () => {
      const { isNecaAlive } = await import('../src/shared/blackboard');
      expect(isNecaAlive()).toBe(false);
    });
  });
});
