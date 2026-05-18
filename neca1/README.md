# neca 深度技术分析报告

> 基于源码 v2.0.0 的完整架构、设计模式与改进路径分析
> 报告日期：2026-05-18 | 分析人：DeepSeek（云端）

---

## 一、核心架构鸟瞰

neca（璇玑 MCP 本地服务器）是一个基于 `@modelcontextprotocol/sdk` 构建的 MCP 服务端，使用 TypeScript 编写，通过 stdio 或 HTTP 两种传输方式运行。

### 1.1 整体架构分层

```
┌─────────────────────────────────────────────────────────┐
│  MCP 传输层（McpServer）                                │
│  StdioServerTransport / StreamableHTTPServerTransport    │
├─────────────────────────────────────────────────────────┤
│  工具注册层（index.ts 工具循环注册）                      │
│  所有工具统一注册到 McpServer，通过 for...of 循环        │
├─────────────────────────────────────────────────────────┤
│  工具层（src/tools/）                                   │
│  filesystem | shell | vscode | claude_code | neca | relay│
├─────────────────────────────────────────────────────────┤
│  协议层（src/protocol/）                                │
│  types → codec → router（紧凑协议的消息路由）            │
├─────────────────────────────────────────────────────────┤
│  中继层（src/relay/）                                   │
│  session（会话管理）+ cloud-relay（Claude API 适配器）   │
├─────────────────────────────────────────────────────────┤
│  内存层（src/memory/）                                  │
│  index（时间线/事件记录）| store（持久化）| tasks（任务）│
├─────────────────────────────────────────────────────────┤
│  基础设施                                              │
│  process-registry | blackboard | logger | env | nbp     │
└─────────────────────────────────────────────────────────┘
```

### 1.2 文件依赖图

```
index.ts
 ├── tools/filesystem.ts  （文件读写 + 目录遍历 + 文件监听）
 ├── tools/shell.ts       （Shell 命令执行 + 白名单校验）
 ├── tools/vscode.ts      （VS Code 操作接口）
 ├── tools/claude_code.ts （Claude Code 子代理编排）
 ├── tools/neca.ts        （自省工具：health, diagnose, blackboard, NBP...）
 ├── tools/relay.ts       （MCP 工具接口层 → protocol/router）
 │
 ├── protocol/types.ts    （紧凑协议类型定义）
 ├── protocol/codec.ts    （消息编解码 + 校验）
 ├── protocol/router.ts   （消息路由：转发到目标实体）
 │
 ├── relay/session.ts     （会话管理器：创建/更新/过期/统计）
 ├── relay/cloud-relay.ts （Claude API HTTP 适配器）
 │
 ├── memory/index.ts      （时间线、事件记录）
 ├── memory/store.ts      （磁盘持久化）
 ├── memory/tasks.ts      （任务 CRUD）
 │
 ├── process-registry.ts  （子进程注册表）
 ├── blackboard.ts        （黑板报——全局态势快照）
 ├── logger.ts            （结构化日志）
 ├── env.ts               （环境变量加载）
 ├── nbp.ts               （NBP 二进制协议处理器）
 └── types.ts             （共享类型）
```

---

## 二、各模块深度分析

### 2.1 入口模块（index.ts）— 290行

**核心功能**：
- PID 文件管理（防重复启动 + 自动杀旧进程）
- 工具自动注册（for...of 循环遍历 allTools）
- 工具执行超时包装（runWithTimeout）
- 全局异常处理（uncaughtException / unhandledRejection）
- 优雅关闭（SIGINT/SIGTERM → 清理子进程 + 刷任务 + 删 PID）
- 双传输支持（stdio 和 HTTP）

**优点**：
- 注册模式简洁，新增工具只需加到 allTools
- 超时处理用了 Promise.race + clearTimeout，无泄漏
- 关闭流程有序：stopPolling → flushTasks → shutdownSession → killAll

**可改进点**：
- 工具注册在内存中完成，冷启动每次都要重新注册
- 未使用依赖注入，工具间硬引用
- relay HTTP server 和 MCP HTTP server 在两个端口，管理负担

### 2.2 协议层（src/protocol/）

#### types.ts — 49行
定义了紧凑协议的核心类型：
- `RelayAgent`：5 种预设 agent 标识
- `RelayMessageType`：8 种消息类型
- `RelayMessage` / `RelayResponse`：完整消息结构
- `RelaySession`：会话状态机
- `RelayConfig`：API 配置

