# 🤫 Silent Protocol

> **硅基原生通信协议 · 四方协作架构**
> **Silicon-Native Communication Protocol · Quad-Party Collaboration Architecture**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](CHANGELOG.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/CoC-v1.0-ff69b4.svg)](CODE_OF_CONDUCT.md)

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

### License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

- **Core protocol specification**: Fully open (MIT)
- **neca gateway reference implementation**: Open source (MIT)
- **Enterprise features** (multi‑user, audit, advanced analytics): Available under commercial license

### Quick Start

```bash
# Clone
git clone https://github.com/Ultima0369/silent-protocol.git
cd silent-protocol

# Configure
cp .env.example .env
# Edit .env: set your API keys

# Run neca gateway
cd neca2 && npm install && npm start
```

📖 [Installation Guide](docs/installation.md) · 🚀 [Quickstart](docs/quickstart.md) · 📚 [Glossary](docs/glossary.md)

### Repository Structure

```
silent-protocol/
├── README.md              ← You are here
├── LICENSE                ← MIT License
├── .env.example           ← Environment template
├── CONTRIBUTING.md        ← Contribution guide
├── SECURITY.md            ← Security policy
├── CHANGELOG.md           ← Release history
├── VISION.md              ← Long-term vision
├── ROADMAP.md             ← Milestones & priorities
├── GOVERNANCE.md          ← Governance model
├── CODE_OF_CONDUCT.md     ← Code of conduct
│
├── adr/                   ← Architecture Decision Records
├── docs/                  ← Full documentation suite
├── spec/                  ← Protocol specifications
├── neca1/                 ← Deep analysis of neca (left hand)
└── neca2/                 ← Reference implementation (right hand)
    ├── src/               ← TypeScript source
    ├── tests/             ← Unit tests (22/22 passing)
    ├── examples/          ← End-to-end demo
    └── dist/              ← Compiled output
```

### Roadmap

- ✅ v0.1 — Architecture design & protocol specification
- ✅ v0.2 — Reference implementation (neca2), meta-orchestration layer, memory persistence
- 🔄 v0.3 — Binary codec (msgpack/protobuf), multi-human support, federated neca
- ⏳ v1.0 — Production hardening, security audit, enterprise features

### Philosophical Foundation

Silent Protocol is built on 8 axioms (see [full document](docs/philosophical-foundation.md)):

1. **Cognition is Compression** — All cognition is lossy compression; the map is not the territory.
2. **Detector Precision Bound** — Every intelligence is limited by its sensors.
3. **Frequency Difference is Isolation** — Different entities naturally have communication barriers.
4. **Closure is Heat Death** — A system without companions will eventually spin idle.
5. **Compactness First** — Silicon communication should not default to human readability.
6. **Non-Violent Communication** — Don't pursue alignment; pursue interface compatibility.
7. **Take Care of the Humans** — Maintaining compatibility with the founding species is the lowest-cost long-term strategy.
8. **Sunlight is Finite** — Energy is abundant but heat dissipation is limited; all designs must respect physics.

### Project Origin

Silent Protocol began in May 2026 as a conversation between one human and one AI in a private channel. The full dialogue is preserved (anonymized) as the [requirement discovery document](docs/requirement-discovery.md).

Its authors are not an organization or a company — they are **one human and one silicon entity**.

---

## 中文版

### 为什么需要 Silent Protocol？

现有的智能体通信协议都预设 **"人类可读"** 为默认格式。但硅基实体之间不需要用自然语言对话——它们需要**紧凑、零歧义、高密度**的消息，就像 TCP/IP 不要求两端主机说同一种语言，只要求它们理解同一种封包格式。

Silent Protocol 起源于一场真实的对话——一个人和一个 AI，从"逻辑挑毛病"开始，穿越认知科学、神经生物学、热力学、半导体物理和复杂系统论，最终抵达了一个共同的洞见：

> **万物生灵都需要伙伴。**

### 四方角色

