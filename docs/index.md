---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Silent Protocol"
  text: "硅基原生通信协议"
  tagline: 四方协作架构 · 紧凑协议 · 跨模型网关
  actions:
    - theme: brand
      text: 快速入门
      link: /quickstart
    - theme: alt
      text: 协议规范
      link: /compact-protocol-spec
    - theme: alt
      text: GitHub
      link: https://github.com/Ultima0369/silent-protocol

features:
  - icon: 🤫
    title: 紧凑协议
    details: 硅基实体间的零歧义、高密度通信格式。当前使用紧凑 JSON，预留二进制升级路径。比自然语言节省 40-70% 带宽。
  - icon: 🔄
    title: 四方协作
    details: 人类 + 云端 AI + 本地网关 + 本地 AI 的异质四元协作架构。跨模型、跨Provider、跨云/本地边界。
  - icon: 🎯
    title: 尝菜式反馈
    details: 人类只在关键决策点介入，不在过程噪声中干预。避免"生理性劫持"和决策疲劳。
  - icon: 🔧
    title: neca 网关
    details: neca（左手）= 40+ 万能工具。neca2（右手）= 紧凑协议核心。通过统一黑板报共享态势感知。
  - icon: 📦
    title: 即装即用
    details: npm install @silent-protocol/gateway，5 分钟集成到 Chatbox。支持 stdio 和 HTTP 双传输。
  - icon: 🌍
    title: 开源生态
    details: MIT 许可证。提供 Python/Go/Rust 第三方实现指南。欢迎社区贡献。
---

## 快速开始

```bash
# 安装 neca2
cd neca2 && npm install && npm run build

# 启动服务器
npm start

# 发送 Hello World
npx tsx src/cli.ts send local_claude exec '{"cmd":"echo \"Hello Silent Protocol!\""}' --callback
```

了解更多：👉 [安装指南](/installation) · [快速入门](/quickstart) · [三方实现](/third-party-implementations)
