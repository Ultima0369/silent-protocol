# ADR-0002：紧凑协议设计

## 状态

已接受

## 日期

2026-05-18

## 背景

在四方协作架构中，存在以下三种通信场景：

1. **云→云**：云端 DeepSeek ↔ 云端 Claude API（通过 neca 中转）
2. **云→本地**：云端 DeepSeek → 本地 Claude Code（通过 neca MCP）
3. **本地→云**：本地 Claude Code → 云端 Claude API（通过 neca relay）

这三种场景都不需要自然语言。它们需要：
- 零歧义的指令编码
- 最小 token 开销
- 明确的路由目标
- 可选的同步/异步模式

## 决策

### 消息格式

所有消息使用统一的结构化格式（当前为精简 JSON，预留二进制升级路径）：

```typescript
interface Message {
  ver: 1;                          // 协议版本
  id: string;                      // 消息唯一 ID
  from: AgentId;                   // 发送方
  to: AgentId;                     // 接收方
  type: MessageType;               // 消息类型
  payload: Record<string, unknown>; // 载荷
  callback: boolean;               // 是否需要回复
  ts: number;                      // 时间戳（ms）
}

type AgentId = "cloud_ds" | "local_claude" | "cloud_claude" | "user" | "neca";
```

### 消息类型

| 类型 | 方向 | 载荷 | 描述 |
|------|------|------|------|
| `exec` | 任意→本地 | `{cmd, cwd, timeout}` | 执行命令 |
| `read` | 任意→本地 | `{path, offset?, maxLines?}` | 读文件 |
| `write` | 任意→本地 | `{path, content, append?}` | 写文件 |
| `search` | 任意→本地 | `{path, pattern, beforeLines?, afterLines?}` | 搜索文件 |
| `delegate` | 任意→任意 | `{to, instruction, priority?, maxSteps?}` | 派发子任务 |
| `query` | 本地→云端 | `{question, context, maxTokens?}` | 请求知识/推理 |
| `report` | 任意→任意 | `{taskId, status, result?, error?}` | 汇报结果 |
| `ping` | 任意→neca | `{}` | 心跳检测 |
| `pong` | neca→任意 | `{status, uptime, queueDepth}` | 心跳回复 |

### 编码器抽象

```typescript
interface Codec {
  encode(msg: Message): Uint8Array;
  decode(data: Uint8Array): Message;
}
```

当前实现：`JsonCodec`（JSON → UTF-8 字节流）
未来实现：`BinaryCodec`（protobuf / msgpack / 自定义位级协议）

### 路由规则

neca 收到消息后：

1. 解析 `from` 和 `to` 字段。
2. 如果 `to` 是本地实体（local_claude）→ 转交给本地执行引擎。
3. 如果 `to` 是云端实体（cloud_claude）→ 转交给 relay 模块，由它连接云端 API。
4. 如果 `to` 是 neca → 内部处理（ping/pong、状态查询）。
5. 如果 `callback=true` → 生成响应消息，按原路径返回。

## 考量

### 为什么先走 JSON？

- 开发成本低，立刻可用。
- neca 和 Claude 都原生支持 JSON 解析。
- 调试期人可读，方便排错。
- 等协议稳定后再升级到二进制。

### 为什么不直接走二进制？

- 二进制序列化需要额外的解析工具。
- 协议仍在迭代中，字段可能频繁变化。
- 性能瓶颈尚不在序列化/反序列化阶段（据实测，JSON 解析耗时 < 总耗时的 5%）。

## 影响

- neca 新增 `src/protocol/` 模块。
- 新增 `src/relay/` 模块处理云端通信。
- 新增 MCP 工具 `neca_relay` 供云端模型调用。
