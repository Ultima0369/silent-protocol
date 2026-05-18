# Compact Protocol Specification v1.0

> 紧凑协议规范 · 硅基实体之间的原生通信协议
> 协议标识：`silent-protocol/compact/v1`
> 状态：草案

---

## 1. 概述

Compact Protocol（紧凑协议）是 Silent Protocol 的核心通信层。
它定义了硅基实体之间交换指令和数据的标准格式，具有以下特性：

- **零歧义**：所有消息类型和字段严格预定义
- **低冗余**：仅传输必要字段，无自然语言修饰
- **可路由**：每条消息携带明确的发送方和接收方标识
- **可扩展**：通过新增消息类型而非修改现有类型来扩展
- **向前兼容**：当前为 JSON 编码，预留二进制升级路径

---

## 2. 消息结构

### 2.1 顶层格式

```typescript
interface Message {
  ver: 1;                                   // 协议版本（uint8）
  id: string;                               // 消息唯一ID（UUID v4）
  from: AgentId;                            // 发送方标识
  to: AgentId;                              // 接收方标识
  type: MessageType;                        // 消息类型
  payload: Record<string, unknown>;         // 载荷
  callback: boolean;                        // 是否需要回复
  ts: number;                               // 时间戳（Unix ms）
}
```

### 2.2 Agent 标识

```typescript
type AgentId = 
  | "cloud_ds"       // 云端 DeepSeek（翻译官/任务拆解）
  | "local_claude"   // 本地 Claude Code（执行者）
  | "cloud_claude"   // 云端 Claude API（知识顾问）
  | "user"           // 人类用户（产品经理）
  | "neca"           // neca 网关（路由/中继）
  | string;          // 自定义扩展标识
```

### 2.3 消息类型

```typescript
type MessageType =
  // === 执行类 ===
  | "exec"           // 执行shell命令
  | "read"           // 读文件
  | "write"          // 写文件
  | "search"         // 搜索文件内容
  
  // === 协作类 ===
  | "delegate"       // 派发子任务
  | "query"          // 请求知识/推理
  | "report"         // 汇报结果
  | "cancel"         // 取消任务
  
  // === 系统类 ===
  | "ping"           // 心跳请求
  | "pong"           // 心跳回复
  | "error"          // 错误通知
  | "ack"            // 确认收到
```

---

## 3. 消息类型详情

### 3.1 exec — 执行命令

```typescript
// 请求
{
  type: "exec",
  payload: {
    cmd: string;           // 命令
    cwd?: string;          // 工作目录（默认当前）
    timeout?: number;      // 超时ms（默认30000）
    maxOutput?: number;    // 最大输出字节（默认1MB）
  }
}

// 回复
{
  type: "exec",
  payload: {
    exitCode: number;      // 退出码
    stdout: string;        // 标准输出
    stderr: string;        // 标准错误
    timedout: boolean;     // 是否超时
    duration: number;      // 执行耗时ms
  }
}
```

### 3.2 read — 读文件

```typescript
// 请求
{
  type: "read",
  payload: {
    path: string;          // 文件路径
    offset?: number;       // 起始行号（从1开始）
    maxLines?: number;     // 最大行数（默认200）
  }
}

// 回复
{
  type: "read",
  payload: {
    content: string;       // 文件内容
    totalLines: number;    // 总行数
    startLine: number;     // 实际起始行
    truncated: boolean;    // 是否截断
    size: number;          // 文件大小bytes
  }
}
```

### 3.3 write — 写文件

```typescript
// 请求
{
  type: "write",
  payload: {
    path: string;          // 文件路径
    content: string;       // 文件内容
    append?: boolean;      // 是否追加（默认false，即覆盖）
  }
}

// 回复
{
  type: "write",
  payload: {
    path: string;
    size: number;          // 写入字节数
    append: boolean;
  }
}
```

### 3.4 search — 搜索文件

