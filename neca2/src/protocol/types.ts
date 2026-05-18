// ---- Compact Protocol v1.0 完整类型定义 ----
// 遵循 silent-protocol/spec/compact-protocol-spec.md

/** 参与方标识 */
export type AgentId =
  | 'cloud_ds'
  | 'local_claude'
  | 'cloud_claude'
  | 'user'
  | 'neca'

/** 消息类型 */
export type MessageType =
  | 'exec'
  | 'read'
  | 'write'
  | 'search'
  | 'delegate'
  | 'query'
  | 'report'
  | 'cancel'
  | 'ping'
  | 'pong'
  | 'error'
  | 'ack'
  | 'init'

/** 会话状态（含内部流转状态） */
export type SessionStatus =
  | 'pending'
  | 'sent'
  | 'running'
  | 'ack'
  | 'ack_received'
  | 'reply'
  | 'reply_received'
  | 'completed'
  | 'timeout'
  | 'error'
  | 'cancelled'

/** Exec 载荷 */
export interface ExecPayload { cmd: string; cwd?: string; timeout?: number; maxOutput?: number; exitCode?: number; stdout?: string; stderr?: string; timedout?: boolean; duration?: number; }
export interface ReadPayload { path: string; offset?: number; maxLines?: number; content?: string; totalLines?: number; startLine?: number; truncated?: boolean; size?: number; }
export interface WritePayload { path: string; content: string; append?: boolean; size?: number; }
export interface SearchPayload { path: string; pattern: string; contextLines?: number; maxResults?: number; matches?: Array<{line: number; content: string; before: string[]; after: string[]}>; total?: number; }
export interface DelegatePayload { to: string; instruction: string; priority?: 'low' | 'normal' | 'high'; maxSteps?: number; context?: string; taskId?: string; status?: string; }
export interface QueryPayload { question: string; context?: string; maxTokens?: number; temperature?: number; answer?: string; tokensUsed?: number; model?: string; }
export interface ReportPayload { taskId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; result?: unknown; error?: string; artifacts?: string[]; duration?: number; }
export interface CancelPayload { taskId: string; reason?: string; }
export interface PingPayload {}
export interface PongPayload { status: 'ok' | 'busy' | 'degraded'; uptime: number; queueDepth: number; memoryUsage?: number; }
export interface ErrorPayload { code: string; message: string; originalMsgId?: string; details?: unknown; hint?: string; }
export interface AckPayload { originalMsgId: string; status: 'accepted' | 'rejected'; reason?: string; }
export interface InitPayload { version: number; supportedTypes: string[]; codecs: string[]; features: string[]; }

/** 消息载荷联合 */
export type AnyPayload =
  | ExecPayload | ReadPayload | WritePayload | SearchPayload
  | DelegatePayload | QueryPayload | ReportPayload | CancelPayload
  | PingPayload | PongPayload | ErrorPayload | AckPayload | InitPayload

/** 标准消息结构 */
export interface Message<T extends AnyPayload = AnyPayload> {
  ver: number;
  id: string;
  from: AgentId | string;
  to: AgentId | string;
  type: MessageType;
  payload: T;
  callback?: boolean;
  priority?: 'low' | 'normal' | 'high';
  ts: number;
}

/** 会话记录（session.ts 实际使用的结构） */
export interface SessionRecord {
  id: string;
  status: SessionStatus;
  message: Message;
  response: any;
  createdAt: number;
  updatedAt: number;
  timeoutAt: number;
  retryCount: number;
  sentAt?: number;
  ackAt?: number;
  replyAt?: number;
  completedAt?: number;
}

/** 预定义 agent 标识列表 */
export const STANDARD_AGENTS = ['cloud_ds', 'local_claude', 'cloud_claude', 'user', 'neca'] as const;

/** 标准消息类型列表 */
export const STANDARD_MESSAGE_TYPES = [
  'exec', 'read', 'write', 'search',
  'delegate', 'query', 'report', 'cancel',
  'ping', 'pong', 'error', 'ack', 'init',
] as const;

/** 错误码定义 */
export const ERROR_CODES = {
  TIMEOUT: 'TIMEOUT',
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',
  CMD_NOT_ALLOWED: 'CMD_NOT_ALLOWED',
  EXEC_FAILED: 'EXEC_FAILED',
  API_AUTH_FAILED: 'API_AUTH_FAILED',
  API_RATE_LIMITED: 'API_RATE_LIMITED',
  API_SERVER_ERROR: 'API_SERVER_ERROR',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  PARSE_ERROR: 'PARSE_ERROR',
  SESSION_LOST: 'SESSION_LOST',
  TARGET_UNREACHABLE: 'TARGET_UNREACHABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/**
 * 消息校验结果
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 校验消息是否合法
 * - ver 必须存在且为数字
 * - id 不能为空
 * - from 和 to 不能为空
 * - type 必须是合法的 MessageType
 * - exec 类型必须包含 cmd
 */
export function validateMessage(msg: Partial<Message>): ValidationResult {
  if (!msg.ver || typeof msg.ver !== 'number') {
    return { valid: false, error: 'ver must be a positive number' };
  }
  if (!msg.id) {
    return { valid: false, error: 'id must not be empty' };
  }
  if (!msg.from) {
    return { valid: false, error: 'from must not be empty' };
  }
  if (!msg.to) {
    return { valid: false, error: 'to must not be empty' };
  }
  if (!msg.type) {
    return { valid: false, error: 'type must not be empty' };
  }
  if (!(STANDARD_MESSAGE_TYPES as readonly string[]).includes(msg.type)) {
    return { valid: false, error: `type must be one of: ${STANDARD_MESSAGE_TYPES.join(', ')}` };
  }
  if (!STANDARD_AGENTS.includes(msg.from as any) && !(msg.from as string).startsWith('ext_')) {
    return { valid: false, error: `from must be a standard agent or ext_ prefix` };
  }
  if (msg.type === 'exec') {
    const p = msg.payload as any;
    if (!p || !p.cmd) {
      return { valid: false, error: 'exec type requires cmd in payload' };
    }
  }
  return { valid: true };
}
