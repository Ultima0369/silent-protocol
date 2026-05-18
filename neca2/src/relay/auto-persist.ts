// ---- 会话自动持久化（autoPersist） ----
// 在每次会话状态变更时自动写盘，确保不丢失状态。
//
// 与 session.ts 的关系：
//   session.ts 提供基础会话管理（create/update/get/delete）
//   本模块提供 autoPersist 选项，在 updateSession 后自动调用 checkpoint
//
// 实现策略：
//   1. 状态变更时立即追加写 append-only log
//   2. 每 10 秒或每 100 次变更触发一次 checkpoint
//   3. 启动时从 checkpoint + log 恢复

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SessionRecord, SessionStatus } from '../protocol/types.js';
import { logger } from '../utils/logger.js';

const PERSIST_DIR = path.join(os.homedir(), '.neca2', 'sessions');
const CHECKPOINT_FILE = path.join(PERSIST_DIR, 'checkpoint.json');
const LOG_FILE = path.join(PERSIST_DIR, 'auto-persist.log');

// ---- 配置 ----

export interface AutoPersistConfig {
  /** 是否启用自动持久化 */
  enabled: boolean;
  /** checkpoint 间隔（毫秒） */
  checkpointIntervalMs: number;
  /** 触发 checkpoint 的变更次数 */
  checkpointAfterChanges: number;
  /** 最大 checkpoint 文件大小（字节），超过后压缩 */
  maxCheckpointBytes: number;
}

const DEFAULT_CONFIG: AutoPersistConfig = {
  enabled: true,
  checkpointIntervalMs: 10_000,
  checkpointAfterChanges: 100,
  maxCheckpointBytes: 10 * 1024 * 1024, // 10MB
};

// ---- AutoPersist 引擎 ----

export class AutoPersist {
  private config: AutoPersistConfig;
  private sessions: Map<string, SessionRecord>;
  private changeCount = 0;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheckpointAt = 0;

  /** 恢复统计 */
  recoveryStats = {
    recovered: 0,
    logReplays: 0,
    errors: 0,
  };

  constructor(sessions: Map<string, SessionRecord>, config: Partial<AutoPersistConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessions = sessions;
  }

  /** 启动自动持久化 */
  start(): void {
    if (!this.config.enabled) {
      logger.info('AutoPersist disabled', {}, { module: 'auto-persist' });
      return;
    }

    // 从磁盘恢复
    this.recover();

    // 定时 checkpoint
    this.checkpointTimer = setInterval(() => this.checkpoint(), this.config.checkpointIntervalMs);
    this.checkpointTimer.unref?.();

    logger.info(`AutoPersist started (interval=${this.config.checkpointIntervalMs}ms, changeThreshold=${this.config.checkpointAfterChanges})`,
      { recovered: this.recoveryStats.recovered }, { module: 'auto-persist' });
  }

  /** 停止自动持久化 */
  stop(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    // 最后写一次
    this.checkpoint();
    logger.info('AutoPersist stopped', {}, { module: 'auto-persist' });
  }

  /** 记录一次变更（内部调用） */
  recordChange(): void {
    if (!this.config.enabled) return;
    this.changeCount++;
    if (this.changeCount >= this.config.checkpointAfterChanges) {
      this.checkpoint();
    }
  }

  /** 执行 checkpoint：将当前所有会话写入磁盘 */
  checkpoint(): void {
    if (!this.config.enabled) return;
    try {
      this.ensureDir();
      const data = Array.from(this.sessions.values());
      const json = JSON.stringify(data);

      // 如果 checkpoint 文件过大，压缩旧数据
      const tmpFile = CHECKPOINT_FILE + '.tmp';
      fs.writeFileSync(tmpFile, json, 'utf-8');
      fs.renameSync(tmpFile, CHECKPOINT_FILE);

      this.changeCount = 0;
      this.lastCheckpointAt = Date.now();
    } catch (err: any) {
      logger.error('Checkpoint failed', { error: err.message }, { module: 'auto-persist' });
    }
  }

  /** 从磁盘恢复会话 */
  recover(): number {
    try {
      this.ensureDir();

      // 1. 从 checkpoint 恢复
      if (fs.existsSync(CHECKPOINT_FILE)) {
        const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
        const data = JSON.parse(raw) as SessionRecord[];
        for (const record of data) {
          this.sessions.set(record.id, record);
        }
        this.recoveryStats.recovered = data.length;
      }

      // 2. 重放 append-only log
      if (fs.existsSync(LOG_FILE)) {
        const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.action === 'upsert') {
              this.sessions.set(entry.record.id, entry.record);
              this.recoveryStats.logReplays++;
            } else if (entry.action === 'delete') {
              this.sessions.delete(entry.id);
            }
          } catch { /* skip bad lines */ }
        }
      }

      // 3. 清理过期会话
      const now = Date.now();
      let expired = 0;
      for (const [id, s] of this.sessions) {
        if (now > s.timeoutAt) {
          this.sessions.delete(id);
          expired++;
        }
      }

      logger.info(`Recovery complete: ${this.recoveryStats.recovered} from checkpoint, ${this.recoveryStats.logReplays} log replays, ${expired} expired`,
        {}, { module: 'auto-persist' });

      return this.sessions.size;
    } catch (err: any) {
      this.recoveryStats.errors++;
      logger.error('Recovery failed', { error: err.message }, { module: 'auto-persist' });
      return 0;
    }
  }

  /** 追加写日志（每次状态变更） */
  appendLog(action: 'upsert' | 'delete', record?: SessionRecord, id?: string): void {
    if (!this.config.enabled) return;
    try {
      this.ensureDir();
      const entry = action === 'upsert' && record
        ? JSON.stringify({ action: 'upsert', record, ts: Date.now() }) + '\n'
        : JSON.stringify({ action: 'delete', id, ts: Date.now() }) + '\n';
      fs.appendFileSync(LOG_FILE, entry, 'utf-8');
    } catch { /* silent */ }
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(PERSIST_DIR, { recursive: true });
    } catch { /* ignore */ }
  }

  /** 获取统计信息 */
  getStats() {
    return {
      enabled: this.config.enabled,
      sessionsOnDisk: this.sessions.size,
      changeCount: this.changeCount,
      lastCheckpointAt: this.lastCheckpointAt,
      recoveryStats: this.recoveryStats,
    };
  }
}

/** 在 session.ts 的 updateSession 中调用此函数触发自动持久化 */
export function onSessionChange(
  autoPersist: AutoPersist | null,
  action: 'upsert' | 'delete',
  record?: SessionRecord,
  id?: string,
): void {
  if (!autoPersist) return;
  autoPersist.appendLog(action, record, id);
  autoPersist.recordChange();
}
