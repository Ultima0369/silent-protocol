# Hello World — Silent Protocol 端到端示例

> 从 Chatbox 发一句话 → 紧凑协议编码 → 路由到本地执行 → 结果返回

## 场景

作为 `cloud_ds`（云端 DeepSeek），发送一条 exec 消息到 `local_claude`，
让它在本地执行 `echo "Hello Silent Protocol!"`，然后取回结果。

## 流程图

```
Chatbox (你)
   │  输入: "执行 echo hello"
   ▼
cloud_ds (DeepSeek) ←── 本文件运行的地方
   │  构建紧凑协议消息
   │  { ver:1, from:'cloud_ds', to:'local_claude',
   │    type:'exec', payload:{ cmd:'echo ...' } }
   ▼
neca2 MCP Server
   │  1. 校验中间件 (validateMessageMiddleware)
   │  2. 速率限制检查 (RateLimiter)
   │  3. 调度器选择 (SchedulerManager)
   │  4. 路由到 local_claude (routeToLocalClaude)
   │  5. spawnExec 执行命令
   ▼
本地 Shell
   │  执行: echo "Hello Silent Protocol!"
   ▼
结果返回
   stdout → 包装为 exec 响应消息 → 返回给 cloud_ds
```

## 前提

- neca2 已安装并运行（`npm start`）
- 或通过 Chatbox MCP 连接（见 `docs/hybrid-deployment.md`）

## 运行方法

### 方式 1：通过 CLI

```bash
# 使用 neca2 CLI 发送 exec 消息
npx tsx src/cli.ts send local_claude exec '{"cmd":"echo \"Hello Silent Protocol!\""}' --callback
```

预期输出：
```
✓ Message constructed
  ID:      msg_...
  From:    cli
  To:      local_claude
  Type:    exec
  Codec:   json (203 bytes)
  ...
✓ Round-trip verified
```

### 方式 2：通过 Node.js

```bash
npx tsx examples/hello-world/send-hello.ts
```

### 方式 3：通过 Chatbox

在 Chatbox 的 neca2 对话中输入：
```
请执行 echo "Hello Silent Protocol!"
```

neca2 的 `neca2_exec` 工具会自动处理。

## 代码说明

```typescript
// 1. 构建消息
const msg = makeMessage('cloud_ds', 'local_claude', 'exec', {
  cmd: 'echo "Hello Silent Protocol!"',
  cwd: '.',
  timeout: 5000,
}, true);

// 2. 校验
const validation = validateMessage(msg);

// 3. 编码（JSON 或 Binary）
const codec = new JsonCodec();
const encoded = codec.encode(msg);

// 4. 解码验证
const decoded = codec.decode(encoded);

// 5. 路由执行
const session = await routeMessage(msg);

// 6. 取结果
console.log(session.response?.payload?.stdout);
// 输出: Hello Silent Protocol!
```

## 协议字节对比

| 格式 | 大小 | 节省 |
|------|------|------|
| 自然语言指令 | ~200 chars / ~50 tokens | - |
| JSON 紧凑协议 | 203 bytes / ~51 tokens | ~持平 |
| 二进制紧凑协议 | 109 bytes / ~27 tokens | **节省 46%** |

## 下一步

尝试修改 payload 中的 cmd，执行更复杂的命令：

```bash
npx tsx src/cli.ts send local_claude exec \
  '{"cmd":"node -e \"console.log(process.version)\""}' \
  --callback
```
