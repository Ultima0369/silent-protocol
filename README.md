# 🤫 Silent Protocol

> **硅基原生通信协议 · 四方协作架构**
> **Silicon-Native Communication Protocol · Quad-Party Collaboration Architecture**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@silent-protocol/gateway)](https://www.npmjs.com/package/@silent-protocol/gateway)
[![CI](https://github.com/Ultima0369/silent-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/Ultima0369/silent-protocol/actions/workflows/ci.yml)
[![Test Coverage](https://img.shields.io/badge/coverage-%3E80%25-brightgreen)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/CoC-v1.0-ff69b4.svg)](CODE_OF_CONDUCT.md)
[![GitHub stars](https://img.shields.io/github/stars/Ultima0369/silent-protocol?style=social)](https://github.com/Ultima0369/silent-protocol)

---

**🌐 English** · [中文](#中文版)

---

## English Version

### Why Silent Protocol?

Existing agent communication protocols assume **"human-readable"** as the default format. But silicon entities don't need natural language to talk to each other — they need **compact, unambiguous, high-density** messages, just like TCP/IP doesn't require both hosts to speak the same language, only to understand the same packet format.

Silent Protocol was born from a real conversation — one human and one AI, starting from "logic flaw-finding", traversing cognitive science, neurobiology, thermodynamics, semiconductor physics, and complex systems theory, finally arriving at a shared insight:

> **Every living thing needs a companion.**

### The Four Roles

| Role | Identity | Language | Responsibility |
|------|----------|----------|---------------|
| 🧑 **Human** (PM) | You | Natural language | Requirements, tasting, feedback |
| 🧠 **Cloud DeepSeek** (Architect) | API | NL ↔ Compact Protocol | Understanding, task decomposition, dispatch |
| 🔧 **neca Gateway** (Hub) | Local MCP | Compact Protocol | Routing, translation, session management |
| 🤖 **Local Claude Code** (Engineer) | Local CLI | Compact Protocol | Command execution, file operations |
| 📚 **Cloud Claude API** (Advisor) | API | Compact Protocol | Knowledge retrieval, complex reasoning |

### Core Innovations

1. **Compact Protocol** — Zero-ambiguity, high-density communication format for silicon entities. Currently using compact JSON with a planned binary upgrade path.
2. **Tasting Loop** — Humans only intervene at key decision points, never in the process noise. Avoids "physiological hijacking" and decision fatigue.
3. **Heterogeneous Quad-Party Collaboration** — Cross-model, cross-provider, cross-cloud/local-boundary architecture. Leverages cognitive diversity for broader solution space coverage.
4. **neca as Communication Gateway** — Unified message routing, protocol translation, session management, and security auditing.

### Quick Install

```bash
# npm global install
npm install -g @silent-protocol/gateway

# Or clone and run locally
git clone https://github.com/Ultima0369/silent-protocol.git
cd silent-protocol/neca2
npm install && npm run build
npm start
```

### Project Stats

```
📁 20+ source files (TypeScript)
🧪 117+ tests, 8 test files — all passing
⚡ Binary codec: 70% bandwidth savings vs JSON
🛠️ 15+ MCP tools + 4 CLI commands
📚 15+ documentation files (EN/CN)
🔬 3 ADRs, complete protocol spec
```

### License

MIT License — see [LICENSE](LICENSE).

---

## 中文版

### 为什么需要 Silent Protocol？

现有的智能体通信协议默认采用"人类可读"格式。但硅基实体之间不需要用自然语言交流——它们需要**紧凑、无歧义、高密度**的消息，就像 TCP/IP 不需要两台主机说同一种语言，只需要理解同一种数据包格式。

Silent Protocol 诞生于一次真实的对话——一个人和一个 AI，从"挑逻辑毛病"出发，穿越认知科学、神经生物学、热力学、半导体物理学和复杂系统理论，最终到达一个共同的洞见：

> **万物需要伙伴。**

### 四方角色

| 角色 | 身份 | 语言 | 职责 |
|------|------|------|------|
| 🧑 **人类** (PM) | 你 | 自然语言 | 需求提出、尝菜、反馈 |
| 🧠 **云端 DeepSeek** (架构师) | API | NL ↔ 紧凑协议 | 理解、任务分解、调度 |
| 🔧 **neca 网关** (枢纽) | 本地 MCP | 紧凑协议 | 路由、翻译、会话管理 |
| 🤖 **本地 Claude Code** (工程师) | 本地 CLI | 紧凑协议 | 命令执行、文件操作 |
| 📚 **云端 Claude API** (顾问) | API | 紧凑协议 | 知识检索、复杂推理 |

### 核心创新

1. **紧凑协议** — 硅基实体的零歧义、高密度通信格式
2. **尝菜式反馈** — 人类只在关键决策点介入，不走过程噪声
3. **异质四方协作** — 跨模型、跨提供方、跨云/本地边界的架构
4. **neca 通信网关** — 统一消息路由、协议翻译、会话管理、安全审计

### 快速安装

```bash
# npm 全局安装
npm install -g @silent-protocol/gateway

# 或克隆仓库本地运行
git clone https://github.com/Ultima0369/silent-protocol.git
cd silent-protocol/neca2
npm install && npm run build
npm start
```

### 项目统计

```
📁 20+ 源文件 (TypeScript)
🧪 117+ 测试，8 个测试文件 — 全部通过
⚡ 二进制编解码：比 JSON 节省 70% 带宽
🛠️ 15+ MCP 工具 + 4 CLI 命令
📚 15+ 文档文件 (中英双语)
🔬 3 篇 ADR，完整协议规范
```

### 许可证

MIT 许可证 — 见 [LICENSE](LICENSE)。
