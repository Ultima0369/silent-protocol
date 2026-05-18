// ---- 用户主权权限系统测试 ----
import { describe, it, expect, beforeEach } from 'vitest';
import {
  permissionManager,
  initPermissions,
  canExec,
  canWrite,
  canAdmin,
  getPermissionSummary,
  INDUSTRY_LEVELS,
} from '../src/utils/permissions.js';
import type { PermissionEntry } from '../src/utils/permissions.js';

describe('用户主权权限系统', () => {
  beforeEach(() => {
    // 每次测试前重置
    permissionManager.revoke();
    permissionManager.grant('view', { effect: 'persist', description: '默认只读' });
  });

  // ============================================================
  // 行业标准 L0-L5
  // ============================================================

  it('应提供 6 个行业等级 (L0-L5)', () => {
    expect(INDUSTRY_LEVELS.length).toBe(6);
    expect(INDUSTRY_LEVELS[0].level).toBe(0);
    expect(INDUSTRY_LEVELS[5].level).toBe(5);
  });

  it('L5 完全信任应有所有能力', () => {
    const l5 = INDUSTRY_LEVELS[5];
    expect(l5.allowedCaps).toContain('trust');
    expect(l5.allowedCaps).toContain('view');
    expect(l5.allowedCaps).toContain('exec');
    expect(l5.allowedCaps).toContain('write');
    expect(l5.allowedCaps).toContain('admin');
  });

  // ============================================================
  // 权限检查
  // ============================================================

  it('默认应为 L1（只读）', () => {
    expect(permissionManager.currentLevel()).toBe(1);
    expect(permissionManager.can('view').allowed).toBe(true);
    expect(permissionManager.can('exec').allowed).toBe(false);
  });

  it('授予 exec 后应提升到 L2', () => {
    permissionManager.grant('exec', { effect: 'session' });
    expect(permissionManager.currentLevel()).toBe(2);
    expect(permissionManager.can('exec').allowed).toBe(true);
    expect(permissionManager.can('write').allowed).toBe(false);
  });

  it('授予 write 后应提升到 L3', () => {
    permissionManager.grant(['exec', 'write'], { effect: 'session' });
    expect(permissionManager.currentLevel()).toBe(3);
    expect(permissionManager.can('write').allowed).toBe(true);
    expect(permissionManager.can('admin').allowed).toBe(false);
  });

  it('setLevel 应正确设置权限等级', () => {
    permissionManager.setLevel(4, 'session');
    expect(permissionManager.currentLevel()).toBe(4);
    expect(permissionManager.can('admin').allowed).toBe(true);
    expect(permissionManager.can('trust').allowed).toBe(false);
  });

  it('trust() 应设置为 L5', () => {
    permissionManager.trust();
    expect(permissionManager.currentLevel()).toBe(5);
    expect(permissionManager.can('trust').allowed).toBe(true);
    expect(permissionManager.can('exec').allowed).toBe(true);
  });

  // ============================================================
  // 权限拒绝
  // ============================================================

  it('权限不足时应返回拒绝原因', () => {
    const result = permissionManager.can('exec');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('L1');
  });

  // ============================================================
  // 路径约束
  // ============================================================

  it('路径约束应生效', () => {
    permissionManager.grant('write', { scope: 'directory', path: '/home/project', effect: 'session' });
    expect(permissionManager.can('write', '/home/project/src').allowed).toBe(true);
    expect(permissionManager.can('write', '/etc/passwd').allowed).toBe(false);
  });

  // ============================================================
  // One-shot 权限
  // ============================================================

  it('one-shot 权限只能使用一次', () => {
    permissionManager.grant('exec', { effect: 'one-shot', description: '仅一次执行' });
    expect(permissionManager.can('exec').allowed).toBe(true);
    // 使用
    expect(permissionManager.useOneShot('exec')).toBe(true);
    // 使用后应过期
    expect(permissionManager.can('exec').allowed).toBe(false);
  });

  // ============================================================
  // 撤销
  // ============================================================

  it('撤销后权限应降级', () => {
    permissionManager.setLevel(4, 'session');
    expect(permissionManager.currentLevel()).toBe(4);
    permissionManager.revoke('admin');
    expect(permissionManager.currentLevel()).toBe(3);
    permissionManager.revoke('write');
    expect(permissionManager.currentLevel()).toBe(2);
    permissionManager.revoke('exec');
    expect(permissionManager.currentLevel()).toBe(1);
  });

  // ============================================================
  // snapshot
  // ============================================================

  it('snapshot 应包含完整状态', () => {
    const snap = permissionManager.snapshot();
    expect(snap.level).toBeGreaterThanOrEqual(0);
    expect(snap.level).toBeLessThanOrEqual(5);
    expect(snap.label).toBeDefined();
    expect(snap.allowed).toBeInstanceOf(Array);
    expect(snap.entries).toBeInstanceOf(Array);
    expect(typeof snap.isTrusted).toBe('boolean');
  });

  // ============================================================
  // 快速检查函数
  // ============================================================

  it('快速检查函数应正确', () => {
    // 默认 L1：只有 view
    expect(canExec()).toBe(false);
    expect(canWrite()).toBe(false);
    expect(canAdmin()).toBe(false);

    permissionManager.setLevel(5);
    expect(canExec()).toBe(true);
    expect(canWrite()).toBe(true);
    expect(canAdmin()).toBe(true);
  });

  // ============================================================
  // 摘要
  // ============================================================

  it('summary 应返回人类可读字符串', () => {
    const summary = getPermissionSummary();
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  // ============================================================
  // 权限变更日志
  // ============================================================

  it('多次 grant 相同权限应去重', () => {
    const before = permissionManager.snapshot().entries.length;
    permissionManager.grant('view', { effect: 'session' });
    permissionManager.grant('view', { effect: 'session' });
    permissionManager.grant('view', { effect: 'session' });
    const after = permissionManager.snapshot().entries.length;
    // 应该只增加一条，不是三条
    expect(after - before).toBe(1);
  });
});
