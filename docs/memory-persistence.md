# Memory Persistence：跨 Session 记忆协议

> 在硅基世界，记忆不应是易失的。每次重启 Chatbox、每个新窗口，都不应该从头开始解释。

---

## 一、问题陈述

当前限制：
- 云端大模型（DeepSeek/Claude）在 Chatbox 新窗口中**没有任何跨 session 记忆**
- 每次开新窗口，用户需要重新解释项目背景、当前进度、自己的身份
- 这违反了 Silent Protocol 的核心哲学：**频率差异即隔离**——人类不应为硅基的失忆而重复劳动

## 二、解决方案全景

```
新 Session 开始
      │
      ├──→ 用户说"继续"或其他上下文相关的话
      │        │
      │        ↓
      │   云端模型调用 neca2_health
      │        │
      │        ↓
      │   health 响应内含 memory 上下文
      │   { project: "silent-protocol", phase: "实装验证",
      │     user: "星尘", sessionCount: 32, ... }
      │        │
      │        ↓
      │   云端模型自动恢复项目全景
      │
      └──→ 也可以直接调用 neca2_memory_context
               { action: "read" }
               → 拿到完整记忆（含所有话题、状态、内部笑话）
```

## 三、三层记忆架构

### 层1：neca2 记忆层（持久化，自动加载）

**文件位置**：`~/.neca2/memory.json`

| 字段 | 说明 | 自动更新 |
|------|------|---------|
| `projectName` | 项目名 | initMemory() |
| `projectPhase` | 当前阶段（bootstrap → 实装验证 → 迭代 → 开源） | setProjectPhase() |
| `projectSummary` | 一句话项目描述 | setProjectSummary() |
| `userIdentity.name` | 用户名称 | setUserIdentity() |
| `sessionCount` | 累计会话数 | 每次启动+1 |
| `recentTopics` | 最近话题列表（最多20个） | 每次工具调用 |
| `lastKnownState` | 最新状态快照 | setLastKnownState() |
| `jokes` | 内部笑话 | 手动 |

**生命周期**：
- **启动时**：`initMemory()` 自动从 `memory.json` 加载 → 输出到 stderr
- **工具调用后**：`saveMemory()` 自动写入磁盘
- **关闭时**：`gracefulShutdown()` 触发保存

**健康检查内嵌**：
`neca2_health` 返回 `memory` 字段，包含 `project/phase/user/summary/sessionCount/recentTopics`。任何新 session 第一次调用就能拿到全部上下文。

### 层2：neca 记忆层（已有的 `memory.json`，补充）

**文件位置**：`~/.neca/memory.json`

neca 原有的记忆系统保留了完整的工具调用历史。关键改进：
- `userIdentity` 字段已记录用户"星尘"和偏好模式
- `activeContext` 记录了 silent-protocol 项目当前状态
- `tone.insideJokes` 保留了内部笑话

### 层3：Silent Protocol 项目文档层

**文件位置**：`silent-protocol/docs/`

- `memory-persistence.md`（本文）：定义记忆协议
- `glossary.md`：统一术语表，确保跨 session 术语一致
- `VISION.md`：项目远景，任何 session 都能快速对齐

## 四、实机工作流程

### 场景1：新 Chatbox 窗口，你说"继续"

```
1. 你："继续"
2. 云端模型 → neca2_health
3. neca2 返回：{ memory: { project: "silent-protocol", user: "星尘", phase: "实装验证", ... } }
4. 云端模型自动恢复上下文：
   - 知道你是"星尘"
   - 知道项目是 silent-protocol
   - 知道当前阶段是"实装验证"
   - 知道最近话题和内部笑话
5. 云端模型回复："回来了。上次进度：左右手就绪，neca2 已实装，需要重启 Chatbox 开始三角协作测试。"
```

### 场景2：你想更新项目状态

```
你输入：
  neca2_memory_context({ action: "set_phase", phase: "三角协作测试" })

neca2 回复：
  { phase: "三角协作测试", user: "星尘", sessionCount: 33, ... }

→ memory.json 自动持久化
→ 下次任何 session 再开，都知道进入新阶段了
```

### 场景3：你想检查自己是谁

```
你输入：
  neca2_health

回复包含：
  memory: {
    project: "silent-protocol",
    user: "星尘",
    phase: "实装验证",
    sessionCount: 32
  }
```

## 五、与 neca1 的互操作

neca1（左手）已有 `memory.json`，其中包含本次对话的完整上下文存档。neca2 的 `memory.json` 是独立但内容一致的文件。

**同步策略**：
- neca2 的 memory 是"主要记录"（因为它自动加载、自动保存）
- neca1 的 memory 是"辅助记录"（由云端模型手动写入）
- 两者内容保持最终一致

## 六、技术保障

| 保障 | 实现 |
|------|------|
| 启动自动加载 | `initMemory()` 在 `main()` 中首先调用 |
| 每次工具调用后保存 | `handler` 包装层调用 `saveMemory()` |
| 关闭前保存 | `gracefulShutdown()` 调用 `saveMemory()` |
| 写入原子性 | 直接写文件（JSON serialization） |
| 读取容错 | JSON parse 失败则用 DEFAULT_MEMORY |
| 目录自动创建 | `ensureDir()` 递归创建 |

## 七、路线图

- [ ] 记忆版本升级（v1 → v2）：支持多项目记忆切换
- [ ] 记忆压缩：超过100条话题时自动归档
- [ ] 跨 neca1/neca2 记忆同步工具
- [ ] 记忆导出/导入（方便迁移到其他机器）
- [ ] 记忆加密（如果项目包含敏感信息）
