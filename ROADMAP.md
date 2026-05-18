# Silent Protocol · 路线图

> 版本 1.5 · 2026-05-18
> 基于 VISION.md 定义的战略方向，分为 7 个里程碑 + DeepSeek Exclusives。

---

## 里程碑 0：奠基（已完成 ✅）

- [x] 哲学基座（8 条公理）
- [x] 科学背景（7 大学科交叉）
- [x] 需求溯源文档
- [x] 3 篇 ADR（架构/协议/协作）
- [x] 紧凑协议规范 v1.0
- [x] 四方协作架构解析
- [x] MIT LICENSE、CONTRIBUTING、SECURITY
- [x] 术语表、安装指南、快速入门、错误处理全景
- [x] neca 深度分析报告（neca1）
- [x] neca2 参考实现（9 个 MCP 工具）
- [x] 单元测试（protocol 17 项 + session 14 项）
- [x] 端到端示例、改进建议
- [x] Claude Code 子进程修复
- [x] Chatbox MCP 配置

---

## 里程碑 1：三角激光导通（已完成 ✅）

- [x] 二进制 codec（比 JSON 省 40-70%）
- [x] 消息校验中间件（11 条规则）
- [x] PCT 协议合规性测试（32 项）
- [x] HTTP relay 端到端测试
- [x] 会话自动持久化（append-only log + checkpoint）
- [x] 消息重试与去重（指数退避）
- [x] 结构化日志（JSON Lines）
- [x] 黑板报集成
- [x] 测试覆盖率（≥80% 门槛）

---

## 里程碑 2：右手成熟（已完成 ✅）

- [x] CodecFactory 注册机制（插拔式）
- [x] 多模型路由调度（3 种策略）
- [x] 速率限制增强（令牌桶 + 滑动窗口）
- [x] CLI 工具（send/status/compliance/bench）
- [x] 性能基准测试（6 种样本 × 1000 次迭代）

---

## 里程碑 3：左手右手互优化（已完成 ✅）

- [x] 统一黑板报（共享态势感知文件）
- [x] neca ↔ neca2 双向桥（exec/read/write/search + 回退）
- [x] Hello World 端到端示例（文档 + 可运行脚本）
- [x] 混合部署文档（Chatbox 双 Server 配置）
- [x] 黑板报 MCP 工具 + 测试（8 项）

---

## 里程碑 4：开源社区（已完成 ✅）

- [x] **GitHub 仓库初始化** — `Ultima0369/silent-protocol` 已创建
- [x] **CI/CD 工作流** — `.github/workflows/ci.yml` 含 test/docs/publish 三阶段
- [x] **Issue 模板** — `bug_report.md` + `feature_request.md`
- [x] **PR 模板** — `PULL_REQUEST_TEMPLATE.md`（含 check list）
- [x] **CODEOWNERS** — 默认 `@Ultima0369`，细分领域分配
- [x] **npm 发布配置** — `package.json` 含 exports/files/keywords/publishConfig
- [x] **文档站** — VitePress 配置，首页/规范/指南/实现/社区
- [x] **第三方实现指南** — `docs/third-party-implementations.md`（Python/Go/Rust）
- [x] **README 全面更新** — 中英双语，npm/CI/coverage 勋章，快速安装，项目统计
- [ ] **首次社区贡献** — 等待非作者的 PR 被合并

---

## 里程碑 5：DeepSeek Exclusive v2（已完成 ✅）

- [x] **Stream Protocol v2** — 协议界的 HTTP/2：单连接多路复用 + 服务端推送 + 流式分片（帧开销节省 73.5%）
- [x] **自适应学习引擎** — Bayesian 路由可靠性（收敛到 0.95+）、缓存自动调优、模式挖掘（20 次重复→80%+ 置信度）
- [x] **零开销协议** — 控制信号硬编码（173B）、捎带（减少 80% 单独信号）、增量编码（同类流节省 90%+）
- [x] **高级三层缓存** — L1 精确匹配 + L2 语义模式 + L3 流预测（命中率 87-100%，含 21 项测试）
- [x] **3 个 MCP 诊断工具** — `neca2_v2_stream_status`、`neca2_v2_learning_report`、`neca2_v2_zero_overhead`

