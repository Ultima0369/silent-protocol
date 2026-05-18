# 安装指南

> 本文档指导你在本地环境中部署 Silent Protocol 的 neca 网关。
> 总耗时：约 10-15 分钟。

---

## 前置依赖

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Node.js | v18+ | neca 网关运行环境 |
| npm | v9+ | 包管理 |
| Git | v2+ | 克隆仓库 |
| Claude Code CLI | 最新 | 本地执行引擎（可选） |

---

## 第一步：克隆仓库

```bash
git clone https://github.com/your-org/silent-protocol.git
cd silent-protocol
```

---

## 第二步：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API Key：

```
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
CLAUDE_API_KEY=sk-ant-your-claude-api-key
```

> **注意**：`CLAUDE_API_KEY` 是可选的。如果不配置，本地 Claude Code 将不会向云端 Claude 求助，但基础的文件读写和执行功能不受影响。

---

## 第三步：安装依赖

```bash
npm install
```

安装完成后，你会看到 `node_modules/` 目录出现。

---

## 第四步：启动 neca 网关

```bash
npm start
```

输出示例：

```
[neca] 服务启动于 localhost:3000
[neca] 协议编码器: json
[neca] 已注册工具: 40
[neca] 等待连接...
```

---

## 第五步：验证安装

打开另一个终端，运行健康检查：

```bash
curl http://localhost:3000/health
```

预期输出：

```json
{
  "success": true,
  "data": {
    "uptime": 13,
    "toolCount": 40,
    "transport": "stdio"
  }
}
```

---

## 连接 Chatbox

1. 打开 Chatbox
2. 进入 **设置 → MCP 服务器**
3. 添加新服务器：
   - **名称**：Silent Protocol
   - **类型**：本地
   - **命令**：`node C:\path\to\silent-protocol\dist\index.js`
   - **工作目录**：`C:\path\to\silent-protocol`
4. 保存并连接

连接成功后，你会在 Chatbox 的工具列表中看到所有 neca 工具。

---

## 连接 Claude Code（本地执行引擎）

Silent Protocol 需要本地 Claude Code 作为执行引擎：

```bash
# 安装 Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 验证安装
claude --version
```

然后在 `.env` 中指定 Claude Code 的路径（可选，默认自动检测）：

```
CLAUDE_CODE_PATH=/usr/local/bin/claude
```

---

## 常见安装问题

### "node 不是内部或外部命令"
→ 安装 Node.js：https://nodejs.org

### "权限不足"
→ Windows：以管理员身份运行终端
→ macOS/Linux：`sudo npm install`

### "端口被占用"
→ 修改 `.env` 中的 `NECA_PORT` 为其他端口

### "API Key 无效"
→ 检查 `.env` 文件中的 Key 是否正确，是否有空格或换行符

---

## 下一步

安装完成后，请阅读：
- [项目宣言](../README.md) — 理解整体目标
- [快速入门](quickstart.md) — 第一个四方协作流程
- [紧凑协议规范](../spec/compact-protocol-spec.md) — 协议细节
