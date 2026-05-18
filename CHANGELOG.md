# Changelog

> 所有显著的变更都会记录在此文件。
> 格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
> 版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [0.2.0] — 2026-05-18

### 新增
- **VISION.md**：项目远景宪章，定义三角激光转动模式、四方角色、成功标志
- **ROADMAP.md**：四个里程碑的完整路线图（M0-M4）
- **CHANGELOG.md**：本文件
- **GitHub CI 工作流**：`.github/workflows/ci.yml`——`npm test` + `npm run build` + lint
- **GOVERNANCE.md**：项目治理模型（BDFL + 核心贡献者模式）
- **CODE_OF_CONDUCT.md**：贡献者行为准则
- **neca2 测试配置**：`vitest.config.ts`，集成到 CI

### 修复
- **neca Claude Code 子进程**：`spawn('npx', ['claude', ...])` → `spawn('claude', [...])`，解决 `npx` 找不到 `claude` 包的问题
  - 已在编译后 JS（当前运行）和源码 TS（未来编译）同步修复
- **Chatbox MCP 配置**：neca2 已注册为第二个 MCP Server，重启即生效

---

## [0.1.0] — 2026-05-18

### 新增
- **哲学基座**：8 条公理（认知即压缩、频率差异即隔离、生理性劫持、尝菜式反馈、散热瓶颈、系统闭合即热寂、地图不等于疆域、万物需要伙伴）
- **科学背景**：7 大学科交叉（认知科学、神经科学、复杂科学、热力学、量子力学、信息论、计算机科学）
- **需求溯源文档**：7 层需求递进（从"挑毛病"到"紧凑协议"）
- **ADR 体系**：3 篇架构决策记录
  - ADR-0001：Silent Protocol 整体架构
  - ADR-0002：紧凑协议设计
  - ADR-0003：四方协作模式
- **紧凑协议规范 v1.0**：9 种消息类型、编解码器接口、路由规则、会话管理、安全约束
- **四方协作架构解析**：全景图、8 步标准流、5 层协议栈、3 种部署模型、技术对比
- **项目基础设施**：MIT LICENSE、.env.example、.gitignore、CONTRIBUTING.md、SECURITY.md
- **文档体系**：术语表（16 个定义）、安装指南、快速入门、错误处理全景
- **neca1 深度分析报告**：6 层架构拆解、12 项 gap 分析、改进路线图
- **neca2 参考实现**：编译运行通过，9 个 MCP 工具
  - `src/protocol/types.ts`：13 种消息类型
  - `src/protocol/codec.ts`：Codec 接口 + JsonCodec 实现
  - `src/relay/session.ts`：持久化会话管理器
  - `src/relay/router.ts`：5 种目标的消息路由器
  - `src/relay/http-relay.ts`：多模型中继（Claude + DeepSeek）
- **neca2 单元测试**：protocol.test.ts（17 项）+ session.test.ts（14 项）
- **neca2 端到端示例**：examples/e2e-demo/
- **neca2 改进建议**：7 条优化方案（P0-P3）

---

## 版本命名规范

```
0.x.y — 预发布阶段（里程碑完成时 bump minor）
1.0.0 — 首次稳定发布（里程碑 4 达成时）
```

> 当前阶段：**Pre-release**。API 和协议可能会有 breaking changes。
