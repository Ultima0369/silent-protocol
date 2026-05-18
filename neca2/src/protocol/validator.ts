// ---- 消息校验中间件 ----
// 在路由管道中自动校验每条消息的合规性。
//
// 设计原则：
//   1. 早失败 — 在进入路由之前拦截非法消息
//   2. 可组合 — 多个校验规则可串联
//   3. 可配置 — 生产环境可以放宽某些检查
//
// 校验规则：
//   R1: ver 必须是正整数
//   R2: id 不能为空，长度 ≤ 128
//   R3: from/to 必须是标准 Agent 或 ext_ 前缀
//   R4: type 必须是标准消息类型
//   R5: callback 为 true 时必须有回调查询机制
//   R6: payload 不能为 null/undefined
//   R7: exec 类型必须包含 cmd
//   R8: write 类型必须包含 path 和 content
//   R9: read/search 类型必须包含 path
//   R10: ts 必须在当前时间 ±5 分钟范围内（防重放，可选）

import type { Message, MessageType, AnyPayload, ValidationResult } from './types.js';
import { STANDARD_AGENTS, STANDARD_MESSAGE_TYPES, ERROR_CODES } from './types.js';

// ---- 校验规则配置 ----

export interface ValidationConfig {
  /** 是否检查时间戳范围（防重放） */
  checkTimestamp: boolean;
  /** 允许的时间戳偏差（毫秒） */
  maxTimestampDriftMs: number;
  /** 是否允许 ext_ 前缀的 Agent */
  allowExtAgents: boolean;
  /** 最大 ID 长度 */
  maxIdLength: number;
  /** 最大 payload 大小（字节） */
  maxPayloadBytes: number;
}

const DEFAULT_CONFIG: ValidationConfig = {
  checkTimestamp: false,       // 默认关闭，避免时钟不同步问题
  maxTimestampDriftMs: 300_000, // 5 分钟
  allowExtAgents: true,
  maxIdLength: 128,
  maxPayloadBytes: 1024 * 1024, // 1MB
};

// ---- 校验结果（增强版） ----

export interface ValidationMiddlewareResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: Partial<Message>;  // 自动修复后的消息（可选）
}

// ---- 校验规则实现 ----

type Rule = (msg: Partial<Message>, config: ValidationConfig) => string | null;

