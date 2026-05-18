import fs from 'node:fs'
let c = fs.readFileSync('src/relay/cache-advanced.ts', 'utf-8')

// Fix 1: matchPattern
const oldMatch = '  /** 简单通配符匹配 */'
const idx1 = c.indexOf(oldMatch)
const idx1End = c.indexOf('  getStats', idx1)
const newMatch = `  /** 智能模式匹配：支持通配符和部分匹配 */
  #matchPattern(semKey: string, pattern: string): boolean {
    const conditions = pattern.split('|').filter(p => p !== '*');
    return conditions.every(cond => semKey.includes(cond));
  }

  getStats`
c = c.substring(0, idx1) + newMatch + c.substring(idx1End)

// Fix 2: hash function - fix template literal issue
c = c.replace(
  "return `${data.length}_${h.toString(36)}`;",
  "return data.length + '_' + h.toString(36);"
)

// Fix 3: storePayload - deterministic JSON stringify
c = c.replace(
  "const raw = typeof content === 'string' ? content : JSON.stringify(content);",
  "const raw = typeof content === 'string' ? content : JSON.stringify(content, Object.keys(content).sort());"
)

fs.writeFileSync('src/relay/cache-advanced.ts', c, 'utf-8')
console.log('Fixed')
