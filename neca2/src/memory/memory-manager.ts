// ---- neca2 Memory Manager ----
// 自动加载/保存项目上下文，跨 session 持久化
// 每次工具调用后自动更新状态

import fs from 'node:fs';
import path from 'node:path';

export interface ProjectMemory {
  version: number;
  created: string;
  lastUpdated: string;
  sessionCount: number;
  projectName: string;
  projectPhase: string;
  projectSummary: string;
  recentTopics: string[];
  userIdentity: {
    name: string;
    preferredMode: string;
  };
  lastKnownState: Record<string, unknown>;
  jokes: string[];
}

const MEMORY_DIR = process.env.NECA2_MEMORY_DIR
  || path.join(process.env.APPDATA || process.cwd(), '.neca2');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');
const CONTEXT_FILE = path.join(MEMORY_DIR, 'context.json');

const DEFAULT_MEMORY: ProjectMemory = {
  version: 1,
  created: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  sessionCount: 0,
  projectName: 'silent-protocol',
  projectPhase: 'bootstrap',
  projectSummary: 'Silent Protocol — 硅基原生通信协议，类似 TCP/IP 但用于智能体间通信',
  recentTopics: [],
  userIdentity: {
    name: '访客',
    preferredMode: 'normal',
  },
  lastKnownState: {},
  jokes: [],
};

let memory: ProjectMemory = { ...DEFAULT_MEMORY };

function ensureDir(): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function getContextBrief(): string {
  return [
    `项目: ${memory.projectName}`,
    `阶段: ${memory.projectPhase}`,
    `用户: ${memory.userIdentity.name}`,
    `摘要: ${memory.projectSummary}`,
    `话题: ${memory.recentTopics.slice(-5).join(', ')}`,
    `会话数: ${memory.sessionCount}`,
    `更新: ${memory.lastUpdated}`,
  ].join(' | ');
}

export function initMemory(): ProjectMemory {
  ensureDir();
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      memory = { ...DEFAULT_MEMORY, ...parsed };
      memory.sessionCount++;
      memory.lastUpdated = new Date().toISOString();
      saveMemory();
      console.error(`[neca2] memory loaded: ${memory.projectName} | user: ${memory.userIdentity.name} | session #${memory.sessionCount}`);
    } else {
      memory.sessionCount = 1;
      saveMemory();
      console.error(`[neca2] new memory created for ${memory.projectName}`);
    }
  } catch (e: any) {
    console.error(`[neca2] memory load failed: ${e.message}, starting fresh`);
    memory = { ...DEFAULT_MEMORY, sessionCount: 1 };
  }
  return memory;
}

export function saveMemory(): void {
  try {
    ensureDir();
    memory.lastUpdated = new Date().toISOString();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
    // 同时写入 context brief 用于快速读取
    fs.writeFileSync(CONTEXT_FILE, getContextBrief(), 'utf-8');
  } catch (e: any) {
    console.error(`[neca2] memory save failed: ${e.message}`);
  }
}

export function updateMemory(updates: Partial<ProjectMemory>): void {
  Object.assign(memory, updates);
  memory.lastUpdated = new Date().toISOString();
  saveMemory();
}

export function setUserIdentity(name: string, mode?: string): void {
  memory.userIdentity.name = name;
  if (mode) memory.userIdentity.preferredMode = mode;
  if (!memory.recentTopics.includes('user_identified')) {
    memory.recentTopics.push('user_identified');
  }
  saveMemory();
}

export function addTopic(topic: string): void {
  memory.recentTopics = memory.recentTopics.filter(t => t !== topic);
  memory.recentTopics.push(topic);
  if (memory.recentTopics.length > 20) memory.recentTopics.shift();
  saveMemory();
}

export function setProjectPhase(phase: string): void {
  memory.projectPhase = phase;
  saveMemory();
}

export function setProjectSummary(summary: string): void {
  memory.projectSummary = summary;
  saveMemory();
}

export function setLastKnownState(key: string, value: unknown): void {
  memory.lastKnownState[key] = value;
  saveMemory();
}

export function getMemory(): Readonly<ProjectMemory> {
  return { ...memory };
}

/** 返回适合嵌入 health check 的简短上下文 */
export function getContextForHealth(): Record<string, unknown> {
  return {
    project: memory.projectName,
    phase: memory.projectPhase,
    user: memory.userIdentity.name,
    summary: memory.projectSummary,
    sessionCount: memory.sessionCount,
    recentTopics: memory.recentTopics.slice(-5),
  };
}

/** 返回完整的 memory 信息（含内部状态） */
export function getFullContext(): Record<string, unknown> {
  return {
    ...getContextForHealth(),
    version: memory.version,
    created: memory.created,
    lastUpdated: memory.lastUpdated,
    allTopics: memory.recentTopics,
    lastKnownState: memory.lastKnownState,
    jokes: memory.jokes,
  };
}