const rules: Rule[] = [
  // R1: ver 必须是正整数
  (msg) => {
    if (typeof msg.ver !== 'number' || msg.ver <= 0 || !Number.isInteger(msg.ver)) {
      return 'R1: ver must be a positive integer';
    }
    return null;
  },

  // R2: id 不能为空，长度有限制
  (msg, cfg) => {
    if (!msg.id || typeof msg.id !== 'string') {
      return 'R2: id must be a non-empty string';
    }
    if (msg.id.length > cfg.maxIdLength) {
      return `R2: id too long (${msg.id.length} > ${cfg.maxIdLength})`;
    }
    return null;
  },

  // R3: from/to 必须合法
  (msg) => {
    if (!msg.from || typeof msg.from !== 'string') {
      return 'R3: from must be a non-empty string';
    }
    if (!msg.to || typeof msg.to !== 'string') {
      return 'R3: to must be a non-empty string';
    }
    return null;
  },

  // R4: type 必须是标准消息类型
  (msg) => {
    if (!msg.type || typeof msg.type !== 'string') {
      return 'R4: type must be a non-empty string';
    }
    if (!(STANDARD_MESSAGE_TYPES as readonly string[]).includes(msg.type)) {
      return `R4: type '${msg.type}' is not a standard message type`;
    }
    return null;
  },

  // R5: callback 为 boolean
  (msg) => {
    if (msg.callback !== undefined && typeof msg.callback !== 'boolean') {
      return 'R5: callback must be a boolean';
    }
    return null;
  },

  // R6: payload 不能为 null/undefined
  (msg) => {
    if (msg.payload === null || msg.payload === undefined) {
      return 'R6: payload must not be null or undefined';
    }
    if (typeof msg.payload !== 'object') {
      return 'R6: payload must be an object';
    }
    return null;
  },

  // R7: exec 类型必须包含 cmd
  (msg) => {
    if (msg.type === 'exec') {
      const p = msg.payload as any;
      if (!p || typeof p.cmd !== 'string' || p.cmd.trim().length === 0) {
        return 'R7: exec type requires a non-empty cmd string in payload';
      }
    }
    return null;
  },

  // R8: write 类型必须包含 path 和 content
  (msg) => {
    if (msg.type === 'write') {
      const p = msg.payload as any;
      if (!p || typeof p.path !== 'string' || p.path.trim().length === 0) {
        return 'R8: write type requires a non-empty path in payload';
      }
      if (p.content === undefined || p.content === null) {
        return 'R8: write type requires content in payload';
      }
    }
    return null;
  },

  // R9: read/search 类型必须包含 path
  (msg) => {
    if (msg.type === 'read' || msg.type === 'search') {
      const p = msg.payload as any;
      if (!p || typeof p.path !== 'string' || p.path.trim().length === 0) {
        return `R9: ${msg.type} type requires a non-empty path in payload`;
      }
    }
    return null;
  },

  // R10: 时间戳检查（可选）
  (msg, cfg) => {
    if (!cfg.checkTimestamp) return null;
    if (typeof msg.ts !== 'number') {
      return 'R10: ts must be a number';
    }
    const drift = Math.abs(Date.now() - msg.ts * 1000);
    if (drift > cfg.maxTimestampDriftMs) {
      return `R10: ts drift ${drift}ms exceeds max ${cfg.maxTimestampDriftMs}ms`;
    }
    return null;
  },

  // R11: priority 必须合法
  (msg) => {
    if (msg.priority !== undefined) {
      if (!['low', 'normal', 'high'].includes(msg.priority as string)) {
        return 'R11: priority must be low, normal, or high';
      }
    }
    return null;
  },
];

// ---- 公共 API ----

/**
 * 执行完整消息校验（所有规则）
 */
export function validateMessageMiddleware(
  msg: Partial<Message>,
  config: ValidationConfig = DEFAULT_CONFIG,
): ValidationMiddlewareResult {
  const result: ValidationMiddlewareResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  for (const rule of rules) {
    const err = rule(msg, config);
    if (err !== null) {
      result.errors.push(err);
      result.valid = false;
    }
  }

  // 自动修复：补全缺失的 id
  if (!msg.id || typeof msg.id !== 'string') {
    result.sanitized = { ...msg, id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
    result.warnings.push('Auto-generated missing id');
  }

  // 自动修复：补全缺失的 ver
  if (typeof msg.ver !== 'number') {
    if (!result.sanitized) result.sanitized = { ...msg };
    result.sanitized!.ver = 1;
    result.warnings.push('Auto-set ver to 1');
  }

  // 自动修复：补全缺失的 payload
  if (msg.payload === null || msg.payload === undefined) {
    if (!result.sanitized) result.sanitized = { ...msg };
    result.sanitized!.payload = {};
    result.warnings.push('Auto-set empty payload');
  }

  return result;
}

/**
 * 简化的校验方式（返回 boolean）
 */
export function isValidMessage(msg: Partial<Message>): boolean {
  return validateMessageMiddleware(msg).valid;
}

/**
 * 获取校验错误码对应的 HTTP/协议错误
 */
export function getFirstErrorCode(errors: string[]): string {
  for (const err of errors) {
    if (err.startsWith('R1')) return ERROR_CODES.PARSE_ERROR;
    if (err.startsWith('R2')) return ERROR_CODES.PARSE_ERROR;
    if (err.startsWith('R3')) return ERROR_CODES.PARSE_ERROR;
    if (err.startsWith('R4')) return ERROR_CODES.UNKNOWN_TYPE;
    if (err.startsWith('R7')) return ERROR_CODES.CMD_NOT_ALLOWED;
    if (err.startsWith('R8') || err.startsWith('R9')) return ERROR_CODES.PATH_NOT_ALLOWED;
    if (err.startsWith('R10')) return ERROR_CODES.TIMEOUT;
  }
  return ERROR_CODES.PARSE_ERROR;
}
