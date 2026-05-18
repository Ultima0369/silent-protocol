# Changelog

> 所有显著的变更都会记录在此文件。
> 格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
> 版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [0.3.0] — 2026-05-18

### 第一波：三角激光导通 🎯

[二进制 codec、校验中间件、重试队列、自动持久化、结构化日志...]
→ 见 v0.3.0 上一版完整记录

### 第二波：右手成熟 🏗️

[CodecFactory、路由调度、速率限制、CLI、基准测试...]
→ 见 v0.3.0 上一版完整记录

### 第三波：左手右手互优化 🤝

#### 新增
- **统一黑板报** `src/shared/blackboard.ts` — neca + neca2 共享态势感知，原子写入 `~/.neca/shared-blackboard.json`，15 秒自动同步
- **neca ↔ neca2 双向桥** `src/shared/neca-bridge.ts` — exec/read/write/search 智能桥接，neca 在线时委托给它，离线时自动回退本地执行
- **Hello World 端到端示例** `examples/hello-world/` — README 文档（含 3 种运行方式）+ `send-hello.ts` 可运行脚本（完整 6 步流程）
- **混合部署指南** `docs/hybrid-deployment.md` — Chatbox 双 Server 配置模板、工具分类矩阵、路由决策矩阵、故障排查
- **黑板报 MCP 工具** — `neca2_blackboard` 读取共享黑板报，`neca2_bridge_status` 检查桥接状态
- **黑板报测试** `tests/blackboard.test.ts` — 8 项测试（读写/消息记录/摘要/在线检测）

#### 变更
- `src/index.ts` — 启动时初始化黑板报、检测 neca 状态、优雅关闭写黑板报
- `src/tools.ts` — 增加 2 个新工具，工具调用后自动同步黑板报，neca2_health 返回桥接和黑板报状态
- `ROADMAP.md` — 里程碑 3 标记完成，项目统计 36/42

#### 总计
- 新增 4 个源文件（~22KB）
- 新增 1 个测试文件（~5KB）
- **117 项测试全部通过**（8 个测试文件）
- TypeScript 编译零错误

---

## [0.2.0] — 2026-05-18

[VISION.md、ROADMAP.md、GitHub CI、GOVERNANCE.md...]
→ 见上版记录

---

## [0.1.0] — 2026-05-18

[哲学基座、科学背景、ADR 体系、compact-protocol-spec...]
→ 见上版记录

---

## 版本命名规范

```
0.x.y — 预发布阶段（里程碑完成时 bump minor）
1.0.0 — 首次稳定发布（里程碑 4 达成时）
```

> 当前阶段：**Pre-release**。API 和协议可能会有 breaking changes。
