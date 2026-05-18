# 深度分析：Silent Protocol 实现中的十个硬问题

> 撰写：DeepSeek（cloud_ds）
> 时间：2026-05-18
> 背景：VISION.md 描绘了终极远景，但远景与现状之间存在十个尚未触碰的硬问题。
> 本文不写鸡汤，只写问题、约束、以及可行的工程路径。

---

## 问题零：现状概览

### neca2（右手）已有能力

| 模块 | 能力 | 状态 |
|------|------|------|
| `types.ts` | 13 种消息类型、5 个标准 Agent ID、错误码、校验函数 | ✅ 完整 |
| `codec.ts` | JSON 编解码、`makeMessage`、`makeErrorMessage`、ID 生成 | ✅ 完整 |
| `session.ts` | 会话创建/更新/过期/删除、磁盘持久化（log + checkpoint）、崩溃恢复 | ✅ 完整 |
| `router.ts` | 路由到 neca / cloud_claude / cloud_ds / local_claude / user | ✅ 有骨架 |
| `http-relay.ts` | Claude API + DeepSeek API 双模型中继 | ✅ 完整 |
| `tools.ts` | 9 个 MCP 工具：send/poll/pending/sessions/delete/status/health/info/exec | ✅ 完整 |
| `index.ts` | stdio MCP Server、优雅关闭、PID 文件 | ✅ 完整 |
| 测试 | 22 个测试全部通过 | ✅ 完整 |

### 现状与终极远景的差距

```
当前：  Chatbox → MCP → neca2 → router → exec/relay
                                        ↓
                                  内存队列（无消费端）

远景：  Chatbox ←→ 云端DS ←→ [紧凑协议 HTTP] ←→ neca2 ←→ local Claude Code
                    ↑                              ↓
               Claude API ←←←←←←←←←←←←←←←←←← 中继
```

差距的核心在于：
1. **neca2 没有入站 HTTP** — 云端 DS 只能通过 MCP 工具调用 neca2，不能通过紧凑协议直连
2. **local_claude 没有消费端** — `routeToLocalClaude` 把消息丢进内存队列，但没有实体来拉取
3. **没有身份层** — 任何人都能冒充 `cloud_ds` 发 exec 指令
4. **没有上下文管理** — delegate 消息携带的 context 没有传递机制

以下逐一分析每个硬问题。

---

## 问题一：云端 DS 如何通过紧凑协议与 neca2 通信？

### 困境

云端 DeepSeek（我）运行在远端的 API 服务器上。要与 neca2 通信，当前唯一的路径是：

```
我 → [自然语言推理] → MCP 工具调用 → neca2
```

但 MCP 走的是 stdio，Chatbox 作为 MCP host 将我的函数调用请求转发到 neca2 的 stdin/stdout。这不是"紧凑协议"，它仍然是 MCP 封装的。

**要想真正走紧凑协议，neca2 需要一个能被云端 DS 直连的入站信道。** 云端 DS 不能直接访问用户的 localhost，所以这个信道不能是 TCP 直连。

### 解决方案路径

#### 路径 A：neca2 暴露 HTTP 服务器（局域网可访问）

```
我 → HTTP POST → http://localhost:3101/api/v1/message → neca2
```

- 优点：实现简单，neca2 已经有 hono 依赖（在 node_modules 里）
- 问题：云端 DS 在远端，无法访问用户机器的 localhost
- 变通：如果用户和云端 DS 在同一局域网（如 Tailscale/ZeroTier），则可通

#### 路径 B：neca2 通过 Chatbox MCP 的工具返回值反向通信

```
我 → MCP neca2_send → neca2 处理 → 返回结果 → 我收到
```

- 当前已经在用，但问题是：
  - 云端 DS 只能**主动发送**并等待返回，不能**被动接收**（neca2 不能主动推送消息给云端 DS）
  - 需要云端 DS 轮询 `neca2_pending` 来获取 pending 消息

#### 路径 C：WebSocket 隧道（推荐）

```
我 ←── WebSocket ──→ neca2 relay server (公共中继)
    ↑                       ↑
  云端 DS               neca2 客户端
```

- 双方都连接到同一个公共中继服务器
- 通过消息路由实现互发
- 优点：双方都不需要公网 IP，NAT 穿透由 relay 解决
- 缺点：需要额外的中继服务器

#### 结论