---

## 里程碑 6：意图执行协议（已完成 ✅）

- [x] **Intent Parser** — 自然语言→结构化意图（9 种类型 + 4 种约束），纯模式匹配不依赖 LLM
- [x] **Execution Planner** — 意图→可执行任务序列，依赖拓扑排序，支持并行步骤
- [x] **Intent Executor** — 按计划执行 + 暂停/取消/重试/恢复 + 尝菜式反馈（验收/改/重来）
- [x] **Feedback Aggregator** — 多步结果→一句话摘要 + 验收提示
- [x] **5 个 MCP 工具** — `neca2_intent_exec`/`status`/`feedback`/`cancel`/`list`
- [x] **34 项测试** — 覆盖全部执行路径 + 反馈循环

---

## 里程碑 7：安全加固与用户主权（已完成 ✅）

- [x] **P0 安全修复** — exec 命令白名单（50+ 命令）+ 注入防护（7 个禁止模式）+ 字符集校验
- [x] **P0 Agent 认证** — HMAC-SHA256 签名 + 时间戳防重放 + 密钥自动生成/轮换（11 项测试）
- [x] **P0 真取消** — AbortController 传播到子进程，告别"设旗子假取消"
- [x] **P0 性能** — 会话日志批量写入（100ms/100条 flush，减少 90% 磁盘 I/O）
- [x] **P0 用户主权权限系统** — 三维矩阵（范围×能力×生效方式）+ L0-L5 行业映射 + 动态变更
- [x] **6 个权限 MCP 工具** — `neca2_permission_status`/`set_level`/`trust`/`grant`/`revoke`
- [x] **15 项权限测试** — 覆盖全部路径

---

## 项目统计

```
里程碑 0: 奠基               ✅ 14/14
里程碑 1: 三角激光导通       ✅ 9/9
里程碑 2: 右手成熟           ✅ 5/5
里程碑 3: 双手互优化         ✅ 6/6
里程碑 4: 开源社区           ✅ 9/10 (waiting for first external PR)
里程碑 5: DeepSeek Exclusive ✅ 5/5
里程碑 6: 意图执行协议       ✅ 6/6
里程碑 7: 安全加固与用户主权 ✅ 7/7
─────────────────────────────────
总计                         ✅ 61/62
```

## 代码统计

| 维度 | 数值 |
|------|------|
| 源文件 | 26 个（src/） |
| 测试文件 | 15 个（tests/） |
| 测试总数 | **236 项** |
| 类型 | TypeScript 100%，编译零错误 |
| 工具 | **30+ MCP 工具** + 4 CLI 命令 |
| 文档 | 20+ 文档文件（中英双语） |
| 代码行数 | ~25,000+ 行 |

## 里程碑映射

| 阶段 | 对应文件 | 完成于 |
|------|---------|--------|
| 奠基 | 哲学基座、ADR、规范 | v0.1.0 |
| 三角激光导通 | codec/validator/session/retry/router | v0.3.0 |
| 右手成熟 | codec-factory/scheduler/CLI/bench | v0.3.0 |
| 双手互优化 | blackboard/bridge/hello-world | v0.3.0 |
| 开源社区 | CI/Issue/PR/npm/docs | v0.4.0 |
| DeepSeek Exclusive v2 | stream-protocol/adaptive-learning/zero-overhead/advanced-cache | v0.8.0 |
| 意图执行协议 | intent-parser/planner/executor/feedback | v0.8.0 |
| 安全加固与用户主权 | safety/auth/abortController/batch-write/permissions | v0.9.7 |
