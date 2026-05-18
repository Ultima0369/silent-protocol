import fs from 'node:fs'
let c = fs.readFileSync('src/relay/cache-advanced.ts', 'utf-8')
c = c.replace('getStats  getStats()', 'getStats()')
fs.writeFileSync('src/relay/cache-advanced.ts', c, 'utf-8')
console.log('Fixed dup')
