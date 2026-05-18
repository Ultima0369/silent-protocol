# 混合部署指南 — neca + neca2 双 MCP Server

> 让左手（neca：40+ 工具）和右手（neca2：紧凑协议核心）同时在线。

## 为什么需要双 Server？

```
Chatbox
  ├── neca  (左手)   → 文件系统、Shell、VS Code、Claude Code 编排
  └── neca2 (右手)   → 紧凑协议编解码、多模型中继、会话持久化、元编排层
```

- **neca** 是万能工具箱，处理日常文件操作、命令执行、编辑器交互
- **neca2** 是协议核心，处理智能体间通信、协议合规、路由调度、结构化日志

两者通过 **统一黑板报**（`~/.neca/shared-blackboard.json`）共享态势感知。

## Chatbox 配置

### 步骤 1：添加 neca MCP Server

```
设置 → MCP 服务器 → 添加新服务器
  名称: neca
  类型: 本地
  命令: node C:\path\to\neca-mcp-server\dist\index.js
  工作目录: C:\path\to\neca-mcp-server
```

### 步骤 2：添加 neca2 MCP Server

```
设置 → MCP 服务器 → 添加新服务器
  名称: neca2
  类型: 本地
  命令: node C:\Users\Ultima\Desktop\silent-protocol\neca2\dist\index.js
  工作目录: C:\Users\Ultima\Desktop\silent-protocol\neca2
```

### 步骤 3：验证

在两个对话中分别调用：

```
neca 对话: 调用 neca_health → 预期返回 40+ 工具在线
neca2 对话: 调用 neca2_health → 预期返回 13 个工具 + 黑板报信息
```

## 工具分类

### neca（左手）— 40+ 工具

| 分类 | 工具 |
|------|------|
| 文件系统 | neca_read_file, neca_write_file, neca_search_file, neca_list_dir, neca_file_watch, neca_file_unwatch |
| Shell | neca_execute_command, neca_exec_async |
| VS Code | neca_vscode_open, neca_vscode_command, neca_vscode_run_task |
| Claude Code | neca_do, neca_delegate, neca_delegate_async, neca_claude_cluster, neca_task_cancel/wait/result |
| 自省 | neca_health, neca_diagnose, neca_blackboard, neca_recall |
| 协议 | neca_relay, neca_relay_poll, neca_relay_pending, neca_nbp, neca_nbp_spec |
| 特色 | neca_shoufang_yiti, neca_batch, neca_task_create/update/list |

### neca2（右手）— 13+ 工具

| 分类 | 工具 |
|------|------|
| 协议 | neca2_send, neca2_poll, neca2_pending |
| 会话 | neca2_sessions, neca2_session_delete |
| 执行 | neca2_exec |
| 状态 | neca2_health, neca2_relay_status, neca2_meta_state, neca2_protocol_info |
| 内存 | neca2_memory_write, neca2_memory_context |

## 路由决策矩阵

当收到一条消息时，neca2 根据目标决定路由：

| 目标 | 路由方式 | 说明 |
|------|---------|------|
| `neca` | 本地处理 | ping/pong/query/cancel |
| `local_claude` | spawn 子进程 | 执行 exec/delegate/query |
| `cloud_claude` | HTTP relay | 调用 Claude API |
| `cloud_ds` | 待处理队列 | 等待 poll |
| `user` | 待处理队列 | 等待 poll |
| `ext_*` | 外部转发 | 通过桥接器 |

## 统一黑板报

neca 和 neca2 共享 `~/.neca/shared-blackboard.json`：

```json
{
  "version": 1,
  "updatedAt": "2026-05-18T10:00:00Z",
  "agents": {
    "neca": { "status": "alive", "uptime": 3600, "toolCount": 40, "lastSeen": "..." },
    "neca2": { "status": "alive", "uptime": 1800, "toolCount": 13, "lastSeen": "..." }
  },
  "sessions": { "total": 42, "running": 2, "completed": 38, "error": 2 },
  "retryQueue": { "depth": 0, "enqueued": 5, "succeeded": 5, "failed": 0 }
}
```

> 查看黑板报：neca 对话中调用 `neca_blackboard`，或 neca2 对话中查看 `neca2_health` 返回的 memory 字段。

## 环境变量

### neca（在 neca 的 .env 中配置）

```
NECA_ALLOWED_PATHS=C:\Users\Ultima\Desktop
ANTHROPIC_API_KEY=sk-...
```

### neca2（在 neca2 的 .env 中配置）

```
ANTHROPIC_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
NECA2_DEFAULT_RELAY=claude
NECA2_RELAY_MODEL=claude-sonnet-4-20250514
NECA2_RELAY_DS_MODEL=deepseek-chat
NECA2_HTTP_PORT=3101
NECA2_API_KEY=
```

## 启动顺序

1. 先启动 neca（它会写入黑板报标记自己在线）
2. 再启动 neca2（它会读取黑板报发现 neca，写入自己的状态）
3. 启动 Chatbox，两个 MCP Server 自动连接

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| neca2 找不到 neca | 黑板报未共享 | 检查 `~/.neca/` 目录权限 |
| 工具调用超时 | neca 未运行 | 先启动 neca，再启动 neca2 |
| 黑板报过时 | neca 已崩溃 | 重启 neca，黑板报自动更新 |
