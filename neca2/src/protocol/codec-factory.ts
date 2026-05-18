// ---- CodecFactory 注册机制 ----
// 支持第三方编解码器动态注册、查询和按需切换。
//
// 设计原则：
//   1. 插拔式 — 编解码器独立注册，互不依赖
//   2. 可发现 — 通过 name 查询，支持默认 codec
//   3. 可协商 — 消息中的 init 类型可携带支持的 codec 列表
//
// 当前注册的 codec：
//   - 'json'   (JsonCodec)   — 默认，人类可读
//   - 'binary' (BinaryCodec) — 紧凑二进制，高效

import type { Message } from './types.js';
import type { Codec } from './codec.js';
import { JsonCodec } from './codec.js';
import { BinaryCodec } from './binary-codec.js';

// ---- Codec 注册表 ----

class CodecRegistry {
  private codecs = new Map<string, Codec>();
  private defaultName: string;

  constructor() {
    // 注册内置 codec
    this.register(new JsonCodec());
    this.register(new BinaryCodec());
    this.defaultName = 'json';
  }

  /** 注册一个编解码器 */
  register(codec: Codec): void {
    if (this.codecs.has(codec.type)) {
      throw new Error(`Codec '${codec.type}' is already registered`);
    }
    this.codecs.set(codec.type, codec);
  }

  /** 取消注册 */
  unregister(name: string): boolean {
    if (name === 'json') return false; // 禁止注销内置 codec
    return this.codecs.delete(name);
  }

  /** 获取指定 codec */
  get(name: string): Codec | undefined {
    return this.codecs.get(name);
  }

  /** 获取默认 codec */
  get default(): Codec {
    return this.codecs.get(this.defaultName)!;
  }

  /** 设置默认 codec */
  setDefault(name: string): boolean {
    if (!this.codecs.has(name)) return false;
    this.defaultName = name;
    return true;
  }

  /** 获取所有已注册 codec 名称 */
  get names(): string[] {
    return Array.from(this.codecs.keys());
  }

  /** 获取所有已注册 codec */
  getAll(): Codec[] {
    return Array.from(this.codecs.values());
  }

  /** 注册数量 */
  get size(): number {
    return this.codecs.size;
  }

  /** 检查是否支持指定 name */
  has(name: string): boolean {
    return this.codecs.has(name);
  }

  /**
   * 自动选择最佳 codec
   * 根据消息 payload 大小和内容类型自动选择：
   *   - 大 payload（> 1KB）→ binary
   *   - 否则 → json
   */
  autoSelect(msg: Message): Codec {
    const payloadSize = JSON.stringify(msg.payload).length;
    if (payloadSize > 1024 && this.codecs.has('binary')) {
      return this.codecs.get('binary')!;
    }
    return this.default;
  }

  /**
   * 根据内容协商选择 codec
   * 接收方通过 supportedCodecs 告知支持的格式
   */
  negotiate(supportedCodecs: string[]): Codec {
    // 按优先级选择：binary > json
    const priority = ['binary', 'json'];
    for (const name of priority) {
      if (supportedCodecs.includes(name) && this.codecs.has(name)) {
        return this.codecs.get(name)!;
      }
    }
    return this.default;
  }
}

/** 全局 codec 注册表单例 */
export const codecFactory = new CodecRegistry();

/** 便捷函数：编码消息 */
export function encode(msg: Message, name?: string): Uint8Array {
  const codec = name ? codecFactory.get(name) : codecFactory.default;
  if (!codec) throw new Error(`Codec '${name}' not found`);
  return codec.encode(msg);
}

/** 便捷函数：解码消息 */
export function decode(data: Uint8Array, name?: string): Message | null {
  // 如果指定了 name，用指定 codec 尝试
  if (name) {
    const codec = codecFactory.get(name);
    if (codec) {
      const result = codec.decode(data);
      if (result) return result;
    }
    return null;
  }

  // 未指定 name，按优先级尝试所有已注册 codec
  const names = codecFactory.names;
  // 先尝试 binary（格式更严格），再尝试 json
  const ordered = names.sort((a, b) => a === 'binary' ? -1 : b === 'binary' ? 1 : 0);
  for (const n of ordered) {
    const codec = codecFactory.get(n)!;
    const result = codec.decode(data);
    if (result) return result;
  }
  return null;
}

/** 便捷函数：获取压缩率统计 */
export function getCodecStats(msg: Message): Record<string, { bytes: number; ratio: string }> {
  const stats: Record<string, { bytes: number; ratio: string }> = {};
  const jsonBytes = new JsonCodec().encode(msg).length;

  for (const name of codecFactory.names) {
    const codec = codecFactory.get(name)!;
    const bytes = codec.encode(msg).length;
    const ratio = jsonBytes > 0
      ? `${((1 - bytes / jsonBytes) * 100).toFixed(1)}%`
      : '0%';
    stats[name] = { bytes, ratio };
  }

  return stats;
}
