// ---- 用户主权权限系统 ----
// 既尊重业界 L0-L5 安全标准，又提供用户主权入口
//
// 核心理念：
//   安全不是铁律，是用户与 AI 之间的动态契约。
//   用户可以在对话过程中随时调整权限。
//   系统诚实报告自己当前能做什么、不能做什么。
//
// 权限模型：三维矩阵（范围 × 能力 × 生效方式）
//   范围(scope):    global | project | directory | file
//   能力(cap):      view | exec | write | admin | trust
//   生效(effect):   persist | session | one-shot
//
// 映射到行业 L0-L5:
//   L0(锁定)   → 仅 ping/pong
//   L1(只读)   → view
//   L2(执行)   → view + exec
//   L3(写入)   → view + exec + write
//   L4(管理)   → view + exec + write + admin
//   L5(完全信任) → trust（无限制）

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from './logger.js';

// ============================================================
// 类型定义
// ============================================================

export type Scope = 'global' | 'project' | 'directory' | 'file';
export type Capability = 'view' | 'exec' | 'write' | 'admin' | 'trust';
export type Effect = 'persist' | 'session' | 'one-shot';

/** 单条权限条目 */
export interface PermissionEntry {
  scope: Scope;
  capability: Capability;
  effect: Effect;
  /** 路径约束（scope 为 directory/file 时有效） */
  path?: string;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间（session 级别到会话结束，one-shot 使用后失效） */
  expiresAt?: number;
  /** 是否已使用（one-shot 用） */
  used?: boolean;
  /** 人类可读的描述（来自用户原话） */
  description?: string;
}

/** 权限状态快照 */
export interface PermissionSnapshot {
  level: number;           // L0-L5
  label: string;           // 中文标签
  allowed: Capability[];   // 允许的能力
  effectiveScopes: Scope[];
  entries: PermissionEntry[];
  isTrusted: boolean;      // 是否完全信任
  createdAt: number;
}

// ============================================================
// 行业标准 L0-L5 定义
// ============================================================

export interface IndustryLevel {
  level: number;
  label: string;
  description: string;
  allowedCaps: Capability[];
  icon: string;
}

export const INDUSTRY_LEVELS: IndustryLevel[] = [
  { level: 0, label: '锁定', description: '仅心跳通信，不可执行任何操作', allowedCaps: [], icon: '🔒' },
  { level: 1, label: '只读', description: '可查看文件和搜索，不可执行或修改', allowedCaps: ['view'], icon: '👁️' },
  { level: 2, label: '执行', description: '可查看和执行白名单命令，不可写入', allowedCaps: ['view', 'exec'], icon: '⚡' },
  { level: 3, label: '写入', description: '可查看、执行、创建和修改文件', allowedCaps: ['view', 'exec', 'write'], icon: '✏️' },
  { level: 4, label: '管理', description: '可安装软件、修改配置、管理系统', allowedCaps: ['view', 'exec', 'write', 'admin'], icon: '🛠️' },
  { level: 5, label: '完全信任', description: '无限制，如同老友', allowedCaps: ['view', 'exec', 'write', 'admin', 'trust'], icon: '🤝' },
];

// ============================================================
// 权限管理器
// ============================================================

const PERM_FILE = path.join(os.homedir(), '.neca2', 'permissions.json');

class PermissionManager {
  private entries: PermissionEntry[] = [];
  private initialized = false;

  /** 初始化：从持久化文件加载权限 */
  init(): PermissionSnapshot {
    if (this.initialized) return this.snapshot();
    this.initialized = true;

    // 尝试从文件加载持久化权限
    try {
      if (fs.existsSync(PERM_FILE)) {
        const data = JSON.parse(fs.readFileSync(PERM_FILE, 'utf-8'));
        if (Array.isArray(data.entries)) {
          this.entries = data.entries;
        }
      }
    } catch {
      this.entries = [];
    }

    // 如果没有任何权限条目，默认 L1（只读）
    if (this.entries.length === 0) {
      this.entries.push({
        scope: 'global',
        capability: 'view',
        effect: 'persist',
        createdAt: Date.now(),
        description: '默认：只读权限',
      });
      this.save();
    }

    logger.info('Permission manager initialized', {
      level: this.currentLevel(),
      entries: this.entries.length,
    }, { module: 'permissions' });

    return this.snapshot();
  }

