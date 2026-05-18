// ---- Safety Guard Tests ----
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  checkResidualProcesses,
  cleanResiduals,
  validatePath,
  analyzeFileForChunking,
  writeFileInChunks,
  withTimeout,
  fullSafetyCheck,
  safetyPreflight,
} from '../src/utils/safety.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Safety Guard — 残余进程检查', () => {
  it('应该检测到没有残余进程（或返回无警告的干净状态）', () => {
    const result = checkResidualProcesses();
    // 不太可能有残余，但不一定——所以只检查返回值结构
    expect(result).toHaveProperty('hasResidual');
    expect(result).toHaveProperty('pidFiles');
    expect(result).toHaveProperty('lockFiles');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.pidFiles)).toBe(true);
    expect(Array.isArray(result.lockFiles)).toBe(true);
  });

  it('cleanResiduals 应该安全执行不报错', () => {
    const result = cleanResiduals();
    expect(result).toHaveProperty('cleaned');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

describe('Safety Guard — 路径验证', () => {
  it('应该验证当前目录存在且可写', () => {
    const result = validatePath(process.cwd());
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result).toHaveProperty('writable');
    expect(result).toHaveProperty('readable');
  });

  it('应该验证不存在的路径', () => {
    const result = validatePath('/nonexistent_path_xyz_12345');
    expect(result.exists).toBe(false);
  });

  it('应该验证文件路径', () => {
    const testFile = path.join(process.cwd(), '.safety_test_file');
    fs.writeFileSync(testFile, 'test');
    const result = validatePath(testFile);
    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(true);
    expect(result.size).toBeGreaterThan(0);
    fs.unlinkSync(testFile);
  });
});

describe('Safety Guard — 大文件分块分析', () => {
  it('小文件应建议 1 块', () => {
    const result = analyzeFileForChunking('hello world');
    expect(result.chunks).toBe(1);
    expect(result.warnings.length).toBe(0);
  });

  it('超大文件应建议分块', () => {
    // 模拟大文件：超过 MAX_FILE_SIZE（10MB）
    const largeContent = 'x'.repeat(11 * 1024 * 1024);
    const result = analyzeFileForChunking(largeContent);
    expect(result.chunks).toBeGreaterThan(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('1MB+ 文件应给出内存警告', () => {
    const content = 'x'.repeat(2 * 1024 * 1024);
    const result = analyzeFileForChunking(content);
    const hasMemWarning = result.warnings.some(w => w.includes('1MB'));
    expect(hasMemWarning).toBe(true);
  });
});

describe('Safety Guard — 分块写入', () => {
  const testDir = path.join(process.cwd(), '.safety_test');
  const testFile = path.join(testDir, 'chunked_test.txt');

  afterAll(() => {
    try { fs.unlinkSync(testFile); } catch {}
    try { fs.rmdirSync(testDir); } catch {}
  });

  it('小文件应直接写入', () => {
    const result = writeFileInChunks(testFile, 'hello world');
    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(11);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('hello world');
  });

  it('大文件应分块写入', () => {
    const largeContent = 'y'.repeat(200 * 1024); // 200KB
    const result = writeFileInChunks(testFile, largeContent);
    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(200 * 1024);
  });

  it('写入内容应可读回', () => {
    const content = '分块写入测试内容';
    writeFileInChunks(testFile, content);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(content);
  });
});

describe('Safety Guard — 超时包装器', () => {
  it('正常任务应在超时前完成', async () => {
    const result = await withTimeout(
      async () => 'done',
      1000,
      'test'
    );
    expect(result).toBe('done');
  });

  it('超时任务应抛出错误', async () => {
    await expect(
      withTimeout(
        async () => { await new Promise(r => setTimeout(r, 5000)); return 'slow'; },
        100,
        'slow_task'
      )
    ).rejects.toThrow();
  });
});

describe('Safety Guard — 全量检查', () => {
  it('应返回完整的检查报告', () => {
    const report = fullSafetyCheck();
    expect(report).toHaveProperty('residual');
    expect(report).toHaveProperty('cwd');
    expect(report).toHaveProperty('tempDir');
    expect(report).toHaveProperty('warnings');
    expect(report).toHaveProperty('timestamp');
    expect(report.cwd.exists).toBe(true);
  });
});

describe('Safety Guard — 安全前检', () => {
  it('应返回 preflight 结果', () => {
    const result = safetyPreflight('test_task');
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('warnings');
  });
});
