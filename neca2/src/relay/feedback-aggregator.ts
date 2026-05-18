// ---- Feedback Aggregator ----
// 多步执行结果 → 一句话摘要
// 用户只验收结果，不关心中间步骤

import type { ExecutionPlan } from './exec-planner.js';

export interface ExecutionResult {
  summary: string;
  details: StepResultDetail[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  totalTimeMs: number;
  success: boolean;
}

export interface StepResultDetail {
  stepId: string;
  description: string;
  success: boolean;
  outputPreview: string;
  timeMs: number;
}

/**
 * 将多步执行结果聚合为人类可读的摘要
 * @param plan 执行计划
 * @param stepResults 各步骤结果
 * @returns 聚合结果
 */
export function aggregateFeedback(
  plan: ExecutionPlan,
  stepResults: Map<string, unknown>,
): ExecutionResult {
  const details: StepResultDetail[] = [];
  let completed = 0;
  let failed = 0;
  let totalTime = 0;

  for (const step of plan.steps) {
    const result = stepResults.get(step.id);
    const success = result !== undefined && !(result as any)?.error && !(result as any)?.skipped;

    if (success) completed++;
    else if (result !== undefined) failed++;

    const outputPreview = result
      ? JSON.stringify(result).substring(0, 120)
      : '(等待执行)';

    details.push({
      stepId: step.id,
      description: step.description,
      success,
      outputPreview,
      timeMs: 0,
    });
  }

  // 生成一句话摘要
  const summary = generateSummary(plan, details, completed, failed);

  return {
    summary,
    details,
    totalSteps: plan.steps.length,
    completedSteps: completed,
    failedSteps: failed,
    totalTimeMs: totalTime,
    success: failed === 0 && completed > 0,
  };
}

function generateSummary(
  plan: ExecutionPlan,
  details: StepResultDetail[],
  completed: number,
  failed: number,
): string {
  const total = plan.steps.length;

  if (failed > 0 && completed === 0) {
    return `❌ 全部失败（${failed}/${total} 步）。可能需要检查一下配置或环境。`;
  }

  if (failed > 0) {
    return `⚠️ 部分完成（${completed}/${total} 步成功，${failed} 步失败）。成功部分已就绪，失败部分可能需要调整。`;
  }

  if (completed === 0) {
    return '⏳ 还在处理中...';
  }

  if (completed === total) {
    // 根据意图类型生成不同的成功摘要
    switch (plan.intent.type) {
      case 'exec':
        return `✅ 命令执行完成。${details[0]?.outputPreview.substring(0, 80) || ''}`;
      case 'query':
        return `✅ 查询完成。${details[0]?.outputPreview.substring(0, 80) || ''}`;
      case 'write':
        return `✅ 已创建/更新。${details[0]?.description || ''}`;
      case 'read':
        return `✅ 读取成功。${details[0]?.outputPreview.substring(0, 60) || ''}`;
      case 'search':
        return `✅ 搜索完成。${details[0]?.outputPreview.substring(0, 60) || ''}`;
      case 'scrape':
        return `✅ 爬取完成！数据已获取${details.length > 1 ? '并分析' : ''}。`;
      case 'install':
        return `✅ 安装完成！${details[0]?.description || ''}`;
      case 'deploy':
        return `✅ 部署成功！已推送到远程。`;
      case 'analyze':
        return `✅ 分析完成。${details[details.length - 1]?.outputPreview.substring(0, 80) || ''}`;
      default:
        return `✅ 完成！${completed} 步全部执行成功。`;
    }
  }

  return `🔄 进度：${completed}/${total} 步完成${failed > 0 ? `，${failed} 步失败` : ''}`;
}

/**
 * 生成用户可直接看到的验收提示
 */
export function getAcceptancePrompt(result: ExecutionResult): string {
  if (!result.success) {
    return `${result.summary}\n\n你说"重来"我就重新试，或者你告诉我哪里要改。`;
  }
  return `${result.summary}\n\n你看看行不行？\n- 说"可以"→ 搞定\n- 说"改xxx"→ 我调整\n- 说"重来"→ 重新来一次`;
}
