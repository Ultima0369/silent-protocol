/**
 * e2e-demo: 紧凑协议消息发送示例
 * 
 * 演示如何构造并编码一条 silent-protocol 紧凑协议消息，
 * 展示从 cloud_ds 到 local_claude 的通信链路。
 * 
 * 运行: npx ts-node examples/e2e-demo/send-msg.ts
 */

import { JsonCodec } from '../../src/protocol/codec';
import type { Message } from '../../src/protocol/types';

// 实例化 JSON 编解码器
const codec = new JsonCodec();

// 构造一条典型的任务分派消息：云端 DeepSeek 派活给本地 Claude
const message: Message = {
  ver: 1,
  id: `msg_${Date.now()}`,
  from: 'cloud_ds',
  to: 'local_claude',
  type: 'exec',
  payload: {
    cmd: "echo 'Hello from DeepSeek! The triangle is spinning.'",
    cwd: '.',
    timeout: 30000,
  },
  callback: true,
  ts: Date.now(),
};

// 编码为传输格式
const encoded = codec.encode(message);
console.log('=== 原始消息对象 ===');
console.log(JSON.stringify(message, null, 2));

console.log('\n=== 编码后字节数 ===');
console.log(`${encoded.byteLength} bytes`);

console.log('\n=== 编码后 UTF-8 文本 ===');
console.log(new TextDecoder().decode(encoded));

// 解码回消息对象（模拟接收方行为）
const decoded = codec.decode(encoded);
console.log('\n=== 解码验证 ===');
console.log(`  ID:     ${decoded.id}`);
console.log(`  From:   ${decoded.from}`);
console.log(`  To:     ${decoded.to}`);
console.log(`  Type:   ${decoded.type}`);
console.log(`  Cmd:    ${decoded.payload.cmd}`);
console.log(`  往返一致: ${JSON.stringify(message) === JSON.stringify(decoded) ? '✅ 通过' : '❌ 失败'}`);