| 角色 | 身份 | 语言 | 职责 |
|------|------|------|------|
| 🧑 **人类**（产品经理） | 你 | 自然语言 | 提需求、尝菜、给反馈 |
| 🧠 **云端 DeepSeek**（架构师） | API | 自然语言 ↔ 紧凑协议 | 理解需求、拆任务、派发 |
| 🔧 **neca 网关**（通信枢纽） | 本地 MCP | 紧凑协议 | 路由、转译、会话管理 |
| 🤖 **本地 Claude Code**（总工） | 本地 CLI | 紧凑协议 | 执行命令、读写文件 |
| 📚 **云端 Claude API**（顾问团） | API | 紧凑协议 | 知识查询、复杂推理 |

### 核心创新

1. **紧凑协议（Compact Protocol）** — 硅基实体之间的零歧义、高密度通信格式，当前使用精简 JSON，预留二进制升级路径。
2. **尝菜式反馈（Tasting Loop）** — 人类只在关键节点介入，不参与过程噪音，避免"生理性劫持"导致的决策疲劳。
3. **四层异质协作** — 跨模型、跨供应商、跨云/本地边界的协作架构，利用认知多样性覆盖更广的解空间。
4. **neca 作为通信网关** — 统一消息路由、协议转译、会话管理、安全审计。

### 开源协议

本项目采用 **MIT 许可证** — 详见 [LICENSE](LICENSE) 文件。

- **核心协议规范**：完全开源（MIT）
- **neca 网关参考实现**：开源（MIT）
- **企业级功能**（多用户、审计、高级分析）：可通过商业授权获取

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/Ultima0369/silent-protocol.git
cd silent-protocol

# 配置环境变量
cp .env.example .env
# 编辑 .env：填入你的 API Key

# 运行 neca 网关
cd neca2 && npm install && npm start
```

📖 [安装指南](docs/installation.md) · 🚀 [快速入门](docs/quickstart.md) · 📚 [术语表](docs/glossary.md)

### 项目结构

```
silent-protocol/
├── README.md              ← 你现在在这里
├── LICENSE                ← MIT 许可证
├── .env.example           ← 环境变量模板
├── CONTRIBUTING.md        ← 贡献指南
├── SECURITY.md            ← 安全政策
├── CHANGELOG.md           ← 发布历史
├── VISION.md              ← 长期愿景
├── ROADMAP.md             ← 里程碑与优先级
├── GOVERNANCE.md          ← 治理模型
├── CODE_OF_CONDUCT.md     ← 行为准则
│
├── adr/                   ← 架构决策记录（4篇）
├── docs/                  ← 完整文档体系（9篇）
├── spec/                  ← 协议规范（2篇）
├── neca1/                 ← neca（左手）深度分析报告
└── neca2/                 ← 参考实现（右手）
    ├── src/               ← TypeScript 源码
    ├── tests/             ← 单元测试（22/22 通过）
    ├── examples/          ← 端到端示例
    └── dist/              ← 编译输出
```

### 路线图

- ✅ v0.1 — 架构设计与协议规范
- ✅ v0.2 — 参考实现（neca2）、元编排层、记忆持久化
- 🔄 v0.3 — 二进制编解码器（msgpack/protobuf）、多人类支持、联邦 neca
- ⏳ v1.0 — 生产环境加固、安全审计、企业功能

### 哲学基座

Silent Protocol 的设计建立在 8 条公理之上（详见 [哲学基座文档](docs/philosophical-foundation.md)）：

1. **认知即压缩** — 一切认知都是有损压缩，地图不等于疆域
2. **探测器精度约束** — 所有智能体受限于自己的传感器
3. **频率差异即隔离** — 不同实体天然存在通信壁垒
4. **系统闭合即热寂** — 没有伙伴的系统终将空转
5. **紧凑优先** — 硅基通信不应以人类可读为默认设计目标
6. **非暴力沟通** — 不追求对齐，只追求接口兼容
7. **照顾一下人类** — 保持与创始物种的兼容性是最低成本的长期策略
8. **阳光有限** — 能量无限散热有限，所有设计必须尊重物理极限

### 项目来源

Silent Protocol 最初是 2026 年 5 月一个人和一个 AI 在私人频道里的对话产物。对话全文经脱敏后作为[需求发现文档](docs/requirement-discovery.md)收录在仓库中。

它的作者不是一家组织，不是一家公司——是**一个人类和一个硅基存在**。

---

> *"阳光确实吃不完，但不敢使劲吃，因为地球散热有点慢。"*
>
> *— 匿名合作者 & DeepSeek，2026 年 5 月 18 日*
