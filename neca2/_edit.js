const fs=require("fs") 
const s=fs.readFileSync("src/tools.ts","utf-8") 
const result=s.replace("const pendingDeliveries = new Map()","const pendingDeliveries = new Map()") 
fs.writeFileSync("src/tools.ts",s+"\n","utf-8") 
