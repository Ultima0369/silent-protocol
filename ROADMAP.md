# Silent Protocol · 路线图

> 版本 1.0 · 2026-05-18
> 基于 VISION.md 定义的战略方向，分为 4 个里程碑。

---

## 里程碑 0：奠基（已完成 ✅）

> 目标：项目骨架就绪，协议定义完整，参考实现可编译运行。

- [x] 哲学基座（8 条公理）
- [x] 科学背景（7 大学科交叉）
- [x] 需求溯源文档
- [x] 3 篇 ADR（架构/协议/协作）
- [x] 紧凑协议规范 v1.0
- [x] 四方协作架构解析
- [x] MIT LICENSE、CONTRIBUTING、SECURITY
- [x] 术语表、安装指南、快速入门、错误处理全景
- [x] neca 深度分析报告（neca1）
- [x] neca2 参考实现（编译运行通过，9 个 MCP 工具）
- [x] neca2 单元测试（protocol 17 项 + session 14 项）
- [x] neca2 端到端示例
- [x] neca2 改进建议（7 条）
- [x] neca Claude Code 子进程修复（npx → claude）
- [x] neca2 注册到 Chatbox MCP 配置

---

## 里程碑 1：三角激光导通（P0 · 2-4 周）

> 目标：跑通第一个端到端闭环——Chatbox 发一句话 → 本地执行 → 结果返回。

### 协议层
- [ ] **二进制 codec 实现**（protobuf 或 msgpack，作为 JsonCodec 的替代）
- [ ] **消息校验中间件**（自动校验每条消息的合规性）
- [ ] **协议合规性测试套件**（PCT: Protocol Compliance Tests）

### 中继层
- [ ] **HTTP relay 端到端测试**（模拟 cloud_ds → local_claude 消息流转）
- [ ] **会话自动持久化**（autoPersist 选项，状态变更即写盘）
- [ ] **消息重试与去重**（RetryQueue，指数退避，最多 3 次）

### 可观测性
- [ ] **结构化日志**（JSON Lines 到 ~/.neca/neca2.log）
- [ ] **黑板报集成**（neca2_health 返回会话统计、中继延迟）

### 测试
- [ ] **集成测试**（从 MCP 工具调用到 relay 返回的全链路）
- [ ] **测试覆盖率门槛**（≥80%）

---

## 里程碑 2：右手成熟（P1 · 2-4 周）

> 目标：neca2 达到生产可用标准，可独立部署。

- [ ] **批量会话过期清理**（定时器，5 分钟间隔）
- [ ] **CodecFactory 注册机制**（支持第三方编解码器）
- [ ] **多模型路由调度**（RoundRobin / Priority / LeastLoaded）
- [ ] **速率限制与认证**（express-rate-limit 增强）
- [ ] **错误恢复与崩溃恢复**（磁盘 checkpoint → 重启恢复）
- [ ] **性能基准测试**（与纯自然语言对比 token 节约率）
- [ ] **CLI 工具**（`neca2 send`、`neca2 status`、`neca2 compliance`）

---

## 里程碑 3：左手右手互优化（P2 · 持续）

> 目标：neca 通过 neca2 的协议能力，neca2 通过 neca 的执行能力，形成反馈闭环。

- [ ] **neca 集成 neca2 协议**（neca 的 `neca_send` 直接使用 neca2 的 codec）
- [ ] **neca2 调用 neca 的 exec 能力**（复用已有的 shell/file/vscode 工具）
- [ ] **统一黑板报**（neca + neca2 共享态势感知）
- [ ] **混合部署文档**（同时注册 neca + neca2 的 Chatbox 配置模板）
- [ ] **"Hello World" 完整示例**（从 Chatbox 发一句话到本地执行完成的全流程记录）

---

## 里程碑 4：开源社区（P3 · 2-3 月）

> 目标：项目在 GitHub 上开放，吸引贡献者，形成生态。

- [ ] **GitHub 仓库初始化**（含 Actions CI、Issue 模板、PR 模板）
- [ ] **发布 v1.0.0**（npm 包：`@silent-protocol/gateway`）
- [ ] **官网 / 文档站**（GitHub Pages 或 VitePress）
- [ ] **第三方实现指南**（Python、Go、Rust 的网关实现指引）
- [ ] **社区治理文档**（GOVERNANCE.md、CODEOWNERS）
- [ ] **首次社区贡献**（非作者的 PR 被合并）

---

## 优先级总览

```
P0（现在就做）:       导通链路 · 二进制 codec · 自动持久化 · 重试
P1（接下来做）:       路由调度 · 速率限制 · 崩溃恢复 · 性能基准
P2（持续迭代）:       双手互优化 · 统一黑板报 · 混合部署
P3（开源后）:         GitHub生态 · npm 包 · 文档站 · 第三方实现
```

---

> 路线图是活的。随着项目演进和社区反馈，里程碑会调整。
> 当前目标：**里程碑 1 在 2 周内跑通。**
