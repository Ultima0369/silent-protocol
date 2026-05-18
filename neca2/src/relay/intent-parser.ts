// ---- Intent Parser ----
// 将自然语言意图解析为结构化的 Intent 对象
// 碳基→硅基：你说"要什么"，我拆成"怎么做"

export interface Intent {
  type: IntentType;
  primaryTarget: string;
  params: Record<string, unknown>;
  constraints: IntentConstraint[];
  confidence: number; // 0-1
  rawText: string;
}

export type IntentType =
  | 'exec'        // 执行命令/代码
  | 'query'       // 查询信息/知识
  | 'write'       // 写文件/代码
  | 'read'        // 读文件/目录
  | 'search'      // 搜索内容
  | 'scrape'      // 爬取网页/论文
  | 'install'     // 安装依赖/工具
  | 'deploy'      // 部署/发布
  | 'analyze'     // 分析/总结
  | 'unknown';

export interface IntentConstraint {
  type: 'timeout' | 'format' | 'scope' | 'quality' | 'other';
  value: unknown;
  description: string;
}

// 常见意图的模式匹配表（不依赖 LLM）
// 注意：匹配顺序很重要！更具体的模式应排在前面
const INTENT_PATTERNS: Array<{
  type: IntentType;
  patterns: RegExp[];
  extractParams: (match: RegExpMatchArray) => Record<string, unknown>;
}> = [
  {
    type: 'exec',
    patterns: [
      /(?:帮我)?(?:执行|运行|跑|执行命令|run|execute|启动)\s*(.+)/i,
      /(?:npm|node|python|git|docker|npx|yarn|pnpm)\s+.+/i,
      /^(?:运行|启动|打开)\s+(.+)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ cmd: (m[1] || m[2] || '').trim() }),
  },
  {
    type: 'search',
    patterns: [
      /(?:帮我)?(?:搜索|查找|搜一下|在.+(?:找|搜索)|grep|search|find|检索)\s*(.+)/i,
      /^(?:搜索|查找|检索)\s+(.+?)(?:内容|文件|代码|关键词)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ pattern: (m[1] || '').trim() }),
  },
  {
    type: 'query',
    patterns: [
      // 标准 query 模式（英文/带空格）
      /(?:帮我)?(?:查|查询|找|search|find|query|问|请问)\s+(.+)/i,
      /^(?:what|how|why|when|where|who)\s+(.+)/i,
      // 中文无空格查询模式
      /(?:帮我)?查(?:一下|一?下)?(?:什么|啥)?是?(.+)/,
      /(?:帮我)?(?:请问|问问|问一下)\s*(.+)/,
      // 什么是/怎么/如何/为什么 开头
      /^(?:什么是|怎么|如何|为什么|介绍一下)\s*(.+)/,
      // ...是什么 结尾
      /(.+)(?:是什么|是什么意思|怎么用|如何实现|怎么做)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ question: (m[1] || m[2] || '').trim() }),
  },
  {
    type: 'write',
    patterns: [
      /(?:帮我)?(?:写|创建|新建|生成|create|write|make|generate|实现|编写)\s*(?:一[个份])?(?:文件|脚本|代码|函数|类|模块)?\s*(.+)/i,
      /^(?:写|创建)一[个份]\s*(.+?)(?:文件|脚本|代码)/,
      /(?:帮我)?实现\s*(.+?)(?:功能|模块|接口)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ description: (m[1] || m[2] || '').trim() }),
  },
  {
    type: 'read',
    patterns: [
      /(?:帮我)?(?:读|看|打开|查看|show|cat|read|view|显示)\s*(.+)/i,
      /^(?:查看|打开|显示)\s+(.+?)(?:文件|内容|配置)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ path: (m[1] || '').trim() }),
  },
  {
    type: 'scrape',
    patterns: [
      /(?:帮我)?(?:爬|爬取|下载|抓取|scrape|crawl|fetch|采集)\s*(.+?)(?:论文|数据|网页|网站|内容)/i,
      /^(?:爬|采集|抓取)\s+(.+?)(?:网站|网页|页面|数据)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ url: (m[1] || '').trim() }),
  },
  {
    type: 'install',
    patterns: [
      /(?:帮我)?(?:安装|装|下载|install|setup|配置|搭建)\s*(.+)/i,
      /^(?:安装|装|配置)\s+(.+?)(?:工具|依赖|库|包|环境)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ package: (m[1] || m[2] || '').trim() }),
  },
  {
    type: 'deploy',
    patterns: [
      /(?:帮我)?(?:部署|发布|上线|deploy|publish|release|推送)\s*(.+)/i,
      /^(?:发布|部署|上线)\s+(.+)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ target: (m[1] || m[2] || '').trim() }),
  },
  {
    type: 'analyze',
    patterns: [
      /(?:帮我)?(?:分析|总结|总结一下|概括|analyze|summarize|review|评估|对比|比较)\s*(.+)/i,
      /^(?:分析|总结|概括|归纳)\s+(.+)/,
    ],
    extractParams: (m: RegExpMatchArray) => ({ topic: (m[1] || m[2] || '').trim() }),
  },
];