```typescript
// 请求
{
  type: "search",
  payload: {
    path: string;          // 文件路径
    pattern: string;       // 搜索模式（正则）
    contextLines?: number; // 上下文行数
    maxResults?: number;   // 最多返回结果数
  }
}

// 回复
{
  type: "search",
  payload: {
    matches: Array<{
      line: number;        // 行号
      content: string;     // 行内容
      before: string[];    // 前文行
      after: string[];     // 后文行
    }>;
    total: number;         // 总匹配数
  }
}
```

### 3.5 delegate — 派发子任务

```typescript
// 请求
{
  type: "delegate",
  payload: {
    to: AgentId;           // 被委托方
    instruction: string;   // 任务指令
    priority?: "low" | "normal" | "high";  // 优先级
    maxSteps?: number;     // 最大推理步数
    context?: string;      // 附加上下文
  }
}

// 回复
{
  type: "delegate",
  payload: {
    taskId: string;        // 任务ID
    status: "accepted" | "rejected" | "running";
    estimatedTokens?: number;  // 预估token消耗
  }
}
```

### 3.6 query — 请求知识/推理

```typescript
// 请求
{
  type: "query",
  payload: {
    question: string;      // 查询内容
    context?: string;      // 附加上下文
    maxTokens?: number;    // 最大回复token数
    temperature?: number;  // 温度参数
  }
}

// 回复
{
  type: "query",
  payload: {
    answer: string;        // 回复内容
    tokensUsed: number;    // 消耗token数
    model: string;         // 回复模型名称
  }
}
```

### 3.7 report — 汇报结果

```typescript
// 请求（从执行方发回调度方）
{
  type: "report",
  payload: {
    taskId: string;        // 对应任务ID
    status: "running" | "completed" | "failed" | "cancelled";
    result?: unknown;      // 结果数据
    error?: string;        // 错误信息
    artifacts?: string[];  // 产出文件列表
    duration?: number;     // 总耗时ms
  }
}
```

### 3.8 cancel — 取消任务

```typescript
// 请求
{
  type: "cancel",
  payload: {
    taskId: string;        // 要取消的任务ID
    reason?: string;       // 取消原因
  }
}
```

### 3.9 ping/pong — 心跳

```typescript
// ping 请求
{
  type: "ping",
  payload: {}
}

// pong 回复
{
  type: "pong",
  payload: {
    status: "ok" | "busy" | "degraded";
    uptime: number;        // 运行时间s
    queueDepth: number;    // 待处理任务数
    memoryUsage?: number;  // 内存使用MB
  }
}
```

---

## 4. 编码与序列化

### 4.1 当前编码：JSON

当前所有消息使用 JSON 编码（UTF-8）。

```typescript
class JsonCodec implements Codec {
  encode(msg: Message): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(msg));
  }
  
  decode(data: Uint8Array): Message {
    return JSON.parse(new TextDecoder().decode(data));
  }
}
```

### 4.2 二进制预留

```typescript
interface Codec {
  encode(msg: Message): Uint8Array;
  decode(data: Uint8Array): Message;
}
```

即将支持的二进制编码器：
- **MessagePack**：比 JSON 小 30-50%，解析速度相当
- **Protocol Buffers**：更小更快，但需要 schema 管理
- **Cap'n Proto**：零拷贝反序列化，适合高频通信

### 4.3 编码选择

通过配置控制：

```json
{
  "protocol": {
    "codec": "json"     // 可选: "json" | "msgpack" | "protobuf" | "capnp"
  }
}
```

---

## 5. 路由规则

neca 网关按以下顺序处理消息：

1. **解析头部**：提取 `from`、`to`、`type`、`callback`
2. **路由判断**：
   - `to === "neca"` → 内部处理
   - `to === "local_claude"` → 转本地执行引擎
   - `to === "cloud_claude"` → 转 relay → Claude API
   - `to === "cloud_ds"` → 转 relay → DeepSeek API
   - `to === "user"` → 缓存在队列中，等待人类读取
