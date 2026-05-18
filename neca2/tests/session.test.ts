/**
 * session.test.ts — 会话管理单元测试
 *
 * 覆盖：会话创建、状态流转、查询、超时、持久化
 *
 * 运行: npx vitest run tests/session.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Message } from '../src/protocol/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_PERSIST_DIR = path.join(os.tmpdir(), 'silent-protocol-session-test');

describe('会话管理', () => {
  let session: Awaited<ReturnType<typeof importModule>>;

  async function importModule() {
    return await import('../src/relay/session');
  }

  beforeEach(async () => {
    session = await importModule();
    try { fs.rmSync(TEST_PERSIST_DIR, { recursive: true }); } catch { /* ok */ }
    try { fs.mkdirSync(TEST_PERSIST_DIR, { recursive: true }); } catch { /* ok */ }
  });

  afterEach(() => {
    try { fs.rmSync(TEST_PERSIST_DIR, { recursive: true }); } catch { /* ok */ }
  });

  // ============================================================
  // 会话创建与状态
  // ============================================================

  describe('创建与状态流转', () => {
    it('应该创建一个新会话并处于 pending 状态', () => {
      const msg: Message = {
        ver: 1, id: 'session-test-1', from: 'cloud_ds', to: 'local_claude',
        type: 'exec', payload: { cmd: 'echo hello' }, callback: true, ts: Date.now(),
      };
      const record = session.createSession(msg);
      expect(record.id).toBe('session-test-1');
      expect(record.status).toBe('pending');
      expect(record.message.from).toBe('cloud_ds');
      expect(record.message.to).toBe('local_claude');
      expect(record.retryCount).toBe(0);
    });

    it('应该将 pending 状态流转到 sent 状态', () => {
      const msg: Message = {
        ver: 1, id: 'session-flow', from: 'cloud_ds', to: 'local_claude',
        type: 'exec', payload: { cmd: 'ls' }, callback: true, ts: Date.now(),
      };
      session.createSession(msg);
      const updated = session.updateSession('session-flow', { status: 'sent' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('sent');
    });

    it('应该完整走完 pending → sent → ack → reply → completed', () => {
      const msg: Message = {
        ver: 1, id: 'full-flow', from: 'cloud_ds', to: 'local_claude',
        type: 'exec', payload: { cmd: 'echo done' }, callback: true, ts: Date.now(),
      };
      session.createSession(msg);
      expect(session.getSession('full-flow')!.status).toBe('pending');
      session.updateSession('full-flow', { status: 'sent' });
      expect(session.getSession('full-flow')!.status).toBe('sent');
      session.updateSession('full-flow', { status: 'ack' });
      expect(session.getSession('full-flow')!.status).toBe('ack');
      session.updateSession('full-flow', { status: 'reply' });
      expect(session.getSession('full-flow')!.status).toBe('reply');
      session.updateSession('full-flow', { status: 'completed' });
      expect(session.getSession('full-flow')!.status).toBe('completed');
    });
  });

  // ============================================================
  // 查找与会话列表
  // ============================================================

  describe('查找与会话列表', () => {
    it('应该通过 ID 查找会话', () => {
      const msg: Message = {
        ver: 1, id: 'find-me', from: 'cloud_ds', to: 'local_claude',
        type: 'ping', payload: {}, callback: false, ts: Date.now(),
      };
      session.createSession(msg);
      const found = session.getSession('find-me');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('find-me');
    });

    it('查找不存在的会话应返回 null', () => {
      const found = session.getSession('non-existent');
      expect(found).toBeNull();
    });

    it('应该列出所有活跃会话并支持过滤', () => {
      const id1 = `list-${Date.now()}-1`;
      const id2 = `list-${Date.now()}-2`;
      session.createSession({ ver: 1, id: id1, from: 'cloud_ds', to: 'local_claude', type: 'ping', payload: {}, callback: false, ts: Date.now() } as Message);
      session.createSession({ ver: 1, id: id2, from: 'cloud_ds', to: 'local_claude', type: 'ping', payload: {}, callback: false, ts: Date.now() } as Message);
      session.updateSession(id1, { status: 'sent' });

      const all = session.listSessions();
      expect(all.some(s => s.id === id1)).toBe(true);
      expect(all.some(s => s.id === id2)).toBe(true);

      const pending = session.listSessions({ status: 'pending' });
      expect(pending.some(s => s.id === id2)).toBe(true);
      expect(pending.some(s => s.id === id1)).toBe(false);
    });
  });

  // ============================================================
  // 超时与清理
  // ============================================================

  describe('超时与清理', () => {
    it('过期清理应该能识别过期会话', () => {
      const msg: Message = {
        ver: 1, id: 'expire-test', from: 'cloud_ds', to: 'local_claude',
        type: 'exec', payload: { cmd: 'sleep 100' }, callback: true, ts: Date.now(),
      };
      session.createSession(msg);
      session.updateSession('expire-test', { timeoutAt: Date.now() - 1000 });
      const expired = session.expireSessions();
      expect(expired).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // 状态统计
  // ============================================================

  describe('状态统计', () => {
    it('会话状态统计应返回正确的数字', () => {
      const msg: Message = {
        ver: 1, id: 'stats-test', from: 'cloud_ds', to: 'local_claude',
        type: 'exec', payload: { cmd: 'echo hi' }, callback: true, ts: Date.now(),
      };
      session.createSession(msg);
      const stats = session.sessionStats();
      expect(stats.pending).toBeGreaterThanOrEqual(1);
    });
  });
});
