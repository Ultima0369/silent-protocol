// ---- Safety Guard ----
// 安全防护层：防翻车三件套
// 1. 残余进程检查 — 执行前扫一遍有没有锁文件/残留进程
// 2. 文件目录验证 — 写文件前确认路径存在，不存在则创建
// 3. 大文件分块 + 长任务超时 — 防止一次干太多炸了

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { logger } from './logger.js';

// ---- Safety Guard ----
// 安全防护层：防翻车三件套 + exec 安全白名单
// 1. exec 安全白名单 + 注入防护
// 2. 残余进程检查 — 执行前扫一遍有没有锁文件/残留进程
// 3. 文件目录验证 — 写文件前确认路径存在，不存在则创建
// 4. 大文件分块 + 长任务超时 — 防止一次干太多炸了

// ============================================================
// 0. exec 安全白名单 + 注入防护
// ============================================================

export interface ExecSafetyConfig {
  whitelistEnabled: boolean;
  allowedCommands: string[];
  allowedChars: RegExp;
  maxCmdLength: number;
  forbiddenPatterns: RegExp[];
}

const DEFAULT_EXEC_CONFIG: ExecSafetyConfig = {
  whitelistEnabled: true,
  allowedCommands: [
    'npm', 'node', 'npx', 'tsc', 'vitest', 'jest', 'mocha',
    'git', 'curl', 'wget', 'ping', 'ssh', 'scp', 'rsync',
    'cat', 'grep', 'find', 'ls', 'dir', 'echo', 'head', 'tail', 'sort', 'wc',
    'python', 'python3', 'pip', 'pip3',
    'go', 'rustc', 'cargo',
    'docker', 'docker-compose',
    'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod', 'chown',
    'tar', 'gzip', 'zip', 'unzip',
    'ps', 'top', 'df', 'du', 'free', 'uname', 'whoami',
    'pnpm', 'yarn', 'bun',
  ],
  allowedChars: /^[\w\-./\\@: =,;'"<>()&|!%]+$/,
  maxCmdLength: 4096,
  forbiddenPatterns: [
    /;\s*[a-z]/i,
    /\$\s*\(/,
    /`[^`]+`/,
    /\|\s*\|/,
    /&&\s*[a-z]/i,
    />\s*\//,
    /2>\s*\//,
  ],
};

let execConfig: ExecSafetyConfig = { ...DEFAULT_EXEC_CONFIG };

export function setExecSafetyConfig(config: Partial<ExecSafetyConfig>): void {
  execConfig = { ...execConfig, ...config };
}

export function checkExecSafety(cmd: string): { allowed: boolean; reason?: string } {
  if (!cmd || cmd.trim().length === 0) return { allowed: false, reason: '命令不能为空' };
  if (cmd.length > execConfig.maxCmdLength) {
    return { allowed: false, reason: `命令过长 (${cmd.length} > ${execConfig.maxCmdLength})` };
  }
  if (execConfig.whitelistEnabled) {
    const firstToken = cmd.trim().split(/\s+/)[0].toLowerCase();
    const allowed = execConfig.allowedCommands.some(ac => {
      if (ac.includes('*')) {
        return new RegExp('^' + ac.replace(/\*/g, '.*') + '$', 'i').test(firstToken);
      }
      return firstToken === ac.toLowerCase() || firstToken.startsWith(ac.toLowerCase() + '.');
    });
    if (!allowed) return { allowed: false, reason: `命令 "${firstToken}" 不在白名单中` };
  }
  for (const pattern of execConfig.forbiddenPatterns) {
    if (pattern.test(cmd)) return { allowed: false, reason: `检测到禁止模式: ${pattern}` };
  }
  if (!execConfig.allowedChars.test(cmd)) {
    const badChars = [...new Set(cmd.split('').filter(c => !execConfig.allowedChars.test(c)))];
    return { allowed: false, reason: `包含不允许的字符: ${badChars.slice(0, 5).map(c => "'" + c + "'").join(', ')}` };
  }
  return { allowed: true };
}

// ============================================================
// 1. 残余进程检查
// ============================================================

export interface ResidualCheckResult {
  hasResidual: boolean;
  pidFiles: string[];
  lockFiles: string[];
  staleSessions: number;
  warnings: string[];
}

const PID_FILE = process.platform === 'win32'
  ? (process.env.APPDATA || process.cwd()) + '/neca2.pid'
  : '/tmp/neca2.pid';

const LOCK_PATTERNS = [
  '*.lock',
  '*.pid',
  '.neca2_*',
  'neca2.pid',
];

/**
 * 检查是否有残余进程/锁文件
 */
export function checkResidualProcesses(): ResidualCheckResult {
  const result: ResidualCheckResult = {
    hasResidual: false,
    pidFiles: [],
    lockFiles: [],
    staleSessions: 0,
    warnings: [],
  };

  // 检查 PID 文件
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
      // 检查进程是否存活
      try {
        if (process.platform === 'win32') {
          execSync(`tasklist /FI "PID eq ${pid}" 2>nul`, { timeout: 3000, windowsHide: true });
        } else {
          process.kill(pid, 0); // 信号 0 = 仅检查存在性
        }
        result.pidFiles.push(PID_FILE);
        result.warnings.push(`PID 文件存在且进程 ${pid} 仍在运行`);
        result.hasResidual = true;
      } catch {
        // 进程不存在，PID 文件是遗留的
        result.warnings.push(`PID 文件存在但进程 ${pid} 已不存在（可清理）`);
        result.pidFiles.push(PID_FILE);
      }
    } catch {
      // PID 文件损坏
      result.warnings.push('PID 文件损坏');
      result.pidFiles.push(PID_FILE);
    }
  }

  // 检查锁文件
  const lockDirs = [
    process.cwd(),
    process.env.TEMP || '/tmp',
    process.env.APPDATA || '',
  ].filter(Boolean);

  for (const dir of lockDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.lock') || file.endsWith('.pid') || file.startsWith('.neca2_')) {
          const fullPath = path.join(dir, file);
          const stats = fs.statSync(fullPath);
          // 超过 1 小时的锁文件可能是遗留的
          if (Date.now() - stats.mtimeMs > 3600000) {
            result.lockFiles.push(fullPath);
            result.warnings.push(`遗留锁文件: ${file} (${Math.round((Date.now() - stats.mtimeMs) / 60000)}分钟前)`);
            result.hasResidual = true;
          }
        }
      }
    } catch { /* 跳过无法读取的目录 */ }
  }

  return result;
}

/**
 * 清理残余文件
 */
export function cleanResiduals(): { cleaned: number; errors: string[] } {
  const result = { cleaned: 0, errors: [] as string[] };
  const check = checkResidualProcesses();

  // 清理遗留 PID 文件（进程已不存在的）
  for (const pidFile of check.pidFiles) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
      try {
        if (process.platform === 'win32') {
          execSync(`tasklist /FI "PID eq ${pid}" 2>nul`, { timeout: 3000, windowsHide: true });
          // 进程还在，不删
          continue;
        } else {
          process.kill(pid, 0);
          continue; // 进程还在
        }
      } catch {
        // 进程不在，删除
        fs.unlinkSync(pidFile);
        result.cleaned++;
      }
    } catch { /* 跳过 */ }
  }

  // 清理遗留锁文件
  for (const lockFile of check.lockFiles) {
    try {
      fs.unlinkSync(lockFile);
      result.cleaned++;
    } catch (e: any) {
      result.errors.push(`清理失败: ${lockFile} — ${e.message}`);
    }
  }

  if (result.cleaned > 0) {
    logger.info('Cleaned residual files', { count: result.cleaned }, { module: 'safety' });
  }

  return result;
}

// ============================================================
// 2. 文件目录验证
// ============================================================

export interface PathValidationResult {
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  writable: boolean;
  readable: boolean;
  size: number;
  permissions: string;
  warnings: string[];
}

/**
 * 验证路径是否存在/可读写
 */
export function validatePath(targetPath: string): PathValidationResult {
  const result: PathValidationResult = {
    valid: true,
    exists: false,
    isDirectory: false,
    isFile: false,
    writable: false,
    readable: false,
    size: 0,
    permissions: '',
    warnings: [],
  };

  try {
    const resolved = path.resolve(targetPath);
    result.exists = fs.existsSync(resolved);

    if (result.exists) {
      const stats = fs.statSync(resolved);
      result.isDirectory = stats.isDirectory();
      result.isFile = stats.isFile();
      result.size = stats.size;

      // 检查权限
      try {
        if (result.isFile) {
          fs.accessSync(resolved, fs.constants.R_OK);
          result.readable = true;
          fs.accessSync(resolved, fs.constants.W_OK);
          result.writable = true;
        } else if (result.isDirectory) {
          fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK);
          result.readable = true;
          // 尝试创建临时文件检查写权限
          const testFile = path.join(resolved, '.neca2_write_test');
          fs.writeFileSync(testFile, '');
          fs.unlinkSync(testFile);
          result.writable = true;
        }
      } catch {
        result.warnings.push('权限不足');
      }

      // 权限字符串
      result.permissions = (stats.mode & 0o777).toString(8);
    } else {
      // 路径不存在，检查父目录
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        try {
          fs.accessSync(parent, fs.constants.W_OK);
          result.writable = true; // 可以在父目录创建
        } catch {
          result.warnings.push('父目录不可写');
        }
      } else {
        result.warnings.push('父目录也不存在');
      }
    }
  } catch (e: any) {
    result.valid = false;
    result.warnings.push(`验证异常: ${e.message}`);
  }

  return result;
}

/**
 * 确保目录存在（递归创建）
 */
export function ensureDirectory(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch (e: any) {
    logger.error('Failed to create directory', { path: dirPath, error: e.message }, { module: 'safety' });
    return false;
  }
}

// ============================================================
// 3. 大文件分块 + 长任务超时
// ============================================================

export const CHUNK_SIZE = 64 * 1024; // 64KB 每块
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB 单文件上限
export const DEFAULT_TASK_TIMEOUT = 5 * 60 * 1000; // 5 分钟
export const LONG_TASK_THRESHOLD = 30 * 1000; // 30 秒视为长任务

export interface ChunkResult {
  chunks: number;
  chunkSize: number;
  totalSize: number;
  warnings: string[];
}

/**
 * 检查文件大小并建议分块策略
 */
export function analyzeFileForChunking(content: string): ChunkResult {
  const totalSize = Buffer.byteLength(content, 'utf-8');
  const result: ChunkResult = {
    chunks: 1,
    chunkSize: totalSize,
    totalSize,
    warnings: [],
  };

  if (totalSize > MAX_FILE_SIZE) {
    result.chunks = Math.ceil(totalSize / CHUNK_SIZE);
    result.chunkSize = CHUNK_SIZE;
    result.warnings.push(
      `文件过大 (${formatSize(totalSize)})，建议分 ${result.chunks} 块写入`
    );
  }

  if (totalSize > 1024 * 1024) {
    result.warnings.push(`文件超过 1MB (${formatSize(totalSize)})，注意内存占用`);
  }

  return result;
}

/**
 * 分块写入大文件
 */
export function writeFileInChunks(
  filePath: string,
  content: string,
  onProgress?: (written: number, total: number) => void
): { success: boolean; bytesWritten: number; error?: string } {
  const totalBytes = Buffer.byteLength(content, 'utf-8');
  
  if (totalBytes <= MAX_FILE_SIZE) {
    // 小文件直接写
    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, bytesWritten: totalBytes };
    } catch (e: any) {
      return { success: false, bytesWritten: 0, error: e.message };
    }
  }

  // 大文件分块写
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // 先写临时文件，完成后再 rename
    const tmpPath = filePath + '.neca2_chunking';
    const fd = fs.openSync(tmpPath, 'w');

    let written = 0;
    const buffer = Buffer.from(content, 'utf-8');

    while (written < totalBytes) {
      const chunkEnd = Math.min(written + CHUNK_SIZE, totalBytes);
      const chunk = buffer.slice(written, chunkEnd);
      fs.writeSync(fd, chunk, 0, chunk.length, written);
      written += chunk.length;
      onProgress?.(written, totalBytes);
    }

    fs.closeSync(fd);
    fs.renameSync(tmpPath, filePath);

    return { success: true, bytesWritten: written };
  } catch (e: any) {
    // 清理残片
    try { fs.unlinkSync(filePath + '.neca2_chunking'); } catch {}
    return { success: false, bytesWritten: 0, error: e.message };
  }
}

/**
 * 带超时的异步任务包装器
 */
export async function withTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number = DEFAULT_TASK_TIMEOUT,
  taskName: string = 'unnamed'
): Promise<T> {
  const timer = setTimeout(() => {
    logger.warn('Task timeout', { task: taskName, timeout: timeoutMs }, { module: 'safety' });
  }, timeoutMs);

  try {
    const result = await Promise.race([
      task(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`任务超时 (${formatTime(timeoutMs)})`)), timeoutMs)
      ),
    ]);
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ============================================================
// 4. 全量安全检查
// ============================================================

export interface FullSafetyReport {
  residual: ResidualCheckResult;
  cwd: PathValidationResult;
  tempDir: PathValidationResult;
  warnings: string[];
  timestamp: number;
}

/**
 * 执行全量安全检查
 */
export function fullSafetyCheck(): FullSafetyReport {
  const warnings: string[] = [];

  const residual = checkResidualProcesses();
  if (residual.hasResidual) {
    warnings.push(`存在 ${residual.pidFiles.length + residual.lockFiles.length} 个残余文件`);
  }

  const cwd = validatePath(process.cwd());
  if (!cwd.writable) {
    warnings.push('当前工作目录不可写');
  }

  const tempDir = validatePath(process.env.TEMP || '/tmp');
  if (!tempDir.writable) {
    warnings.push('临时目录不可写');
  }

  if (warnings.length > 0) {
    logger.warn('Safety check found issues', { warnings }, { module: 'safety' });
  }

  return {
    residual,
    cwd,
    tempDir,
    warnings,
    timestamp: Date.now(),
  };
}

// ============================================================
// 辅助工具
// ============================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(0)}min`;
}

/**
 * 安全预处理：每次执行任务前调用
 * 检查残余进程、验证路径、确认环境正常
 */
export function safetyPreflight(taskName: string): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // 1. 检查残余
  const residual = checkResidualProcesses();
  if (residual.hasResidual) {
    const cleaned = cleanResiduals();
    if (cleaned.cleaned > 0) {
      warnings.push(`清理了 ${cleaned.cleaned} 个残余文件`);
    }
    if (cleaned.errors.length > 0) {
      warnings.push(...cleaned.errors);
    }
  }

  // 2. 验证 CWD
  const cwd = validatePath(process.cwd());
  if (!cwd.writable) {
    warnings.push('⚠️ 当前目录不可写，尝试切换到可写目录');
  }

  // 3. 检查内存/系统状态
  const memUsage = process.memoryUsage();
  if (memUsage.heapUsed > 500 * 1024 * 1024) {
    warnings.push(`⚠️ 内存使用较高: ${formatSize(memUsage.heapUsed)}`);
  }

  if (warnings.length > 0) {
    logger.info('Safety preflight', { task: taskName, warnings }, { module: 'safety' });
  }

  return { ok: warnings.length === 0, warnings };
}