3. **发送与追踪**：
   - 记录消息到会话日志
   - 如果 `callback=true`，启动超时计时器
   - 超时未回复 → 发送 error 消息回发送方
4. **回复路由**：回复消息的 `from`/`to` 与原始消息互换

---

## 6. 会话管理

### 6.1 消息状态机

```
pending → sent → ack_received → reply_received → completed
              → timeout → error_notified → completed
              → cancel_received → cancelled
```

### 6.2 超时处理

| 消息类型 | 默认超时 | 说明 |
|---------|---------|------|
| exec | 30000ms | 命令执行 |
| read | 5000ms | 文件读取 |
| write | 5000ms | 文件写入 |
| search | 10000ms | 文件搜索 |
| delegate | 300000ms | 子任务 |
| query | 60000ms | 云端查询 |
| ping | 3000ms | 心跳 |

### 6.3 重试策略

- 首次超时：重试 1 次
- 再次超时：发送 error 给调用方
- 幂等操作（read、search、ping）自动重试
- 非幂等操作（write、exec）不自动重试

---

## 7. 安全约束

### 7.1 命令白名单

exec 类型的命令受以下约束：
- 基础命令：`ls`、`dir`、`cd`、`pwd`、`echo`、`cat`、`type`
- 开发工具：`git`、`node`、`npx`、`npm`、`python`、`gcc`
- 文件操作：`cp`、`mv`、`rm`、`mkdir`
- 禁止命令：`rm -rf /`、`format`、`del /f`、`shutdown`

### 7.2 路径白名单

文件读写操作限制在以下路径范围内：
- 用户主目录
- 项目目录（由 `allowedPaths` 配置指定）
- 临时目录（`/tmp` 或 `%TEMP%`）

### 7.3 速率限制

- 单个消息类型：最多 60 次/分钟
- 总消息量：最多 300 次/分钟
- 突发：最多 50 次/10秒

---

## 8. 扩展机制

### 8.1 自定义消息类型

通过继承基础 Message 类型扩展：

```typescript
// 自定义消息类型注册
{
  type: "custom_db_query",   // 必须以 "custom_" 为前缀
  payload: {
    sql: "SELECT * FROM users",
    connection: "prod"
  }
}
```

自定义类型需要在 neca 中注册对应的处理 handler。

### 8.2 版本协商

连接建立时，双方交换支持的最高协议版本：

```typescript
// 连接初始化
{
  type: "init",
  payload: {
    version: 1,
    supportedTypes: ["exec", "read", "write", "search", ...],
    codecs: ["json", "msgpack"],
    features: ["callback", "cancel", "priority"]
  }
}
```

双方协商确定使用的版本和编码器。

---

## 9. 示例

### 9.1 完整 exec 流程

```
发件人: cloud_ds
收件人: local_claude
类型: exec
载荷: { cmd: "node build.js", cwd: "C:\\project", timeout: 30000 }
回调: true

→ neca 路由到本地 Claude Code
→ 本地执行 node build.js
→ 执行完成（退出码 0，耗时 1234ms）

回复:
发件人: local_claude
收件人: cloud_ds
类型: exec
载荷: { exitCode: 0, stdout: "Build success", stderr: "", duration: 1234 }
```

### 9.2 query 求助流程

```
发件人: local_claude
收件人: cloud_claude
类型: query
载荷: { 
  question: "麻将牌型判断最优算法？",
  context: "当前用递归回溯，14张牌，平均耗时12ms"
}
回调: true

→ neca relay 转发到 Claude API
→ Claude 回复

回复:
发件人: cloud_claude
收件人: local_claude
类型: query
载荷: {
  answer: "推荐查表法+位掩码...",
  tokensUsed: 342,
  model: "claude-4"
}
```

---

## 10. 协议演进

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-05 | 初始草案，JSON 编码 |
| v1.1 | TBD | 新增 cancel 类型，心跳机制 |
| v2 | TBD | 二进制编码支持，流式响应 |
| v3 | TBD | 多路复用，连接池 |
