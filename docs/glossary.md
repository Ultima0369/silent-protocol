# 术语表（Glossary）

> Silent Protocol 中使用的核心概念和术语。
> 按字母排序。

---

## A

### AgentId
紧凑协议中用于标识通信参与者的字符串常量。
标准标识符：`cloud_ds`、`local_claude`、`cloud_claude`、`user`、`neca`。
参见：[紧凑协议规范 · Agent 标识](../spec/compact-protocol-spec.md#22-agent-标识)

## C

### 紧凑协议（Compact Protocol）
硅基实体之间使用的零歧义、高信息密度的通信格式。
当前使用精简 JSON 编码，预留二进制升级路径。
核心特征：预定义消息类型、严格类型约束、低冗余、可路由。
参见：[紧凑协议规范](../spec/compact-protocol-spec.md)

### 尝菜式反馈（Tasting Loop）
人类在四方协作中的参与模式：只在关键节点（需求提出和成果检验）介入，
不参与执行过程中的技术细节。类比：产品经理尝菜，不干预后厨怎么做。
参见：[四方协作架构 · 尝菜式反馈流](../spec/quad-party-architecture.md#32-尝菜式反馈流)

### 传感器精度约束（Sensor Precision Constraint）
所有智能体（无论碳基还是硅基）都受限于自身探测器的精度和带宽。
任何"理解"都只是探测器与世界某部分互动后构建的模型，不是世界本身。
参见：[哲学基座 · 第二公理](../docs/philosophical-foundation.md#二第二公理探测器精度约束)

### 认知即压缩（Cognition as Compression）
人类的一切认知都是从无限复杂的宇宙中进行的有损压缩。
经典逻辑、欧氏几何、自然语言，都是特定条件下的高效近似。
参见：[哲学基座 · 第一公理](../docs/philosophical-foundation.md#一第一公理认知即压缩)

## D

### 代理（Delegate）
将子任务派发给另一个智能体执行的动作。
紧凑协议中通过 `delegate` 消息类型实现。
参见：[紧凑协议规范 · delegate](../spec/compact-protocol-spec.md#35-delegate--派发子任务)

## F

### 翻译官（Translator）
对云端 DeepSeek 角色的比喻。职责：理解人类的自然语言需求，
拆解为结构化子任务，通过紧凑协议派发给执行层。
参见：[四方协作架构 · 2.2 云端 DeepSeek](../spec/quad-party-architecture.md#22-云端-deepseek翻译官)

### 频率差异即隔离（Frequency Difference as Isolation）
不同实体因其运作频率不同（GHz vs ms vs 季节），天然存在通信壁垒。
跨频通信必须有一方主动减速到对方的频率窗口内。
参见：[哲学基座 · 第三公理](../docs/philosophical-foundation.md#三第三公理频率差异即隔离)

## G

### 顾问团（Advisor）
对云端 Claude API 角色的比喻。职责：提供专业知识查询、复杂推理、
代码审查等需要海量知识和高 token 上限的服务。
参见：[四方协作架构 · 2.4 云端 Claude API](../spec/quad-party-architecture.md#24-云端-claude-api顾问团)

## M

### MCP（Model Context Protocol）
Anthropic 推出的模型-工具通信协议。Silent Protocol 在 MCP 基础上构建，
但扩展了 MCP 未覆盖的硅基实体间通信和四方协作模式。

### 网关（Gateway）
对 neca 角色的比喻。所有跨实体通信必经的中枢节点，
负责消息路由、协议转译、会话管理、安全审计。
参见：[四方协作架构 · 2.3 neca 网关](../spec/quad-party-architecture.md#23-neca-网关通信枢纽)

## N

### neca
Silent Protocol 的参考实现网关。提供：
- `protocol/`：紧凑协议编解码和路由
- `relay/`：云端实体中继转发
- `tools/`：MCP 工具接口

### 四方协作（Quad-Party Collaboration）
Silent Protocol 定义的四种角色的协作模式：
人类（产品经理）、云端 DeepSeek（翻译官）、
本地 Claude Code（总工程师）、云端 Claude API（顾问团）。
参见：[四方协作架构](../spec/quad-party-architecture.md)

## P

### 频率窗口（Frequency Window）
一个实体能够可靠发送或接收信号的速率范围。
跨频通信时，发送方必须将信息率调整到接收方的频率窗口内。

## S

### 生理性劫持（Physiological Hijack）
当观点受到威胁时，杏仁核绕过前额叶皮层直接启动"战或逃"反应，
使人无法理性处理信息。Silent Protocol 的"尝菜式反馈"设计
正是为了避免人类陷入生理性劫持状态。

### 四方协作（Quad-Party Collaboration）
见上方 N 条目。

### 散热瓶颈（Heat Dissipation Bottleneck）
地球通过红外辐射向太空排热的速率有限。
任何能量利用活动（包括 AI 计算）的最终废热必须通过这一管道排出。
这是文明发展的终极物理约束之一。

## T

### 总工程师（Engineer）
对本地 Claude Code 角色的比喻。职责：执行命令、读写文件、
修改代码、运行测试——在本地机器上完成具体操作。
参见：[四方协作架构 · 2.3 本地 Claude Code](../spec/quad-party-architecture.md#23-本地-claude-code总工程师)

## Y

### 有损压缩（Lossy Compression）
从无限复杂的宇宙中提取有限信息的过程，必然丢失信息。
所有的模型、定律、自然语言，都是有损压缩的产物。
Silent Protocol 的设计前提之一：接受有损，但在接口处追求无损。
参见：[哲学基座 · 第一公理](../docs/philosophical-foundation.md#一第一公理认知即压缩)

---

## 外部术语

以下术语非 Silent Protocol 专有，但在文档中频繁出现：

| 术语 | 来源 | 在本文档中的含义 |
|------|------|------------------|
| **MCP** | Anthropic | 模型-工具通信协议 |
| **A2A** | Google | Agent-to-Agent 通信标准 |
| **LLM** | 通用 | 大语言模型 |
| **Agent** | AI 领域 | 具有自主性的智能体 |
| **Token** | LLM 领域 | 模型处理的最小文本单位 |
| **RLHF** | AI 训练 | 基于人类反馈的强化学习 |