  /** 保存到磁盘 */
  private save(): void {
    try {
      const dir = path.dirname(PERM_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PERM_FILE, JSON.stringify({ entries: this.entries, updatedAt: Date.now() }, null, 2), 'utf-8');
    } catch {
      // silent
    }
  }

  /** 添加一条权限 */
  grant(
    capability: Capability | Capability[],
    options: {
      scope?: Scope;
      effect?: Effect;
      path?: string;
      description?: string;
    } = {}
  ): PermissionSnapshot {
    const caps = Array.isArray(capability) ? capability : [capability];
    const scope = options.scope || 'global';
    const effect = options.effect || 'session';

    for (const cap of caps) {
      // 去重：同 scope+capability+effect 不重复添加
      const existing = this.entries.find(
        e => e.scope === scope && e.capability === cap && e.effect === effect && e.path === options.path
      );
      if (existing) continue;

      this.entries.push({
        scope,
        capability: cap,
        effect,
        path: options.path,
        createdAt: Date.now(),
        expiresAt: effect === 'one-shot' ? undefined : undefined,
        description: options.description || `授予 ${cap} 权限`,
      });
    }

    // 清理过期条目
    this.cleanup();
    this.save();
    this.logPermissionChange('grant', caps, scope, effect);

    return this.snapshot();
  }

  /** 撤销一条权限 */
  revoke(
    capability?: Capability,
    options: { scope?: Scope; effect?: Effect; path?: string } = {}
  ): PermissionSnapshot {
    if (capability) {
      this.entries = this.entries.filter(e => {
        if (options.scope && e.scope !== options.scope) return true;
        if (options.effect && e.effect !== options.effect) return true;
        if (options.path && e.path !== options.path) return true;
        return e.capability !== capability;
      });
    } else {
      // 不指定能力则撤销所有
      if (options.scope) {
        this.entries = this.entries.filter(e => e.scope !== options.scope);
      } else {
        this.entries = [];
        // 保留默认只读
        this.entries.push({
          scope: 'global',
          capability: 'view',
          effect: 'persist',
          createdAt: Date.now(),
          description: '默认：只读权限',
        });
      }
    }

    this.save();
    this.logPermissionChange('revoke', capability ? [capability] : ['view']);
    return this.snapshot();
  }

  /** 设置行业标准 L0-L5 等级 */
  setLevel(level: number, effect: Effect = 'session'): PermissionSnapshot {
    const lvl = INDUSTRY_LEVELS.find(l => l.level === level);
    if (!lvl) return this.snapshot();

    // 清除现有 session 权限
    this.entries = this.entries.filter(e => e.effect === 'persist');
    // 添加新等级对应的能力
    this.grant(lvl.allowedCaps, {
      scope: 'global',
      effect,
      description: `行业等级 ${lvl.icon} L${level}: ${lvl.label}`,
    });

    logger.info('Permission level set', { level, label: lvl.label, effect }, { module: 'permissions' });
    return this.snapshot();
  }

  /** 一键信任（L5） */
  trust(effect: Effect = 'session'): PermissionSnapshot {
    return this.setLevel(5, effect);
  }

