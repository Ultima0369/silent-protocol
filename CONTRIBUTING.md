# 贡献指南

> 感谢你考虑为 Silent Protocol 做贡献！
> 本文档指导你如何参与这个项目。

---

## 行为准则

本项目采用[贡献者契约行为准则](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)。
简而言之：**尊重所有参与者，不攻击、不贬低、不骚扰。**

---

## 项目哲学

在提交 PR 之前，请理解 Silent Protocol 与其他项目的区别：

| Silent Protocol 是 | Silent Protocol 不是 |
|-------------------|---------------------|
| 硅基实体之间的原生通信协议 | 又一个 MCP 封装 |
| 人类在顶层尝菜的协作架构 | 全自动 agent 框架 |
| 跨模型、跨供应商、跨云/本地 | 单一供应商生态 |
| 紧凑协议优先 | 自然语言默认 |

**如果你的贡献与上表左列一致，欢迎提交。**

---

## 如何贡献

### 🐛 报告 Bug

1. 在 [Issues](https://github.com/your-org/silent-protocol/issues) 中搜索是否已有相同报告
2. 如果没有，创建新 Issue 并附上：
   - 环境信息（OS、Node 版本、neca 版本）
   - 复现步骤
   - 预期行为和实际行为
   - 日志输出（如有）

### 💡 提出新功能

1. 在 Issues 中描述你的想法
2. 说明它如何符合项目哲学（见上表）
3. 如果可能，附上使用场景的伪代码

### 🔧 提交代码

#### 分支策略

```
main          ← 稳定发布版本
  └─ develop  ← 开发主分支
       ├─ feat/xxx    ← 新功能
       ├─ fix/xxx     ← Bug 修复
       └─ docs/xxx    ← 文档改进
```

#### 开发流程

```bash
# 1. Fork 仓库并克隆到本地
git clone https://github.com/your-username/silent-protocol.git
cd silent-protocol

# 2. 从 develop 创建特性分支
git checkout develop
git checkout -b feat/my-feature

# 3. 安装依赖
npm install

# 4. 开发... 确保通过 lint
npm run lint

# 5. 确保测试通过
npm test

# 6. 提交代码（遵循 Conventional Commits）
git commit -m "feat(protocol): 添加流式响应支持"

# 7. 推送到你的 Fork
git push origin feat/my-feature

# 8. 创建 Pull Request → 目标分支: develop
```

#### 提交信息格式

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

  type: feat | fix | docs | style | refactor | perf | test | chore
  scope: protocol | relay | tools | docs | spec | adr
```

示例：
- `feat(protocol): 添加流式 exec 支持`
- `fix(relay): cloud-claude 超时重试计数错误`
- `docs(adr): 补充 ADR-0004 关于会话持久化`
- `perf(codec): MessagePack 编码器零拷贝优化`

---

## 代码规范

### TypeScript

- 使用 TypeScript 严格模式
- 所有函数必须有类型注解
- 避免 `any`，使用 `unknown` 替代
- 使用 `interface` 而非 `type` 定义对象形状（优先用 interface）

### 命名

| 类别 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `compact-protocol.ts` |
| 类名 | PascalCase | `JsonCodec` |
| 函数名 | camelCase | `encodeMessage()` |
| 常量 | UPPER_SNAKE | `DEFAULT_TIMEOUT` |
| 私有的 | `#` 前缀 | `#pendingSessions` |

### 测试

- 所有新功能必须有单元测试
- 协议相关的修改必须有集成测试
- 测试文件放在 `tests/` 目录，与源文件结构对应

---

## 文档

- 新增功能必须在 `docs/` 或 `spec/` 中同步更新文档
- 协议变更必须更新 `spec/compact-protocol-spec.md`
- 架构变更必须更新 `spec/quad-party-architecture.md`
- 重大决策必须记录 ADR（新增文件或补充现有 ADR）

---

## 审查流程

1. 维护者会在 72 小时内 review
2. CI 必须全部通过
3. 至少 1 个维护者 approve 才能合并
4. 合并到 `develop` 后，由维护者定期合并到 `main`

---

## 成为维护者

持续贡献者可能会被邀请成为维护者。维护者拥有：
- PR 审查和合并权限
- 项目方向讨论的参与权
- 发布版本的决策权
