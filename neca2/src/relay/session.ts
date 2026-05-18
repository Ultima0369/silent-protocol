// ---- 会话管理器（改进版） ----
// 支持持久化：内存 + append-only log + 定期 checkpoint

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Message, SessionRecord, SessionStatus } from '../protocol/types.js';

const SESSION_TTL = 5 * 60 * 1000;        // 5 分钟
const CLEANUP_INTERVAL = 60 * 1000;        // 1 分钟
const CHECKPOINT_INTERVAL = 10 * 60 * 1000; // 10 分钟
const MAX_SESSIONS = 10000;

const SESSIONS_DIR = path.join(os.homedir(), '.neca2', 'sessions');
const LOG_FILE = path.join(SESSIONS_DIR, 'sessions.log');
const CHECKPOINT_FILE = path.join(SESSIONS_DIR, 'checkpoint.json');

const sessions = new Map<string, SessionRecord>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let checkpointTimer: ReturnType<typeof setInterval> | null = null;
let dirty = false;

// ---- 持久化 ----

function ensureDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function appendLog(record: SessionRecord): void {
  ensureDir();
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({ action: 'upsert', record }) + '\n', 'utf-8');
  } catch { /* silent */ }
}

function writeCheckpoint(): void {
  if (!dirty) return;
  ensureDir();
  try {
    const data = Array.from(sessions.values());
    const tmp = CHECKPOINT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, CHECKPOINT_FILE);
    dirty = false;
  } catch { /* silent */ }
}

function recoverFromLog(): void {
  ensureDir();
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8')) as SessionRecord[];
      for (const record of data) {
        sessions.set(record.id, record);
      }
    } catch { /* corrupt checkpoint, ignore */ }
  }
  if (fs.existsSync(LOG_FILE)) {
    try {
      const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.action === 'upsert') {
            sessions.set(entry.record.id, entry.record);
          } else if (entry.action === 'delete') {
            sessions.delete(entry.id);
          }
        } catch { /* skip bad line */ }
      }
    } catch { /* ignore */ }
  }
}

// ---- 公共 API ----

export function initSessionManager(): number {
  if (cleanupTimer) return sessions.size;

  // 从持久化恢复
  recoverFromLog();

  cleanupTimer = setInterval(() => expireSessions(), CLEANUP_INTERVAL);
  cleanupTimer.unref?.();

  checkpointTimer = setInterval(() => writeCheckpoint(), CHECKPOINT_INTERVAL);
  checkpointTimer.unref?.();

  return sessions.size;
}

export function shutdownSessionManager(): void {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
  writeCheckpoint(); // 最后写一次
}

export function createSession(msg: Message): SessionRecord {
  // 上限保护
  if (sessions.size >= MAX_SESSIONS) {
    expireSessions();
    if (sessions.size >= MAX_SESSIONS) {
      // 删除最旧的 10%
      const sorted = Array.from(sessions.entries())
        .sort(([, a], [, b]) => a.createdAt - b.createdAt);
      const toRemove = Math.floor(MAX_SESSIONS * 0.1);
      for (let i = 0; i < toRemove && i < sorted.length; i++) {
        sessions.delete(sorted[i][0]);
      }
    }
  }

  const record: SessionRecord = {
    id: msg.id,
    status: 'pending',
    message: msg,
    response: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    timeoutAt: Date.now() + SESSION_TTL,
    retryCount: 0,
  };
  sessions.set(record.id, record);
  appendLog(record);
  dirty = true;
  return record;
}

export function updateSession(id: string, partial: Partial<SessionRecord>): SessionRecord | null {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, partial, { updatedAt: Date.now() });
  appendLog(s);
  dirty = true;
  return s;
}

export function getSession(id: string): SessionRecord | null {
  return sessions.get(id) ?? null;
}

export function deleteSession(id: string): boolean {
  const existed = sessions.delete(id);
  if (existed) {
    ensureDir();
    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify({ action: 'delete', id }) + '\n', 'utf-8');
    } catch { /* silent */ }
    dirty = true;
  }
  return existed;
}

export function listSessions(filter?: { status?: SessionStatus; to?: string }): SessionRecord[] {
  let result = Array.from(sessions.values());
  if (filter?.status) result = result.filter(s => s.status === filter.status);
  if (filter?.to) result = result.filter(s => s.message.to === filter.to);
  return result;
}

export function expireSessions(): number {
  const now = Date.now();
  let expired = 0;
  for (const [id, s] of sessions) {
    if (now > s.timeoutAt || now - s.createdAt > SESSION_TTL) {
      sessions.delete(id);
      expired++;
    }
  }
  if (expired > 0) dirty = true;
  return expired;
}

export function sessionStats() {
  let pending = 0, sent = 0, running = 0, ackR = 0, replyR = 0, completed = 0, timeout = 0, error = 0, cancelled = 0;
  for (const s of sessions.values()) {
    switch (s.status) {
      case 'pending': pending++; break;
      case 'sent': sent++; break;
      case 'running': running++; break;
      case 'ack_received': ackR++; break;
      case 'reply_received': replyR++; break;
      case 'completed': completed++; break;
      case 'timeout': timeout++; break;
      case 'error': error++; break;
      case 'cancelled': cancelled++; break;
    }
  }
  return { total: sessions.size, pending, sent, running, ack_received: ackR, reply_received: replyR, completed, timeout, error, cancelled };
}