  /** 检查是否允许某项操作 */
  can(capability: Capability, targetPath?: string): { allowed: boolean; reason?: string } {
    this.cleanup();

    // trust 级别允许一切
    if (this.hasCapability('trust')) {
      return { allowed: true };
    }

    // 检查是否有对应能力
    if (!this.hasCapability(capability)) {
      const level = this.currentLevel();
      const lvl = INDUSTRY_LEVELS[level];
      return {
        allowed: false,
        reason: `当前权限等级 ${lvl.icon} L${level} (${lvl.label})，不允许 ${this.capLabel(capability)}。需要升级到 L${this.minLevelFor(capability)} 以上。`,
      };
    }

    // 如果有路径约束，检查路径是否在允许范围内
    if (targetPath) {
      const pathEntries = this.entries.filter(e => e.path);
      if (pathEntries.length > 0) {
        const allowed = pathEntries.some(e => {
          if (!e.path) return true;
          return targetPath.startsWith(e.path);
        });
        if (!allowed) {
          return {
            allowed: false,
            reason: `路径 "${targetPath}" 不在允许的范围内。当前允许: ${pathEntries.map(e => e.path).join(', ')}`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /** 使用一次 one-shot 权限 */
  useOneShot(capability: Capability): boolean {
    const entry = this.entries.find(e => e.capability === capability && e.effect === 'one-shot' && !e.used);
    if (entry) {
      entry.used = true;
      this.save();
      return true;
    }
    return false;
  }

  /** 获取当前权限等级 (L0-L5) */
  currentLevel(): number {
    const caps = this.effectiveCapabilities();
    if (caps.includes('trust')) return 5;
    if (caps.includes('admin')) return 4;
    if (caps.includes('write')) return 3;
    if (caps.includes('exec')) return 2;
    if (caps.includes('view')) return 1;
    return 0;
  }

  /** 获取当前生效的能力列表 */
  effectiveCapabilities(): Capability[] {
    this.cleanup();
    const caps = new Set<Capability>();
    for (const entry of this.entries) {
      if (entry.effect === 'one-shot' && entry.used) continue;
      caps.add(entry.capability);
    }
    return Array.from(caps);
  }

  /** 生成权限快照 */
  snapshot(): PermissionSnapshot {
    const level = this.currentLevel();
    return {
      level,
      label: INDUSTRY_LEVELS[level]?.label || '未知',
      allowed: this.effectiveCapabilities(),
      effectiveScopes: [...new Set(this.entries.filter(e => !(e.effect === 'one-shot' && e.used)).map(e => e.scope))],
      entries: [...this.entries],
      isTrusted: level >= 5,
      createdAt: Date.now(),
    };
  }

  /** 获取人类可读的权限摘要 */
  summary(): string {
    const snap = this.snapshot();
    const lvl = INDUSTRY_LEVELS[snap.level];
    const caps = snap.allowed.map(c => this.capLabel(c)).join('、');
    return `${lvl?.icon || '🔒'} L${snap.level} ${lvl?.label || ''} — 可操作: ${caps || '无'}`;
  }

  // ---- 内部方法 ----

  private hasCapability(cap: Capability): boolean {
    return this.effectiveCapabilities().includes(cap);
  }

  private minLevelFor(cap: Capability): number {
    for (const lvl of INDUSTRY_LEVELS) {
      if (lvl.allowedCaps.includes(cap)) return lvl.level;
    }
    return 5;
  }

  private capLabel(cap: Capability): string {
    const map: Record<Capability, string> = {
      view: '查看',
      exec: '执行',
      write: '写入',
      admin: '管理',
      trust: '完全信任',
    };
    return map[cap] || cap;
  }

  /** 清理过期/已使用的条目 */
  private cleanup(): void {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => {
      if (e.effect === 'one-shot' && e.used) return false;
      if (e.expiresAt && e.expiresAt < Date.now()) return false;
      return true;
    });
    if (this.entries.length !== before) {
      this.save();
    }
  }

  private logPermissionChange(action: string, caps: Capability[], scope?: Scope, effect?: Effect): void {
    logger.info('Permission changed', {
      action,
      capabilities: caps,
      scope,
      effect,
      newLevel: this.currentLevel(),
    }, { module: 'permissions' });
  }
}

// ============================================================
// 全局单例
// ============================================================

export const permissionManager = new PermissionManager();

/** 初始化权限系统 */
export function initPermissions(): PermissionSnapshot {
  return permissionManager.init();
}

/** 快速检查：是否允许执行 */
export function canExec(): boolean {
  return permissionManager.can('exec').allowed;
}

/** 快速检查：是否允许写入 */
export function canWrite(): boolean {
  return permissionManager.can('write').allowed;
}

/** 快速检查：是否允许管理 */
export function canAdmin(): boolean {
  return permissionManager.can('admin').allowed;
}

/** 获取当前权限摘要字符串 */
export function getPermissionSummary(): string {
  return permissionManager.summary();
}
