// ---- Agent 认证与签名 ----
// 为每个 Agent 分配预共享密钥，消息头带 HMAC 签名
// 防止消息伪造和重放
//
// 设计原则：
//   1. 轻量 — 不引入外部依赖，只用 Node crypto
//   2. 渐进 — 默认关闭，开启后不影响现有测试
//   3. 自省 — 能报告认证状态，方便调试

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Message, AgentId } from '../protocol/types.js';

// ============================================================
// 密钥管理
// ============================================================

const KEY_DIR = path.join(os.homedir(), '.neca2', 'keys');
const KEY_FILE = path.join(KEY_DIR, 'agent-keys.json');

export interface AgentKeys {
  [agentId: string]: string; // agentId → base64 密钥
}

let agentKeys: AgentKeys = {};
let initialized = false;

/**
 * 初始化密钥存储
 */
export function initKeys(keys?: AgentKeys): void {
  if (keys) {
    agentKeys = { ...keys };
    initialized = true;
    return;
  }

  // 从文件加载
  ensureKeyDir();
  if (fs.existsSync(KEY_FILE)) {
    try {
      agentKeys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf-8'));
    } catch {
      agentKeys = {};
    }
  }

  // 如果没有任何密钥，生成默认密钥
  if (Object.keys(agentKeys).length === 0) {
    generateDefaultKeys();
    saveKeys();
  }

  initialized = true;
}

function ensureKeyDir(): void {
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
  }
}

function saveKeys(): void {
  ensureKeyDir();
  fs.writeFileSync(KEY_FILE, JSON.stringify(agentKeys, null, 2), 'utf-8');
}

/**
 * 生成默认密钥（为所有标准 Agent 生成）
 */
export function generateDefaultKeys(): void {
  const STANDARD_AGENTS = ['cloud_ds', 'local_claude', 'cloud_claude', 'user', 'neca'];
  for (const agent of STANDARD_AGENTS) {
    if (!agentKeys[agent]) {
      agentKeys[agent] = crypto.randomBytes(32).toString('base64');
    }
  }
  saveKeys();
}

/**
 * 为指定 Agent 生成/更新密钥
 */
export function rotateKey(agentId: string): string {
  const key = crypto.randomBytes(32).toString('base64');
  agentKeys[agentId] = key;
  saveKeys();
  return key;
}

/**
 * 获取 Agent 的密钥
 */
export function getKey(agentId: string): string | null {
  return agentKeys[agentId] || null;
}

/**
 * 获取当前密钥库摘要（用于诊断，不暴露密钥本身）
 */
export function getKeySummary(): { agents: string[]; keyFile: string } {
  return {
    agents: Object.keys(agentKeys),
    keyFile: KEY_FILE,
  };
}

// ============================================================
// 签名与验证
// ============================================================

/**
 * 为消息生成签名
 * 签名覆盖：ver + id + from + to + type + ts → 防止重放
 */
export function signMessage(msg: Message): string {
  const key = agentKeys[msg.from as string];
  if (!key) {
    throw new Error(`No key found for agent: ${msg.from}`);
  }

  const hmac = crypto.createHmac('sha256', Buffer.from(key, 'base64'));
  hmac.update(`${msg.ver}:${msg.id}:${msg.from}:${msg.to}:${msg.type}:${msg.ts}`);
  return hmac.digest('base64');
}

/**
 * 验证消息签名
 */
export function verifyMessageSignature(
  msg: Message,
  signature: string,
  agentId?: string
): { valid: boolean; error?: string } {
  const targetAgent = agentId || msg.from;
  const key = agentKeys[targetAgent];
  if (!key) {
    return { valid: false, error: `No key for agent: ${targetAgent}` };
  }

  const hmac = crypto.createHmac('sha256', Buffer.from(key, 'base64'));
  hmac.update(`${msg.ver}:${msg.id}:${msg.from}:${msg.to}:${msg.type}:${msg.ts}`);
  const expected = hmac.digest('base64');

  if (signature !== expected) {
    return { valid: false, error: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * 验证消息的时间戳是否在允许范围内（防重放）
 */
export function verifyTimestamp(msg: Message, maxDriftMs: number = 300_000): { valid: boolean; error?: string } {
  const now = Date.now();
  const msgTime = msg.ts * 1000;
  const drift = Math.abs(now - msgTime);
  if (drift > maxDriftMs) {
    return { valid: false, error: `Timestamp drift ${drift}ms > ${maxDriftMs}ms` };
  }
  return { valid: true };
}

// ============================================================
// 认证中间件
// ============================================================

export interface AuthResult {
  authenticated: boolean;
  error?: string;
  verifiedAgent?: string;
}

/**
 * 认证一条消息（签名验证 + 时间戳检查）
 */
export function authenticateMessage(
  msg: Message,
  options: {
    requireAuth?: boolean;
    maxTimestampDrift?: number;
    expectedFrom?: string;
  } = {}
): AuthResult {
  const { requireAuth = false, maxTimestampDrift = 300_000, expectedFrom } = options;

  // 如果不要求认证，直接通过
  if (!requireAuth) {
    return { authenticated: true, verifiedAgent: msg.from };
  }

  // 检查 timestamp
  const tsCheck = verifyTimestamp(msg, maxTimestampDrift);
  if (!tsCheck.valid) {
    return { authenticated: false, error: tsCheck.error };
  }

  // 检查 expectedFrom
  if (expectedFrom && msg.from !== expectedFrom) {
    return { authenticated: false, error: `Expected from ${expectedFrom}, got ${msg.from}` };
  }

  // 如果消息带 auth 头
  const payload = msg.payload as any;
  if (payload?.auth?.signature) {
    const sigCheck = verifyMessageSignature(msg, payload.auth.signature, expectedFrom || msg.from);
    if (!sigCheck.valid) {
      return { authenticated: false, error: sigCheck.error };
    }
    return { authenticated: true, verifiedAgent: msg.from };
  }

  // 如果要求认证但没签名
  if (requireAuth) {
    return { authenticated: false, error: 'Message requires authentication (auth.signature missing)' };
  }

  return { authenticated: true, verifiedAgent: msg.from };
}

/**
 * 生成带签名的消息（便捷函数）
 */
export function makeSignedMessage(
  msg: Message,
  options?: { includeKeyHint?: boolean }
): Message {
  const signature = signMessage(msg);
  const authPayload = { signature } as any;

  if (options?.includeKeyHint) {
    authPayload.keyHint = Object.keys(agentKeys).indexOf(msg.from as string);
  }

  return {
    ...msg,
    payload: {
      ...(msg.payload as any),
      auth: authPayload,
    },
  };
}
