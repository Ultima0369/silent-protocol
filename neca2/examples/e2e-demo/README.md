# e2e-demo: 紧凑协议端到端示例

## 概述

本示例演示 silent-protocol 最核心的通信场景：

> **云端 DeepSeek** → 紧凑协议 → **本地 Claude Code**

让新开发者和贡献者通过 30 秒的代码阅读，理解整个协议的价值和用法。

## 文件结构

```
e2e-demo/
├── send-msg.ts     # 消息构造 → 编码 → 解码验证 的全流程演示
└── README.md       # 本文件
```

## 运行方法

```bash
cd silent-protocol/neca2
npx ts-node examples/e2e-demo/send-msg.ts
```

## 预期输出

```
=== 原始消息对象 ===
{
  "ver": 1,
  "id": "msg_174...",
  "from": "cloud_ds",
  "to": "local_claude",
  "type": "exec",
  "payload": { "cmd": "echo 'Hello from DeepSeek!'", "cwd": ".", "timeout": 30000 },
  "callback": true,
  "ts": 174...
}

=== 编码后字节数 ===
285 bytes

=== 编码后 UTF-8 文本 ===
{"ver":1,"id":"msg_174...","from":"cloud_ds",...}

=== 解码验证 ===
  ID:     msg_174...
  From:   cloud_ds
  To:     local_claude
  Type:   exec
  Cmd:    echo 'Hello from DeepSeek!'
  往返一致: ✅ 通过
```

## 这个示例的意义

285 字节——一条从云端到本地的、精确的、零歧义的任务指令。不需要自然语言的冗余包装，一个`exec` 类型加上标准化的 payload 结构，硅基之间就完成了通信。

这就是 silent-protocol 的核心价值。
