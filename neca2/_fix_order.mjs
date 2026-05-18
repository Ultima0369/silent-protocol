import fs from 'node:fs'
let c = fs.readFileSync('src/cli.ts', 'utf-8')

// Fix 1: The printCacheSummary function is defined after showHelp but the call is before it.
// Need to move the function definition before showHelp actually, let me check where it ended up.
// Actually the replacement puts it right before "// ---- 帮助信息 ----" which is fine since JS hoists function declarations.
// But wait, it was added as a function declaration? Let me check.
// Actually in the _add_cache.mjs, it replaced `// ---- 帮助信息 ----` with the function + that text.
// So the function IS before showHelp. The issue is something else.

// Let me check line 334
const lines = c.split('\n')
console.log(`Line 334: ${lines[333]}`)

// Fix 2: The AnyPayload type issue in message-cache.ts
// Need to cast payload before indexing
c = c.replace(
  "acc[k] = msg.payload[k];",
  "acc[k] = (msg.payload as Record<string, unknown>)[k];"
)

fs.writeFileSync('src/cli.ts', c, 'utf-8')
console.log('Fixed')