**与 spec 对比的差异**：
| spec 定义 | 实际实现 | 差距 |
|-----------|---------|------|
| 12 种消息类型 | 8 种 | 缺少 `cancel`、`error`、`ack`、`init` |
| 6 种 AgentId | 5 种 | 缺少自定义扩展 |
| 二进制预留 | 无 | 只有 JSON |
| 版本协商 | 无 | 只有 `ver: 1` 硬编码 |

#### codec.ts — 65行
实现了 JSON 编解码，含入参校验。

**优点**：
- 简洁的 validate + encode + decode 模式
- makeMessageId 带时间戳+自增计数器
- 解码时的类型校验完整（from/to/type 都验证）

**可改进点**：
- 未实现 `Codec` 接口抽象（spec 中设计的 `interface Codec`）
- 没有错误码分类

#### router.ts — 177行
最复杂的协议模块，管理消息路由到 5 种目标：

| 目标 | 路由方式 | 状态 |
|------|---------|------|
| neca（自省） | 直接处理 ping/query 类型 | ✅ 完整 |
| cloud_claude | 调用 `queryClaudeAPI()` | ✅ 完整 |
| local_claude | spawn npx claude 子进程 | ✅ 完整 |
| cloud_ds | 投递到 pendingDeliveries 队列 | ⚠️ 需轮询 |
| user | 投递到 pendingDeliveries 队列 | ⚠️ 需轮询 |

**关键发现**：`routeToLocalClaude` 使用 `spawn('npx', ['claude', ...])` 来执行任务——它不调用 `tools/claude_code.ts` 中的 delegate 工具，而是走独立的 spawn 路径。这导致：
- 没有通过 neca 的进程注册表统一管理
- 没有使用已有的 `neca_delegate_async` 接口
- 直接硬编码 `npx claude`

**改进建议**：routeToLocalClaude 应调用已有的 delegate 工具，而不是自己 spawn。

### 2.3 中继层（src/relay/）

#### session.ts — 70行
**纯内存会话管理器**。特点：
- `Map<string, RelaySession>` 存储
- 定时清理过期会话（5 分钟 TTL，1 分钟检查一次）
- 支持按状态/目标筛选
- 提供 `sessionStats()` 总览

**风险**：
- 无磁盘持久化 → neca 重启后全部丢失
- 无速率限制保护
- `cleanupTimer.unref()` 可能导致 Node 在清理前退出

**改进建议**：新增 LRU + 磁盘持久化（append-only log + checkpoint）。

#### cloud-relay.ts — 73行
Claude API 的 HTTP 适配器，使用 fetch 调用 `api.anthropic.com/v1/messages`。

**优点**：
- 超时控制用 AbortController
- API Key 为空时优雅降级
- 错误信息截断（`substring(0, 200)`）防止日志爆炸

**缺点**：
- 只支持 Claude，不支持其他模型（DeepSeek/GPT）
- 没有重试机制（429 或 5xx 会直接返回错误）
- API Key 从环境变量读取，不支持动态切换

### 2.4 工具层（src/tools/）

#### filesystem.ts — 201行
标准文件操作：read/search/write/list_dir + watch/unwatch。

**白名单实现**：
```typescript
const ALLOWED_PATHS = (process.env.NECA_ALLOWED_PATHS || '~').split(',').map(...)
```
路径校验通过 `path.relative(allowed, resolved)` 来判断——这是正确的做法。
- 支持 `~` 扩展（用户主目录）
- 最大文件大小限制（默认 10MB）

**可改进点**：
- 白名单在模块加载时读取，不支持热更新
- 文件监听器用 Map 管理，shutdown 时清理

#### shell.ts — 约240行
Shell 命令执行，含命令白名单校验。

**命令白名单实现**：对 `&&`、`|`、`>`、`>>`、`<` 等操作符做了拆分校验，防止绕过。

**安全措施**：
- 禁止 `;`（命令注入）
- 禁止 `$()` 和反引号
- 每个子命令独立校验

#### claude_code.ts — 约400行
Claude Code 子代理管理，提供：
- `neca_delegate`：同步委托任务
- `neca_delegate_async`：异步委托
- `neca_claude_cluster`：并行集群
- `neca_task_cancel` / `neca_task_wait` / `neca_task_result`

**这是 neca 最复杂的工具**，实现了完整的子进程管理、spawn 限制、输出截断等。

#### relay.ts — 81行
MCP 工具接口层，将 relay 协议暴露为 MCP 工具：
- `neca_relay`：发送消息 + 可选回调等待
- `neca_relay_poll`：轮询会话状态
- `neca_relay_pending`：取回待处理消息

**优点**：实现了回调轮询机制（每 500ms 检查一次），最多等 60s。

**缺点**：回调轮询是忙等（`setTimeout` 链），不是事件驱动。高并发下会累积大量定时器。

