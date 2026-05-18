import fs from 'node:fs'
let c = fs.readFileSync('src/cli.ts', 'utf-8')

// 1. Add import for cache benchmarks (after the existing bench-scenarios import)
c = c.replace(
  "import type { ScenarioResult } from './bench-scenarios.js';",
  `import type { ScenarioResult } from './bench-scenarios.js';
import { runCacheBenchmarks, getCacheVsNLSummary } from './bench-cache.js';
import type { CacheScenarioResult } from './bench-cache.js';`
)

// 2. Add --cache flag handling in cmdBench
// Find the flag parsing section
c = c.replace(
  `  const runMicro = !hasFlag(args, '--scenarios') && !hasFlag(args, '--e2e') || hasFlag(args, '--micro') || hasFlag(args, '--all');
  const runScenarios = hasFlag(args, '--scenarios') || hasFlag(args, '--all');
  const runE2e = hasFlag(args, '--e2e') || hasFlag(args, '--all');
  const runAll = hasFlag(args, '--all');`,
  `  const runMicro = !hasFlag(args, '--scenarios') && !hasFlag(args, '--e2e') && !hasFlag(args, '--cache') || hasFlag(args, '--micro') || hasFlag(args, '--all');
  const runScenarios = hasFlag(args, '--scenarios') || hasFlag(args, '--all');
  const runE2e = hasFlag(args, '--e2e') || hasFlag(args, '--all');
  const runCache = hasFlag(args, '--cache') || hasFlag(args, '--all');
  const runAll = hasFlag(args, '--all');`
)

// 3. Add cache tier execution in cmdBench (after e2e section)
c = c.replace(
  `  if (runE2e) {
    report.tiers.e2e = await runE2eBenchmarks();
  }

  // 如果没有指定 flags，默认跑 micro + scenarios`,
  `  if (runE2e) {
    report.tiers.e2e = await runE2eBenchmarks();
  }
  if (runCache) {
    report.tiers.cache = runCacheBenchmarks();
  }

  // 如果没有指定 flags，默认跑 micro + scenarios`
)

// 4. Add cache output after cost estimates (before export)
c = c.replace(
  `  // 导出报告`,
  `  // 缓存基准输出
  if (report.tiers.cache) {
    printCacheSummary(report.tiers.cache);
  }

  // 导出报告`
)

// 5. Add printCacheSummary function before showHelp
c = c.replace(
  `// ---- 帮助信息 ----`,
  `// ---- 缓存基准输出 ----

function printCacheSummary(results: CacheScenarioResult[]): void {
  console.log($.b('  ⚡ Tier 4: Cache Benchmarks — The Real NL Killer\\n'));

  console.log($.gr('  Core insight: Structured messages are DETERMINISTIC.'));
  console.log($.gr('  Same (from, to, type, payload) = same encoded bytes.'));
  console.log($.gr('  Natural language changes every time = ZERO cacheability.'));
  console.log();

  // 表头
  console.log(\`  \${'场景'.padEnd(22)} \${'无缓存(μs)'.padEnd(14)} \${'有缓存(μs)'.padEnd(14)} \${'加速'.padEnd(10)} \${'命中率'.padEnd(10)} \${'NL 等效代价'}\`);
  console.log(\`  \${''.padEnd(22, '─')} \${''.padEnd(14, '─')} \${''.padEnd(14, '─')} \${''.padEnd(10, '─')} \${''.padEnd(10, '─')} \${''.padEnd(30, '─')}\`);

  for (const r of results) {
    const speedColor = parseFloat(r.speedup) > 3 ? $.g : parseFloat(r.speedup) > 1.5 ? $.y : $.gr;
    const hitColor = parseFloat(r.hitRate) > 80 ? $.g : parseFloat(r.hitRate) > 50 ? $.y : $.gr;
    console.log(
      \`  \${r.name.padEnd(22)}\` +
      \`\${String(r.withoutCache.avgUs).padEnd(14)}\` +
      \`\${String(r.withCache.avgUs).padEnd(14)}\` +
      \`\${speedColor(r.speedup.padStart(8))} \` +
      \`\${hitColor(r.hitRate.padStart(8))} \` +
      \`\${$.gr(r.nlEquivalentCost.substring(0, 28))}\`
    );
  }

  console.log();
  console.log($.b('  💡 Cache Insights:'));
  for (const r of results) {
    console.log(\`  \${$.c('▸')} \${r.name}: \${$.b(r.insight)}\`);
    console.log(\`     Cache behavior: \${$.gr(r.cacheBehavior)}\`);
    console.log(\`     NL equivalent:  \${$.y(r.nlEquivalentCost)}\`);
    console.log();
  }

  // 汇总
  const avgSpeed = results.reduce((a, r) => a + parseFloat(r.speedup || '1'), 0) / results.length;
  const avgHit = results.reduce((a, r) => a + parseFloat(r.hitRate || '0'), 0) / results.length;
  console.log($.b('  Summary (Cache):'));
  console.log(\`  Average speedup: \${$.g(avgSpeed.toFixed(1) + 'x')}  |  Average hit rate: \${$.g(avgHit.toFixed(1) + '%')}\`);
  console.log(\`  NL cacheability: \${$.y('0%')} — natural language is non-deterministic by nature\`);
  console.log(\`  \${$.g('★ This is the real killer feature: structured messages are free to repeat.')}\`);
  console.log();
}

// ---- 帮助信息 ----`
)

fs.writeFileSync('src/cli.ts', c, 'utf-8')
console.log('Added cache benchmarks to CLI')