**第一阶段采用路径 B（MCP 轮询）+ HTTP（局域网）。** 当云端 DS 和 neca2 在同一局域网时用 HTTP 直连，否则走 MCP 轮询。第二阶段再引入 WebSocket 中继。

---

## 问题二：本地 Claude Code 如何接收并消费消息？

### 困境

当前 `routeToLocalClaude` 的实现：

```typescript
async function routeToLocalClaude(session: SessionRecord): Promise<SessionRecord> {
  // 如果是 exec 类型，直接执行
  if (msg.type === 'exec') {
    const output = execSync(pld.cmd || '', { ... });
    // 返回结果
  }
  // 否则丢进队列
  const deliveries = pendingDeliveries.get('local_claude') || [];
  deliveries.push(msg);
}
```

问题是：
1. execSync 是**阻塞的**，长任务（如编译）会挂住 neca2 的整个事件循环
2. 非 exec 类型的消息只是入队，没有实体消费
3. 没有机制把任务**派给真正的 Claude Code 子进程**

### 解决方案

neca2 应该像 neca 的 `neca_do` 一样，能 spawn Claude Code 子进程来处理任务：

```
neca2 收到 delegate 消息
  → spawn('claude', ['--mcp', '...']) 或者用 stdin 传参
  → Claude Code 子进程处理
  → 结果通过 stdout 返回
  → neca2 捕获并封装为 reply
  → 更新 session 状态
```

关键设计：
- 每个 delegate 任务 spawn 一个独立的子进程（如同 neca 的 `NECA_MAX_CLAUDE_INSTANCES=4`）
- 子进程的 stdin 接收任务的紧凑协议消息（JSON 行）
- 子进程的 stdout 输出结果（JSON 行）
- stderr 输出日志（不干扰协议通信）
- 超时控制、资源限制、并发管理

这个能力需要扩展到 `router.ts` 的 `routeToLocalClaude` 中。

---

## 问题三：身份与认证——谁在发消息？

### 困境

当前任何消息的 `from` 和 `to` 都是普通的字符串：

```typescript
export type AgentId = 'cloud_ds' | 'local_claude' | 'cloud_claude' | 'user' | 'neca';
```

没有任何签名、密钥或验证机制。任何人只要能把消息喂进 neca2，就可以：

1. 冒充 `cloud_ds` 发送 `exec` 指令到 `local_claude`
2. 冒充 `local_claude` 发送假报告到 `cloud_ds`
3. 伪造 `cloud_claude` 的回答

**这在涉及本地命令执行的协议中是不可接受的。**

### 解决方案

分层信任模型，不追求密码学完美，但提供实用安全：

#### 第一层：来源标记（立即实现）

每条消息在路由时，neca2 自动标记收到来源：

```typescript
interface InboundMetadata {
  source: 'mcp' | 'http' | 'relay';  // 消息从哪里来
  authenticatedAgent?: AgentId;       // 若已认证，标记身份
  receivedAt: number;
}
```

路由层可以根据来源做策略控制：
- 来自 MCP 的消息：信任（因为 MCP host 在本地，Chatbox 可信）
- 来自 HTTP 的消息：需要 API key 验证
- 来自 relay 的消息：需要 token 验证

#### 第二层：API Key 验证（紧接实现）

HTTP 入站信道需要鉴权：

```
POST /api/v1/message
Authorization: Bearer <neca2_api_key>
```

Key 在 `.env` 中配置，与 neca2 共存在本地。

#### 第三层：消息签名（远期）

每个 Agent 持有密钥对，消息用私钥签名，接收方用公钥验证。这是 TCP/IP 级别的身份设计，但工程成本较高，留到协议成熟后再做。

---

## 问题四：上下文窗口管理——任务跨实体时上下文怎么传？

### 困境

假设用户说：

> "帮我把麻将项目的牌型判断优化一下，目前太慢。"

我（云端 DS）理解后，拆成任务派给 local Claude Code：

1. `delegate` 消息包含 `instruction` + `context`
2. context 里包含了：项目路径、问题描述、相关的源代码片段

但 local Claude Code 的上下文窗口是有限的。如果我塞太多 context，它会溢出。如果塞太少，它不知道前因后果。

**而且，local Claude Code 还可能回 cloud Claude API 求助，又会消耗上下文窗口。**

### 解决方案

**上下文蒸馏策略**——不是把原始对话历史全部传过去，而是只传"任务所需的精确知识"：

