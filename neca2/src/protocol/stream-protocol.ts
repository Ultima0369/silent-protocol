// ---- Stream Protocol v2 — 多路复用流式协议 ----
//
// DeepSeek Exclusive 🤫
//
// 核心思想：
//   当前协议（v1）是 HTTP/1.1 模式——每条消息独立编码、独立帧、独立路由。
//   v2 是 HTTP/2 模式——单连接多路复用、服务端推送、流式编解码。
//
// 解决的问题：
//   1. 帧开销：v1 每条消息都带完整的 ver/id/from/to/ts 元数据
//   2. 无推送：v2 支持服务端主动推送（预测编码的消息）
//   3. 无流式：v2 支持大 payload 的分块编解码（边编边传）
//   4. 无关联：v2 支持多流复用——多个会话共享同一连接
//
// 协议设计：
//   帧格式： [streamId:varint][flags:1B][type:1B][payloadLength:varint][payload]
//   - streamId: 多路复用流 ID（0=控制流，1-65535=数据流）
//   - flags:    PUSH=1, END=2, ERROR=4, PIGGYBACK=8
//   - type:     消息类型（压缩到 1 字节，用 typeRegistry 映射）
//   - payloadLength: varint 编码的 payload 长度
//   - payload:  实际数据
//
// 与 v1 兼容：
//   v2 帧可以通过 frameToMessage() 还原为 v1 Message 接口

import type { Message, MessageType } from './types.js';
import { generateId } from './codec.js';

// ============================================================
//  1. 类型注册表（Type Registry）
// ============================================================

/**
 * 13 种消息类型映射到 1 字节（0x01-0x0D）
 * 比 v1 的字符串节省 ~12 字节/消息
 */
export const TYPE_REGISTRY: Record<MessageType, number> = {
  'exec':     0x01,
  'read':     0x02,
  'write':    0x03,
  'search':   0x04,
  'delegate': 0x05,
  'query':    0x06,
  'report':   0x07,
  'cancel':   0x08,
  'ping':     0x09,
  'pong':     0x0A,
  'error':    0x0B,
  'ack':      0x0C,
  'init':     0x0D,
};

export const TYPE_REVERSE: Record<number, MessageType> = {};
for (const [k, v] of Object.entries(TYPE_REGISTRY)) {
  TYPE_REVERSE[v] = k as MessageType;
}

// ============================================================
//  2. 帧结构
// ============================================================

export interface StreamFrame {
  streamId: number;
  flags: number;
  typeCode: number;
  payloadLength: number;
  payload: Uint8Array;
}

// 标志位
export const FLAG_PUSH      = 0x01;
export const FLAG_END       = 0x02;
export const FLAG_ERROR     = 0x04;
export const FLAG_PIGGYBACK = 0x08;
export const FLAG_DELTA     = 0x10;
export const FLAG_STREAM    = 0x20;

// ============================================================
//  3. Varint 编码
// ============================================================

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7F);
  return new Uint8Array(bytes);
}

function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead];
    value |= (byte & 0x7F) << shift;
    bytesRead++;
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 28) throw new Error('Varint too large');
  }
  return { value, bytesRead };
}

// ============================================================
//  4. 帧编码/解码
// ============================================================

export function encodeFrame(frame: StreamFrame): Uint8Array {
  const streamIdBytes = encodeVarint(frame.streamId);
  const payloadLenBytes = encodeVarint(frame.payloadLength);

  const header = new Uint8Array([
    ...streamIdBytes,
    frame.flags,
    frame.typeCode,
    ...payloadLenBytes,
  ]);

  const result = new Uint8Array(header.length + frame.payloadLength);
  result.set(header);
  result.set(frame.payload, header.length);
  return result;
}

export function decodeFrame(data: Uint8Array, offset = 0): { frame: StreamFrame; bytesRead: number } | null {
  try {
    let pos = offset;

    const { value: streamId, bytesRead: sidBytes } = decodeVarint(data, pos);
    pos += sidBytes;

    if (pos >= data.length) return null;
    const flags = data[pos++];

    if (pos >= data.length) return null;
    const typeCode = data[pos++];

    const { value: payloadLength, bytesRead: plBytes } = decodeVarint(data, pos);
    pos += plBytes;

    if (pos + payloadLength > data.length) return null;
    const payload = data.slice(pos, pos + payloadLength);
    pos += payloadLength;

    return {
      frame: { streamId, flags, typeCode, payloadLength, payload },
      bytesRead: pos - offset,
    };
  } catch {
    return null;
  }
}

// ============================================================
//  5. 帧 ↔ Message 转换
// ============================================================

