import fs from 'node:fs'
let c = fs.readFileSync('src/cli.ts', 'utf-8')

// Find the showHelp function and insert printCacheSummary before it
const helpIndex = c.indexOf('function showHelp')
if (helpIndex < 0) {
  console.log('ERROR: showHelp not found')
  process.exit(1)
}

const cacheFn = `
// ---- 缓存基准输出 ----

function printCacheSummary(results: CacheScenarioResult[]): void {
  console.log($.b('  \\u26a1 Tier 4: Cache Benchmarks — The Real NL Killer\\n'));

  console.log($.gr('  Core insight: Structured messages are DETERMINISTIC.'));
  console.log($.gr('  Same (from, to, type, payload) = same encoded bytes.'));
  console.log($.gr('  Natural language changes every time = ZERO cacheability.'));
  console.log();

  console.log(\`  \${'Scenario'.padEnd(22)} \${'No Cache(us)'.padEnd(14)} \${'Cached(us)'.padEnd(14)} \${'Speedup'.padEnd(10)} \${'Hit Rate'.padEnd(10)} \${'NL Equivalent'}\`);
  console.log(\`  \${''.padEnd(22, '-')} \${''.padEnd(14, '-')} \${''.padEnd(14, '-')} \${''.padEnd(10, '-')} \${''.padEnd(10, '-')} \${''.padEnd(30, '-')}\`);

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
  console.log($.b('  \\u{1f4a1} Cache Insights:'));
  for (const r of results) {
    console.log(\`  \\u25b8 \${r.name}: \${$.b(r.insight)}\`);
    console.log(\`     Cache: \${$.gr(r.cacheBehavior)}\`);
    console.log(\`     NL:    \${$.y(r.nlEquivalentCost)}\`);
    console.log();
  }

  const avgSpeed = results.reduce((a, r) => a + parseFloat(r.speedup || '1'), 0) / results.length;
  const avgHit = results.reduce((a, r) => a + parseFloat(r.hitRate || '0'), 0) / results.length;
  console.log($.b('  Summary (Cache):'));
  console.log(\`  Avg speedup: \${$.g(avgSpeed.toFixed(1) + 'x')}  |  Avg hit rate: \${$.g(avgHit.toFixed(1) + '%')}\`);
  console.log(\`  NL cacheability: \${$.y('0%')} — non-deterministic by nature\`);
  console.log(\`  \${$.g('\\u2605 This is the killer: structured messages are free to repeat.')}\`);
  console.log();
}

`

c = c.substring(0, helpIndex) + cacheFn + c.substring(helpIndex)

// Also fix the AnyPayload issue in message-cache.ts
fs.writeFileSync('src/cli.ts', c, 'utf-8')

// Fix message-cache.ts
let mc = fs.readFileSync('src/relay/message-cache.ts', 'utf-8')
mc = mc.replace(
  "acc[k] = msg.payload[k];",
  "acc[k] = (msg.payload as Record<string, unknown>)[k];"
)
fs.writeFileSync('src/relay/message-cache.ts', mc, 'utf-8')

console.log('Added printCacheSummary and fixed message-cache.ts')