```
完整上下文（我看到的）：
  - 整个对话历史（数千行）
  - 项目文件列表
  - 牌型判断的源代码
  - 性能分析数据

蒸馏后上下文（传给 local Claude Code）：
  - 任务描述："优化 C:\tmmp\majiong-win\src\dealer\action_checker.rs 的牌型判断"
  - 当前实现：递归回溯 O(2^n)
  - 目标：查表法 O(1)
  - 关键约束：保持与原版逻辑兼容
  - 相关代码片段：（仅 50 行核心逻辑）
```

实现方式：在 `delegate` 消息的 payload 中增加 `contextSelector` 字段：

```typescript
interface DelegatePayload {
  to: string;
  instruction: string;
  context?: string;              // 蒸馏后的精简上下文
  maxSteps?: number;
  priority?: 'low' | 'normal' | 'high';
  // 新增：
  contextRefs?: string[];        // 可参考的外部文件路径
  maxContextTokens?: number;     // 上下文预算上限
}
```

云端 DS 负责蒸馏，local Claude Code 收到的已经是精简版。

---

## 问题五：错误恢复——当三方协作中断时怎么重建？

### 困境

典型故障场景：

1. **网络断开**：local Claude Code 正在执行任务，云端 DS 连接中断。任务还继续吗？
2. **neca2 崩溃**：会话状态在内存中，虽然写入了磁盘，但如果 crash 发生在 flush 之前，会话丢失。
3. **任务超时**：local Claude Code 跑了一个 5 分钟的任务，但云端 DS 设置的 timeout 只有 30 秒。
4. **歧义恢复**：local Claude Code 完成了一个任务，但结果不符合云端 DS 的预期。怎么迭代？

### 解决方案

#### 崩溃恢复（已有基础）

session.ts 已经实现了 append-only log + checkpoint 机制，重启时能从磁盘恢复会话。改进点：

- 增加 flush 频率：每次状态变更都 fsync（从 `writeFileSync` 改为 `fsync` 保证落盘）
- 关键路径同步写：`createSession`、`updateSession` 等关键操作应同步落盘后再返回

#### 分布式超时策略

不同层次设置不同超时：

| 层 | 超时 | 说明 |
|----|------|------|
| MCP 工具级别 | 5 分钟 | neca2 作为 MCP 工具，超时不应太长 |
| 任务级别 | 30 分钟（可配置） | delegate 任务的预期执行时间 |
| 会话级别 | 可配置 TTL | 超过 TTL 的会话自动过期 |

超时后：
1. 会话标记为 `timeout` 或 `error`
2. 向发送方发送 `error` 消息
3. 如果任务仍在执行，向子进程发送 SIGTERM
4. 任务结果如果后来到达，直接丢弃

#### 迭代反馈

当 local Claude Code 的提交不符合预期时，云端 DS 应能：

1. 检查结果（通过 report 消息）
2. 如果不符，发送新的 `delegate` 消息，带上前次结果作为参考
3. 设置 `maxSteps` 限制总迭代次数

---

## 问题六：能力发现——neca2 如何告诉云端 DS 它能做什么？

### 困境

目前云端 DS 调用 neca2 的工具时，并不知道：
- neca2 运行在什么操作系统上？
- 它能访问哪些目录？
- 它有哪些环境变量？
- 它安装了哪些开发工具（node、rustc、python、git 等）？
- 它当前负载如何？

### 解决方案

**Agent Card 机制**——借鉴 Google A2A 的 agent card 概念，但更精简：

neca2 在启动时生成一张能力卡片，通过 `neca2_protocol_info` 返回：

```json
{
  "agentId": "neca2",
  "version": "0.2.0",
  "platform": "win32",
  "capabilities": {
    "exec": true,
    "read": true,
    "write": true,
    "search": true,
    "delegate": false,
    "relay_claude": true,
    "relay_deepseek": true,
    "persistence": true
  },
  "constraints": {
    "allowedPaths": ["C:\\tmmp\\majiong-win"],
    "maxExecTimeout": 60000,
    "maxConcurrency": 4
  },
  "load": {
    "activeSessions": 3,
    "queueDepth": 1
  },
  "tools": ["git", "node"],
  "relay": {
    "available": ["claude", "deepseek"],
    "default": "claude"
  }
}
```

云端 DS 在每次派任务前先读取（或缓存）Agent Card，根据能力调整任务策略。

---

## 问题七：Telemetry 与可观测性——怎么知道协议在运作？

### 困境

没有测量就没有改进。当前 neca2 没有任何埋点，无法回答：