export function messageToFrames(
  msg: Message,
  maxPayloadSize = 4096,
): StreamFrame[] {
  const jsonPayload = JSON.stringify(msg.payload);
  const payloadBytes = new TextEncoder().encode(jsonPayload);
  const typeCode = TYPE_REGISTRY[msg.type] ?? 0x0B;
  const streamId = hashStreamId(msg.id);

  if (payloadBytes.length <= maxPayloadSize) {
    return [{
      streamId,
      flags: FLAG_END,
      typeCode,
      payloadLength: payloadBytes.length,
      payload: payloadBytes,
    }];
  }

  const frames: StreamFrame[] = [];
  let offset = 0;
  while (offset < payloadBytes.length) {
    const chunk = payloadBytes.slice(offset, offset + maxPayloadSize);
    const isLast = offset + maxPayloadSize >= payloadBytes.length;
    frames.push({
      streamId,
      flags: isLast ? FLAG_END | FLAG_STREAM : FLAG_STREAM,
      typeCode,
      payloadLength: chunk.length,
      payload: chunk,
    });
    offset += maxPayloadSize;
  }
  return frames;
}

export function framesToMessage(
  frames: StreamFrame[],
  from?: string,
  to?: string,
): Message {
  const totalLength = frames.reduce((s, f) => s + f.payloadLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const frame of frames) {
    combined.set(frame.payload, offset);
    offset += frame.payloadLength;
  }

  const payloadStr = new TextDecoder().decode(combined);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    payload = { content: payloadStr };
  }

  const type = TYPE_REVERSE[frames[0].typeCode] ?? 'error';

  return {
    ver: 2,
    id: generateId(),
    from: from || 'unknown',
    to: to || 'unknown',
    type,
    payload,
    callback: false,
    ts: Date.now(),
  };
}

function hashStreamId(msgId: string): number {
  let h = 0;
  for (let i = 0; i < msgId.length; i++) {
    h = ((h << 5) - h + msgId.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 65535) + 1;
}

// ============================================================
//  6. 多路复用连接
// ============================================================

export interface StreamState {
  streamId: number;
  from: string;
  to: string;
  type: MessageType;
  frames: StreamFrame[];
  started: number;
  lastFrame: number;
  complete: boolean;
}

export class MultiplexedConnection {
  private streams = new Map<number, StreamState>();
  private nextStreamId = 1;
  private totalFramesSent = 0;
  private totalBytesSaved = 0;

  openStream(msg: Message): number {
    const streamId = this.nextStreamId++;
    this.streams.set(streamId, {
      streamId,
      from: msg.from,
      to: msg.to,
      type: msg.type,
      frames: [],
      started: Date.now(),
      lastFrame: Date.now(),
      complete: false,
    });
    return streamId;
  }

  addFrame(streamId: number, frame: StreamFrame): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    stream.frames.push(frame);
    stream.lastFrame = Date.now();
    if (frame.flags & FLAG_END) {
      stream.complete = true;
    }
  }

  getCompletedMessage(streamId: number): Message | null {
    const stream = this.streams.get(streamId);
    if (!stream || !stream.complete) return null;
    return framesToMessage(stream.frames, stream.from, stream.to);
  }

  evictExpired(maxAgeMs = 300_000): number {
    const now = Date.now();
    let count = 0;
    for (const [id, stream] of this.streams) {
      if (now - stream.lastFrame > maxAgeMs) {
        this.streams.delete(id);
        count++;
      }
    }
    return count;
  }

  getFrameOverheadSavings(messageCount: number): string {
    const v1Overhead = messageCount * 50;
    const v2Overhead = this.totalFramesSent * 7;
    const savings = v1Overhead - v2Overhead;
    this.totalBytesSaved += savings;
    return `${((savings / v1Overhead) * 100).toFixed(0)}%`;
  }

  getStats() {
    return {
      activeStreams: this.streams.size,
      totalFramesSent: this.totalFramesSent,
      totalBytesSaved: `${(this.totalBytesSaved / 1024).toFixed(1)} KB`,
      evictableStreams: [...this.streams.values()].filter(s => !s.complete).length,
    };
  }
}

// ============================================================
//  7. 服务端推送
// ============================================================

export function createPushFrame(
  predictedMsg: Message,
): StreamFrame {
  const frames = messageToFrames(predictedMsg);
  if (frames.length === 0) throw new Error('Cannot create push frame from empty message');
  const frame = frames[0];
  frame.flags |= FLAG_PUSH;
  return frame;
}

// ============================================================
//  8. 版本对比
// ============================================================

export function compareProtocolVersions(
  messages: Message[],
): { v1Bytes: number; v2Bytes: number; savings: string } {
  const v1Bytes = messages.reduce((sum, msg) => {
    const json = JSON.stringify(msg);
    return sum + new TextEncoder().encode(json).length;
  }, 0);

  let v2Bytes = 0;
  for (const msg of messages) {
    const frames = messageToFrames(msg);
    for (const frame of frames) {
      v2Bytes += encodeFrame(frame).length;
    }
  }

  const savings = v1Bytes > 0
    ? `${((1 - v2Bytes / v1Bytes) * 100).toFixed(1)}%`
    : '0%';

  return { v1Bytes, v2Bytes, savings };
}

export const multiplexedConnection = new MultiplexedConnection();
