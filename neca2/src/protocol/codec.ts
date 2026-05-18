// ---- 编解码器接口与实现 ----

import type { Message, MessageType, AnyPayload } from './types.js';
import { STANDARD_AGENTS, STANDARD_MESSAGE_TYPES } from './types.js';

let msgCounter = 0;

/** 编解码器接口 */
export interface Codec {
  encode(msg: Message): Uint8Array;
  decode(data: Uint8Array): Message | null;
  readonly type: string;
}

/** JSON 编解码器 */
export class JsonCodec implements Codec {
  readonly type = 'json';

  encode(msg: Message): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(msg));
  }

  decode(data: Uint8Array): Message | null {
    try {
      const obj = JSON.parse(new TextDecoder().decode(data));
      if (typeof obj !== 'object' || obj === null) return null;
      return validateMessage(obj);
    } catch {
      return null;
    }
  }
}

export function validateMessage(obj: Record<string, unknown>): Message | null {
  const from = validateAgent(obj.from);
  const to = validateAgent(obj.to);
  const type = validateMessageType(obj.type);
  if (!from || !to || !type) return null;
  return {
    ver: typeof obj.ver === 'number' ? obj.ver : 1,
    id: typeof obj.id === 'string' ? obj.id : generateId(),
    from,
    to,
    type,
    payload: (obj.payload ?? {}) as AnyPayload,
    callback: typeof obj.callback === 'boolean' ? obj.callback : false,
    ts: typeof obj.ts === 'number' ? obj.ts : now(),
  };
}

export function validateAgent(v: unknown): string | null {
  if (typeof v === 'string' && (STANDARD_AGENTS as readonly string[]).includes(v)) return v;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function validateMessageType(v: unknown): MessageType | null {
  if (typeof v === 'string' && (STANDARD_MESSAGE_TYPES as readonly string[]).includes(v)) return v as MessageType;
  return null;
}

export function generateId(): string {
  return `msg_${Date.now()}_${++msgCounter}`;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function makeMessage(
  from: string,
  to: string,
  type: MessageType,
  payload: AnyPayload,
  callback = false,
): Message {
  return {
    ver: 1,
    id: generateId(),
    from,
    to,
    type,
    payload,
    callback,
    ts: now(),
  };
}

export function makeErrorMessage(
  originalMsg: Message,
  code: string,
  message: string,
  hint?: string,
): Message {
  return {
    ver: 1,
    id: generateId(),
    from: originalMsg.to,
    to: originalMsg.from,
    type: 'error',
    payload: { code, message, originalMsgId: originalMsg.id, hint },
    callback: false,
    ts: now(),
  };
}