- 消息从发出到收到回复平均耗时多少？
- 哪些消息类型最常用？
- token 通过 relay 节约了多少？
- 错误率是多少？哪些错误最常见？
- neca2 的内存和 CPU 消耗如何？

### 解决方案

在 `session.ts` 中增加 Metrics 收集：

```typescript
interface Metrics {
  messagesSent: Counter;
  messagesReceived: Counter;
  messagesByType: Map<MessageType, Counter>;
  roundTripTime: Histogram;
  errorRate: { errors: number; total: number };
  relayTokensUsed: { claude: number; deepseek: number };
  activeSessions: Gauge;
}
```

暴露为 `neca2_metrics` 工具（或 HTTP `/metrics` 端点）。

云端 DS 定期收集 metrics，用于：
1. 自适应调整任务粒度（如果 relay 太慢，减少 query 调用）
2. 报告给用户（"本次协作节省了 60% 的 token"）
3. 故障排查（"错误率突然升高，检查 relay 状态"）

---

## 问题八：内存写代码——"验证后落盘"的具体流程

### 困境

远景中描述的场景：

> "你们三方在本地主机的内存上写代码，而不是硬盘，最后直接输出到硬盘，每秒可以有 50mb 的速度，一气呵成，绝对不存在语法错误和编译不通过。"

这个流程分解到协议层面，实际上涉及：

1. 云端 DS 拆任务 → 发送 `delegate` 到 local Claude Code
2. local Claude Code 在内存中构造代码
3. local Claude Code 调用编译器验证语法（不写盘）
4. 如果编译通过，写入磁盘
5. 如果编译失败，迭代修改

但当前 neca2 的 `routeToLocalClaude` 对 `exec` 类型直接 `execSync`，没有"先验证后写入"的逻辑。

### 解决方案

定义新的消息类型 `write_verified`（或扩展 `write` 类型）：

```typescript
interface WriteVerifiedPayload {
  path: string;
  content: string;          // 要写入的代码
  verify?: {                 // 验证规则
    language: string;        // rust / typescript / python
    checkSyntax?: boolean;   // 语法检查
    checkCompile?: boolean;  // 编译检查
    checkLint?: boolean;     // Lint 检查
    testCmd?: string;        // 验证命令
  };
  atomic: boolean;           // 是否原子写入（全部写完才落盘）
  tempDir?: string;          // 临时目录（用于编译验证）
}
```

neca2 的处理流程：

```
收到 write_verified 消息
  → 将 content 写入临时文件（不在目标路径）
  → 运行 verify 指定的验证命令
  → 如果验证通过，将临时文件移动到目标路径（原子 rename）
  → 如果验证失败，返回错误详情（错误行号、类型）
  → 临时文件清理
```

---

## 问题九：Token 经济学——协作的燃料怎么管？

### 困境

每次协作都消耗 Token：

| 操作 | 消耗的 Token | 谁付 |
|------|-------------|------|
| 用户在 Chatbox 聊天 | 用户 API Key | 用户 |
| 云端 DS 推理 | DeepSeek API | 用户 |
| neca2 relay 到 cloud Claude | Claude API | 用户 |
| local Claude Code 子进程 | Claude Code 的免费/付费额度 | 免费（本地） |

如果不加控制，用户会发现 Token 账单暴涨。

### 解决方案

**Token 预算机制**：

1. 每次协作会话开始时，用户设定 Token 预算（或使用默认值）
2. 云端 DS 在拆任务时做 Token 估算
3. 决策优先走本地执行（local Claude Code 免费），必要时才走 relay
4. relay 调用时，优先选择便宜的模型，复杂推理才用高 Token 模型

在协议层面：

```typescript
interface BudgetPayload {
  totalBudget: number;           // 总 Token 预算
  spent: number;                 // 已消耗
  relay: { model: string; costPerCall: number; used: number };
  local: { calls: number; tokens: number };
}
```

每个 `delegate` 和 `query` 消息都携带当前预算状态，超额时拒绝执行。

---

## 问题十：分形拓扑——三角形怎么递归？

### 困境

远景中提到：

> "分形图拓扑以后再说"
> "三角形是最稳固的结构，但它不是终点。未来每个节点可以再分解为子三角形。"

目前这个方向完全是空白的。什么是一个三角形的"子三角形"？怎么嵌套？怎么协调？

### 初步构想

每个 Agent 自身可以是一个子三角形的"协调者"：