// 约束提取
const CONSTRAINT_PATTERNS: Array<{
  type: IntentConstraint['type'];
  pattern: RegExp;
  extractValue: (m: RegExpMatchArray) => unknown;
}> = [
  {
    type: 'timeout',
    pattern: /在?(\d+)\s*(秒|分钟|小时|s|min|h)(?:\s*内|\s*超时)?/i,
    extractValue: (m: RegExpMatchArray) => parseInt(m[1]) * (
      m[2].startsWith('秒') || m[2] === 's' ? 1000
      : m[2].startsWith('分') || m[2] === 'min' ? 60000
      : 3600000
    ),
  },
  {
    type: 'format',
    pattern: /(?:输出|结果|格式|format)\s*(?:为|用|成)?\s*(json|yaml|xml|markdown|md|csv|text|html)/i,
    extractValue: (m: RegExpMatchArray) => m[1].toLowerCase(),
  },
  {
    type: 'scope',
    pattern: /(?:只|仅|限定|在|range|scope)\s*(.+?)(?:范围内|里|中|内)/i,
    extractValue: (m: RegExpMatchArray) => m[1].trim(),
  },
  {
    type: 'quality',
    pattern: /(?:高质量|生产级|优化|high.?quality|production|robust)/i,
    extractValue: () => 'high',
  },
];

/**
 * 解析自然语言意图
 * @param text 用户原始请求
 * @returns 结构化 Intent
 */
export function parseIntent(text: string): Intent {
  const trimmed = text.trim();

  // 遍历模式表匹配
  for (const entry of INTENT_PATTERNS) {
    for (const pattern of entry.patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const params = entry.extractParams(match);
        const extracted = (params['cmd'] || params['question'] || params['description'] || params['path'] || params['pattern'] || params['url'] || params['package'] || params['target'] || params['topic'] || '') as string;

        // 提取约束
        const constraints: IntentConstraint[] = [];
        for (const cp of CONSTRAINT_PATTERNS) {
          const cm = trimmed.match(cp.pattern);
          if (cm) {
            constraints.push({
              type: cp.type,
              value: cp.extractValue(cm),
              description: `${cp.type}: ${cm[0]}`,
            });
          }
        }

        return {
          type: entry.type,
          primaryTarget: extracted,
          params,
          constraints,
          confidence: 0.85 + Math.random() * 0.15,
          rawText: trimmed,
        };
      }
    }
  }

  // 兜底：返回 unknown 类型
  return {
    type: 'unknown',
    primaryTarget: trimmed,
    params: { text: trimmed },
    constraints: [],
    confidence: 0.3,
    rawText: trimmed,
  };
}

/**
 * 判断意图是否需要用户进一步澄清
 */
export function needsClarification(intent: Intent): string | null {
  if (intent.confidence < 0.4) {
    return `我不太确定你想做什么（置信度 ${(intent.confidence * 100).toFixed(0)}%）。能不能说详细一点？`;
  }
  if (intent.type === 'unknown') {
    return '我没明白你要干什么。可以试试：\n- "帮我爬某方面的论文"\n- "帮我查一下这个文件"\n- "帮我安装 Python"';
  }
  if (intent.type === 'scrape' && !intent.params['url']) {
    return '爬取需要目标地址。你要爬哪个网站或哪方面的论文？给我个关键词或 URL。';
  }
  if (intent.type === 'exec' && !intent.params['cmd']) {
    return '执行什么命令？请告诉我具体的指令。';
  }
  return null;
}