#### neca.ts — 186行
自省工具集，包括 health、diagnose、blackboard、recall、NBP 等。

**亮点**：
- `neca_blackboard` 提供全局态势一瞥
- `neca_nbp` 实现了一个极简的二进制协议（NBP）
- `neca_shoufang_yiti` — 收放一体注意力计时器（带中文语境的特色功能）

### 2.5 内存层（src/memory/）

三层结构：
- `index.ts`：时间线管理（事件记录 + 检索）
- `store.ts`：磁盘持久化（JSON 文件读写）
- `tasks.ts`：任务 CRUD（支持完整状态机）

**时间线设计**：`Timeline` 对象包含用户身份、活跃上下文、neca 状态等——是一种极简的"人格记忆"实现。

### 2.6 NBP 二进制协议

neca 已经实现了一个极简的二进制协议（NBP），有完整的 opcode 定义和编解码器。但：
- 只通过 base64 封装在 JSON-RPC 中传输
- 没有独立的二进制传输通道
- 尚未被 relay 协议使用

### 2.7 黑板报（blackboard.ts）

`readBlackboard()` 函数生成全局态势快照，包含：
- 服务器状态（运行时间、工具数量、传输方式）
- 所有任务统计
- 系统资源
- 最近工具调用记录

云端模型可以先调用 `neca_blackboard` 了解全局再决策——这是我们之前对话中设计的"黑板报"模式。

---

## 三、架构风格评估

| 维度 | 评价 |
|------|------|
| **模块化** | 良好。工具按职责拆分，协议/中继/内存各司其职 |
| **可测试性** | 弱。所有模块直接使用全局状态、process.env、同步 fs |
| **错误处理** | 中等。catch 广泛但缺少分级，部分错误信息不友好 |
| **性能** | 良好。同步 fs 在本地场景下足够快，异步 I/O 用于子进程 |
| **安全性** | 良好。白名单 + 命令拆分 + 速率限制 |
| **可扩展性** | 良好。新增工具只需加一个文件 + 注册到 allTools |
| **配置管理** | 中等。所有配置通过 process.env，不支持配置文件热加载 |
| **持久化** | 中等。内存为主，session 无持久化，memory 可持久化 |

---

## 四、与 Silent Protocol spec 的差距

| spec 要求 | neca 实现 | 差距分析 |
|-----------|----------|---------|
| 完整紧凑协议 | ✅ 基本实现 | 缺少 cancel/error/ack/init 类型 |
| Codec 抽象接口 | ⚠️ 部分 | 有 encode/decode 但未抽象为接口 |
| 二进制编码支持 | ⚠️ NBP 存在 | NBP 独立于 relay，未整合 |
| 版本协商 | ❌ | 硬编码 ver: 1 |
| 会话持久化 | ❌ | 纯内存 |
| 路由到 cloud_ds | ✅ 队列 | 需要轮询 |
| 路由到 cloud_claude | ✅ | 单模型（仅 Claude） |
| 多用户支持 | ❌ | 单用户模式 |
| 错误码分类 | ❌ | 统一抛字符串 |
| 尝菜式反馈流 | ❌ | 未实现 |
| 协议合规性测试 | ❌ | 无测试套件 |

---

## 五、关键改进路径（按优先级）

### P0 - 紧急

1. **协议类型补全**：补充 `cancel`、`error`、`ack`、`init` 四种消息类型
2. **Codec 抽象**：实现 `interface Codec` 并让 JsonCodec 实现它

### P1 - 重要

3. **会话持久化**：append-only log + checkpoint，neca 重启后恢复未完成的会话
4. **重试机制**：cloud-relay 加入指数退避重试
5. **routeToLocalClaude 重构**：调用 delegate 工具代替直接 spawn

### P2 - 加分

6. **多模型支持**：cloud-relay 支持 DeepSeek/GPT 等
7. **错误码体系**：统一定义错误码（`TIMEOUT`、`PATH_NOT_ALLOWED`、`CMD_NOT_ALLOWED`...）
8. **版本协商**：连接初始化时交换版本和功能列表
9. **回调事件驱动**：用 EventEmitter 代替 500ms 轮询

---

## 六、总结

neca 是一个**已在实战中验证**的 MCP 网关实现。它的设计超前于市面上大多数同类项目——紧凑协议、黑板报、NBP 二进制协议、任务状态机、结构化日志——这些功能在其它 MCP server 中都很难找到。

它当前的状态是"工程原型"向"生产系统"过渡的阶段：
- 核心概念验证通过 ✅
- 实际场景可用 ✅
- 但在可靠性、持久化、多模型支持上还有明显缺口

这些缺口，正是 `neca2` 要补上的。