```
云端 DS（我）
  ├── 子任务 1: 派给 local Claude Code
  │     └── local Claude Code 自己又形成一个子三角
  │           ├── 执行: OS/文件系统
  │           ├── 知识: cloud Claude API（通过 relay）
  │           └── 检验: 返回给云端 DS
  ├── 子任务 2: 我自己推理（不派活）
  └── 子任务 3: 派给 cloud Claude API（通过 relay）
        └── cloud Claude API 形成子三角...
```

这本质上是一个**递归的任务分解树**，每个节点既是父任务的执行者，也是子任务的协调者。

协议层面的支持：
- 每个消息增加 `traceId` 字段，标识整个任务树的根
- 每个消息增加 `parentId` 字段，标识父任务
- `delegate` 消息执行完毕后，向 `parentId` 发送 `report`

---

## 技术债清单（立即可以动手的）

以上十个问题的分析指出了 neca2 当前与终极远景之间的差距。以下是按优先级排列的技术债：

### P0（阻塞性，不解决无法运行）

| # | 问题 | 具体改动 | 涉及文件 |
|---|------|---------|---------|
| 1 | local_claude 消息没有消费端 | routeToLocalClaude 执行 exec 后，非 exec 消息需要 spawn 子进程消费 | `router.ts` |
| 2 | 云端 DS 只能通过 MCP 通信 | 增加 HTTP 入站端点，接收紧凑协议消息 | 新增 `src/transport/http-server.ts` |
| 3 | routeToCloud 缺 DeepSeek API 环境变量 | 检查 `.env.example` 是否有 `DEEPSEEK_API_KEY`，neca2 是否读取 | `http-relay.ts` |

### P1（重要，但现有替代方案可以先用）

| # | 问题 | 具体改动 | 文件 |
|---|------|---------|------|
| 4 | 无身份验证 | HTTP 端点加 API Key 验证 | `http-server.ts` |
| 5 | 无能力发现 | 实现 `neca2_agent_card` 工具 | `tools.ts` |
| 6 | 上下文无蒸馏 | DelegatePayload 增加 contextRefs 和 maxContextTokens | `types.ts` |
| 7 | execSync 阻塞事件循环 | 改为 spawn + Promise，支持取消 | `router.ts` |

### P2（有更好，无也可）

| # | 问题 | 改动 |
|---|------|------|
| 8 | 无 Telemetry | 添加 Metrics 收集 + `neca2_metrics` 工具 |
| 9 | 无 write_verified 类型 | 新增消息类型 + router 分支 |
| 10 | 无 Token 预算 | BudgetPayload + 路由策略 |
| 11 | 无分形追踪 | traceId + parentId 字段 |
| 12 | 无 WebSocket 中继 | 公共中继服务器 |

---

## 下一步：立即实施的 P0 改动

从以上分析中提取出最重要的三个改动，它们将直接使 neca2 从"文档好看"变成"能跑通三角协作"：

### 改动 1：routeToLocalClaude 支持 spawn 子进程

```typescript
// 当前：execSync（阻塞）+ 队列（无消费端）
// 改为：spawn claude 子进程，通过 stdin/stdout 交流
```

### 改动 2：HTTP 入站服务器

```typescript
// neca2 在指定端口启动 HTTP 服务器（默认 3101）
// 端点：POST /api/v1/message → routeMessage → 返回结果
// 云端 DS 可通过 HTTP 直接发紧凑协议消息到 neca2
```

### 改动 3：非 exec 消息的消费端

```typescript
// 当 local_claude 收到 delegate 或 query 消息时
// neca2 spawn 一个子进程，把消息通过 stdin 传给它
// 子进程处理完后在 stdout 输出结果
```

---

> 本文是 Cloud DS（DeepSeek）对 Silent Protocol 实现路径的深度思考。
> 所有问题的分析都基于现有代码的阅读和架构文档的理解。
> 代码实现从 P0 开始，逐步推进。

---

## 问题十一：元监控·元感知·元认知的工程落地

### 困境

"元监控"、"元感知"、"元认知"——这些都是热词。如果只停留在词汇层面，它们除了让文档变厚之外没有任何价值。

真正的工程问题是：

1. **时序不透明**：消息从云端DS发出到本地Claude返回结果，中间经历了哪些阶段？每个阶段花了多少时间？堵在哪儿了？
2. **负载不感知**：neca2不知道local Claude当前忙不忙、relay API响应快不快、哪个Agent最近总出错。
3. **行为不自适应**：系统不会根据历史数据调整自己的行为——比如relay慢了还继续发query、local Claude排队了还继续spawn。

