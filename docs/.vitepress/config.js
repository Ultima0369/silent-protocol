// ---- Silent Protocol 文档站 VitePress 配置 ----
// 运行: npx vitepress dev docs
// 构建: npx vitepress build docs

import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Silent Protocol',
  description: '硅基原生通信协议 · 四方协作架构',
  lang: 'zh-CN',

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#1a1a2e' }],
  ],

  themeConfig: {
    logo: '/favicon.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '规范', link: '/compact-protocol-spec' },
      { text: '架构', link: '/quad-party-architecture' },
      { text: '指南', link: '/installation' },
      { text: '实现', link: '/third-party-implementations' },
      { text: 'GitHub', link: 'https://github.com/Ultima0369/silent-protocol' },
    ],

    sidebar: [
      {
        text: '项目介绍',
        items: [
          { text: 'Silent Protocol', link: '/' },
          { text: 'VISION.md', link: '/vision' },
          { text: '路线图', link: '/roadmap' },
          { text: '更新日志', link: '/changelog' },
        ],
      },
      {
        text: '协议规范',
        items: [
          { text: '紧凑协议规范', link: '/compact-protocol-spec' },
          { text: '四方协作架构', link: '/quad-party-architecture' },
          { text: '架构决策记录', link: '/adr' },
        ],
      },
      {
        text: '指南',
        items: [
          { text: '安装指南', link: '/installation' },
          { text: '快速入门', link: '/quickstart' },
          { text: '术语表', link: '/glossary' },
          { text: '错误处理', link: '/error-handling' },
          { text: '混合部署', link: '/hybrid-deployment' },
        ],
      },
      {
        text: '实现',
        items: [
          { text: '第三方实现指南', link: '/third-party-implementations' },
          { text: 'neca 深度分析', link: '/deep-analysis' },
        ],
      },
      {
        text: '哲学背景',
        items: [
          { text: '哲学基座', link: '/philosophical-foundation' },
          { text: '科学背景', link: '/scientific-background' },
          { text: '需求溯源', link: '/requirement-discovery' },
        ],
      },
      {
        text: '社区',
        items: [
          { text: '贡献指南', link: '/contributing' },
          { text: '行为准则', link: '/code-of-conduct' },
          { text: '治理模型', link: '/governance' },
          { text: '安全策略', link: '/security' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Ultima0369/silent-protocol' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present Ultima0369',
    },
  },

  // 从 docs/ 目录读取 .md 文件
  srcDir: '.',
  // 输出到 neca2/docs-site/
  outDir: '../neca2/docs-site',
})
