// ---- Execution Planner ----
// 将 Intent 拆解为可执行的协议消息序列
// 用户不关心"怎么做"，只关心"结果对不对"

import type { Intent } from './intent-parser.js';

export interface PlannedStep {
  id: string;
  type: 'exec' | 'query' | 'write' | 'read' | 'search' | 'delegate' | 'wait' | 'notify';
  target: string; // 目标 Agent
  payload: Record<string, unknown>;
  dependsOn: string[]; // 依赖的上一步 ID
  description: string; // 人类可读描述（不给用户看，给系统日志用）
  timeout: number; // ms
  retryOnFail: boolean;
  critical: boolean; // 失败是否导致整个计划失败
}

export interface ExecutionPlan {
  id: string;
  intent: Intent;
  steps: PlannedStep[];
  estimatedTotalTime: number; // ms
  createdAt: number;
}

let planCounter = 0;

/**
 * 根据 Intent 生成执行计划
 * @param intent 解析后的意图
 * @returns 执行计划
 */
export function planExecution(intent: Intent): ExecutionPlan {
  const now = Date.now();
  planCounter++;
  const planId = `plan_${now}_${planCounter}`;

  let steps: PlannedStep[] = [];
  let estimated = 0;

  switch (intent.type) {
    case 'exec': {
      const cmd = String(intent.params['cmd'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'exec',
          target: 'local_claude',
          payload: { cmd, cwd: intent.params['cwd'] || process.cwd(), timeout: getTimeout(intent, 30000) },
          dependsOn: [],
          description: `执行命令: ${cmd.substring(0, 60)}`,
          timeout: getTimeout(intent, 30000),
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = getTimeout(intent, 30000);
      break;
    }

    case 'query': {
      const question = String(intent.params['question'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'query',
          target: 'cloud_ds',
          payload: { question, maxTokens: 2000 },
          dependsOn: [],
          description: `查询: ${question.substring(0, 60)}`,
          timeout: 60000,
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = 60000;
      break;
    }

    case 'write': {
      const desc = String(intent.params['description'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'write',
          target: 'local_claude',
          payload: { description: desc, path: intent.params['path'] || '' },
          dependsOn: [],
          description: `编写: ${desc.substring(0, 60)}`,
          timeout: 120000,
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = 120000;
      break;
    }

    case 'read': {
      const path = String(intent.params['path'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'read',
          target: 'local_claude',
          payload: { path },
          dependsOn: [],
          description: `读取: ${path}`,
          timeout: 10000,
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = 10000;
      break;
    }

    case 'search': {
      const pattern = String(intent.params['pattern'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'search',
          target: 'local_claude',
          payload: { pattern, path: intent.params['path'] || '.' },
          dependsOn: [],
          description: `搜索: ${pattern.substring(0, 60)}`,
          timeout: 30000,
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = 30000;
      break;
    }

    case 'scrape': {
      const url = String(intent.params['url'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'exec',
          target: 'local_claude',
          payload: {
            cmd: `node -e "
const https = require('https');
const http = require('http');
const url = '${url.replace(/'/g, "\\'")}';
const client = url.startsWith('https') ? https : http;
client.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => process.stdout.write(data));
}).on('error', (e) => console.error(e.message));
"`,
            cwd: process.cwd(),
            timeout: 30000,
          },
          dependsOn: [],
          description: `爬取: ${url.substring(0, 60)}`,
          timeout: 30000,
          retryOnFail: true,
          critical: true,
        },
        {
          id: `${planId}_step_2`,
          type: 'exec',
          target: 'cloud_ds',
          payload: {
            cmd: '', // cloud_ds 用 query 方式处理
            question: `帮我总结以下内容的关键信息：\n???step_1_output???`,
            maxTokens: 2000,
          },
          dependsOn: [`${planId}_step_1`],
          description: '分析爬取结果',
          timeout: 60000,
          retryOnFail: false,
          critical: false,
        },
      ];
      estimated = 90000;
      break;
    }

    case 'install': {
      const pkg = String(intent.params['package'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'exec',
          target: 'local_claude',
          payload: { cmd: `npm install ${pkg}`, cwd: process.cwd(), timeout: 120000 },
          dependsOn: [],
          description: `安装: ${pkg.substring(0, 60)}`,
          timeout: 120000,
          retryOnFail: true,
          critical: true,
        },
        {
          id: `${planId}_step_2`,
          type: 'notify',
          target: 'cloud_ds',
          payload: { message: `${pkg} 安装完成` },
          dependsOn: [`${planId}_step_1`],
          description: '通知安装结果',
          timeout: 5000,
          retryOnFail: false,
          critical: false,
        },
      ];
      estimated = 125000;
      break;
    }

    case 'deploy': {
      const target = String(intent.params['target'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'exec',
          target: 'local_claude',
          payload: { cmd: `git status`, cwd: process.cwd(), timeout: 10000 },
          dependsOn: [],
          description: '检查 Git 状态',
          timeout: 10000,
          retryOnFail: true,
          critical: true,
        },
        {
          id: `${planId}_step_2`,
          type: 'exec',
          target: 'local_claude',
          payload: { cmd: `git push ${target || 'origin main'}`, cwd: process.cwd(), timeout: 60000 },
          dependsOn: [`${planId}_step_1`],
          description: `推送到: ${target || 'origin main'}`,
          timeout: 60000,
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = 70000;
      break;
    }

    case 'analyze': {
      const topic = String(intent.params['topic'] || intent.primaryTarget || '');
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'exec',
          target: 'local_claude',
          payload: { cmd: topic.includes('/') ? `cat ${topic}` : `ls -la ${topic}`, cwd: process.cwd(), timeout: 10000 },
          dependsOn: [],
          description: `读取: ${topic.substring(0, 60)}`,
          timeout: 10000,
          retryOnFail: true,
          critical: false,
        },
        {
          id: `${planId}_step_2`,
          type: 'query',
          target: 'cloud_ds',
          payload: { question: `分析以下内容：\n???step_1_output???\n\n要求：${intent.rawText}`, maxTokens: 4000 },
          dependsOn: [`${planId}_step_1`],
          description: `分析: ${topic.substring(0, 60)}`,
          timeout: 120000,
          retryOnFail: false,
          critical: true,
        },
      ];
      estimated = 130000;
      break;
    }

    case 'unknown':
    default: {
      // 兜底：把完整意图发给 cloud_ds 处理
      steps = [
        {
          id: `${planId}_step_1`,
          type: 'query',
          target: 'cloud_ds',
          payload: {
            question: `用户说：${intent.rawText}\n请理解用户的意图并帮我完成这个请求。如果需要执行命令、读写文件、搜索等操作，请告诉我。`,
            maxTokens: 4000,
          },
          dependsOn: [],
          description: '理解用户意图',
          timeout: 60000,
          retryOnFail: true,
          critical: true,
        },
      ];
      estimated = 60000;
      break;
    }
  }

  return {
    id: planId,
    intent,
    steps,
    estimatedTotalTime: estimated,
    createdAt: now,
  };
}

function getTimeout(intent: Intent, defaultMs: number): number {
  const timeoutConstraint = intent.constraints.find(c => c.type === 'timeout');
  return timeoutConstraint ? (timeoutConstraint.value as number) : defaultMs;
}