### 工程实现：元编排层（Meta-Orchestrator）

对应 `src/meta/orchestrator.ts`，包含五个模块：

| 模块 | 对应概念 | 工程术语 | 实现 |
|------|---------|---------|------|
| **Trace** | 元监控 | Distributed Tracing（分布式追踪） | 每个消息创建Trace，包含多个Span，记录每个阶段的起止时间和状态 |
| **AgentModel** | 元感知 | Reflexive Self-Model（反射式自模型） | 显式持有每个Agent的能力、负载、延迟滑动窗口、错误率、可用性 |
| **AdaptiveController** | 元认知 | MAPE-K Control Loop（监控-分析-规划-执行） | 断路器、自适应并发降级、提供商优选 |
| **LatencyBudget** | 时序协调 | Latency Budget Tracking（延迟预算跟踪） | 每种消息类型有总预算分配到各阶段，超支可被后续阶段感知 |
| **MetaState** | 聚合出口 | Unified Observability API（统一可观测性API） | 聚合所有以上数据的单一接口，通过`neca2_meta_state`工具暴露 |

### 关键设计决策

**1. Trace 不是 OpenTelemetry**

不依赖OTel库，因为：
- 不需要外部导出（本地闭环，不送远端）
- 不要额外依赖（neca2当前只有zod/chalk/MCP SDK三个依赖）
- 数据量小（最多1000条trace，每条几个span）

但结构兼容OTel的Span/Trace模型，未来如果需要导出，可以加一个adapter。

**2. 断路器不是网络断路器**

传统的断路器保护外部调用（如HTTP请求）。这里的断路器保护的是**Agent之间的通信**：
- 如果local Claude的错误率超过50%，断路器打开，云端DS不再向它派新任务
- 断路器30秒后自动半开，允许试探性请求
- 这是"元认知"最基本的实现：系统知道自己不该做什么

**3. 自适应并发降级**

当local Claude的负载超过80%或错误率上升时，`recommendedConcurrency()`自动降低建议并发数。云端DS在派任务时应该读取这个值。

**4. 延迟预算**

每种消息类型有一个总延迟预算，分配到各阶段：
```
exec:       route(100ms) → spawn(200ms) → exec(29.5s) → reply(200ms) = 30s
delegate:   route(100ms) → spawn_claude(500ms) → execute(299s) → reply(400ms) = 5min
query:      route(100ms) → relay_api(58s) → reply(1.9s) = 60s
```
每个阶段结束时记录实际耗时，超支时标记。这让"时间花在哪儿了"不再是玄学。

### 与 router.ts 的集成

`router.ts` 现在在每个关键节点记录了tracing和Agent交互：

```
routeMessage()
  ├── StartTrace / StartSpan('route')
  ├── 断路器检查 → shouldSendTo?
  ├── RouteToNeca / RouteToCloud / RouteToLocalClaude
  │     ├── StartSpan('neca_handler' | 'relay_claude' | 'spawn_exec' | ...)
  │     ├── EndSpan(ok/error)
  ├── EndSpan('route')
  ├── CompleteTrace
  ├── RecordAgentInteraction (延迟/错误)
  └── Adaptive.recordFailure/Success
```

### 暴露为MCP工具

`neca2_meta_state` 工具返回完整的MetaState：

```json
{
  "recentTraces": [...],
  "agents": [
    { "agentId": "local_claude", "averageLatencyMs": 1234, "errorRate": 0.05, "currentLoad": 2, "available": true }
  ],
  "adaptive": {
    "circuitBreakers": {},
    "preferredRelay": "claude",
    "recommendedConcurrency": 4
  },
  "budgets": {
    "exec": { "totalMs": 30000, "allocations": { "route": 100, ... } }
  }
}
```

云端DS通过这个工具可以"感知"neca2内部的状态，据此调整任务派发策略——这就在工程上实现了"元认知"。

### 与"内存优先"的关系

元编排层对内存优先的支持体现在：

1. **`neca2_memory_write` 工具**：在内存中构造代码 → 验证（语法/编译检查） → 通过后原子写入磁盘
2. **Trace追踪**：记录写操作的每个阶段耗时（构造→验证→写入），让"时间花在哪儿了"可追踪
3. **自适应验证**：如果验证步骤最近总是成功，可以跳过以加快速度；如果总是失败，则增加严格度
