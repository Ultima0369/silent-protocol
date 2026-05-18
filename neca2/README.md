# neca2 — Silent Protocol 紧凑协议参考实现

## 与 neca 的关系

```
neca（左手）: 已在生产运行，40+ 工具，功能丰富
neca2（右手）: 紧凑协议的干净参考实现，聚焦协议核心
```

**neca2 不试图替代 neca**，而是作为它的互补：
- neca 是"万能工具箱"（文件系统、Shell、VS Code、Claude 编排）
- neca2 是"协议核心"（紧凑协议编解码、会话持久化、多模型中继）

通过 Chatbox 同时连接 neca + neca2，可以实现"左手右手互优化"。

## 架构

```
src/
├── index.ts               # MCP Server 入口
├── tools.ts               # MCP 工具定义（neca2_send/poll/pending/...）
├── protocol/
│   ├── types.ts           # 完整消息类型定义（13 种）
│   └── codec.ts           # Codec 接口 + JsonCodec 实现
└── relay/
    ├── session.ts         # 持久化会话管理器（内存 + 磁盘）
    ├── router.ts          # 消息路由器（5 种目标）
    └── http-relay.ts      # 多模型中继（Claude + DeepSeek）
```

## 目录全景

```
neca2/
├── src/                      # 源码
├── dist/                     # 编译产物
├── examples/
│   └── e2e-demo/             # 端到端示例：消息构造→编码→解码
│       ├── send-msg.ts       #   演示脚本
│       └── README.md         #   说明文档
├── tests/
│   ├── protocol.test.ts      # 协议编解码单元测试（含所有消息类型）
│   └── session.test.ts       # 会话管理单元测试（含持久化）
├── docs/
│   └── improvements.md       # 7 条深度改进建议与路线图
├── package.json
├── tsconfig.json
└── README.md                 # 本文件
```

## 启动

```bash
npm install
npm run build
npm start
```

## 运行测试

```bash
npx vitest run tests/
```

## 运行示例

```bash
npx ts-node examples/e2e-demo/send-msg.ts
```

## Chatbox 配置

1. 设置 → MCP 服务器 → 添加新服务器
2. 名称：neca2
3. 类型：本地
4. 命令：`node C:\path\to\neca2\dist\index.js`
5. 工作目录：`C:\path\to\neca2`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| ANTHROPIC_API_KEY | - | Claude API Key |
| DEEPSEEK_API_KEY | - | DeepSeek API Key |
| NECA2_DEFAULT_RELAY | claude | 默认中继服务 |
| NECA2_RELAY_MODEL | claude-sonnet-4 | Claude 模型名 |
| NECA2_RELAY_DS_MODEL | deepseek-chat | DeepSeek 模型名 |
| NECA2_RELAY_TIMEOUT | 60000 | API 超时(ms) |
