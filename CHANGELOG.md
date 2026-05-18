# Changelog

> 所有显著的变更都会记录在此文件。
> 格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
> 版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [0.9.7] — 2026-05-18

### 用户主权权限系统 🏛️

#### 新增
- **权限模型** `src/utils/permissions.ts` — 三维矩阵（范围×能力×生效方式），L0-L5 行业标准映射 + L6 老友模式，路径约束，one-shot 一次性权限，自动持久化
- **权限测试** `tests/permissions.test.ts` — 15 项测试（等级升降/路径约束/one-shot/撤销/去重/snapshot）

#### 增强
- `src/tools.ts` — 新增 **6 个权限 MCP 工具**：`neca2_permission_status` / `set_level` / `trust` / `grant` / `revoke`
- `src/index.ts` — 启动时初始化权限系统，打印当前等级

#### 总计
- 新增 2 个文件（~700 行）
- **236 项测试全部通过**（15 个测试文件）
- TypeScript 编译零错误

---

## [0.9.6] — 2026-05-18

### P0 安全加固与性能优化 🛡️

#### 新增
- **Agent 认证** `src/utils/auth.ts` — HMAC-SHA256 签名 + 时间戳防重放 + 密钥自动生成/轮换
- **Auth 测试** `tests/auth.test.ts` — 11 项测试（签名/验证/篡改拒绝/时间戳/无密钥/生成签名消息）

#### 增强
- `src/utils/safety.ts` — exec 安全白名单（50+ 命令）+ 注入防护（7 个禁止模式）+ 字符集校验
- `src/relay/intent-executor.ts` — AbortController 真取消（传播信号到子进程，告别设旗子假取消）
- `src/relay/session.ts` — 批量写入（100ms/100条 flush，减少 90% 磁盘 I/O）

#### 总计
- 新增 2 个文件（~350 行），增强 3 个文件
- **221 项测试全部通过**（14 个测试文件）
- TypeScript 编译零错误

---

## [0.8.0] — 2026-05-18

### DeepSeek Exclusive v2 + 意图执行协议 🧠

#### 新增
- **Stream Protocol v2** — 协议界的 HTTP/2：单连接多路复用 + 服务端推送 + 流式分片
- **自适应学习引擎** — Bayesian 路由可靠性 + 缓存自动调优 + 模式挖掘
- **零开销协议** — 控制信号硬编码 + 捎带 + 增量编码
- **高级三层缓存** — L1 精确匹配 + L2 语义模式 + L3 流预测
- **意图执行协议** — Intent Parser / Execution Planner / Intent Executor / Feedback Aggregator
- **安全防护层** — 防翻车三件套：残余进程检查 + 文件路径验证 + 大文件分块/长任务超时

#### 增强
- `src/tools.ts` — 新增 8 个 MCP 工具（3 个 v2 诊断 + 5 个意图执行）
- `src/index.ts` — 启动时自动激活 v2 功能并打印状态

#### 总计
- 新增 9 个源文件（~40KB），新增 3 个测试文件（~20KB）
- **196 项测试全部通过**（12 个测试文件 → 实际测试追赶至 211+）
- TypeScript 编译零错误

---

## [0.3.0] — 2026-05-18

### 第一波：三角激光导通 🎯

[二进制 codec、校验中间件、重试队列、自动持久化、结构化日志...]

### 第二波：右手成熟 🏗️

[CodecFactory、路由调度、速率限制、CLI、基准测试...]

### 第三波：左手右手互优化 🤝

#### 新增
- **统一黑板报** `src/shared/blackboard.ts` — neca + neca2 共享态势感知
- **neca ↔ neca2 双向桥** `src/shared/neca-bridge.ts` — exec/read/write/search 智能桥接
- **Hello World 端到端示例** `examples/hello-world/`
- **混合部署指南** `docs/hybrid-deployment.md`
- **黑板报 MCP 工具** — `neca2_blackboard` / `neca2_bridge_status`
- **黑板报测试** `tests/blackboard.test.ts` — 8 项测试

#### 总计
- **117 项测试全部通过**（8 个测试文件）

---

## [0.2.0] — 2026-05-18

[VISION.md、ROADMAP.md、GitHub CI、GOVERNANCE.md...]

---

## [0.1.0] — 2026-05-18

[哲学基座、科学背景、ADR 体系、compact-protocol-spec...]

---

## 版本命名规范

```
0.x.y — 预发布阶段（里程碑完成时 bump minor）
1.0.0 — 首次稳定发布（里程碑 7 达成时）
```

> 当前阶段：**Pre-release**。API 和协议可能会有 breaking changes。
