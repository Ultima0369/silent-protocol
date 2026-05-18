# Silent Protocol 基准测试方法论

> **三阶测试 · 八大场景 · 标准化度量**
> 目的：让每个人都能复现我们的性能数据，并在自己的环境中验证。

---

## 一、核心理念

基准测试不是为了"跑分好看"，而是回答三个问题：

1. **用 Silent Protocol 比不用省多少？** — 跟自然语言比
2. **Binary 比 JSON 快多少？** — 跟紧凑 JSON 比
3. **这套协议在实际场景中表现如何？** — 端到端模拟真实工作流

---

## 二、三阶测试框架

```
┌─────────────────────────────────────────────────────┐
│   Tier 1: 微基准 (Micro-Benchmarks)                  │
│   测编解码器本身：速度、大小、吞吐量                   │
│   工具: neca2 bench --micro                          │
├─────────────────────────────────────────────────────┤
│   Tier 2: 场景基准 (Scenario Benchmarks)              │
│   测真实应用模式：多轮对话、大文件、多智能体协调       │
│   工具: neca2 bench --scenarios                      │
├─────────────────────────────────────────────────────┤
│   Tier 3: 端到端基准 (End-to-End Benchmarks)          │
│   测完整链路：消息构建→校验→编码→路由→执行→返回      │
│   工具: neca2 bench --e2e                            │
└─────────────────────────────────────────────────────┘
```

---

## 三、八大应用场景

### 场景 1：智能体单条指令（Agent Command）

```
情境: cloud_ds 让 local_claude 执行一条 Shell 命令
自然语言: "请在本机执行 echo hello world"
紧凑协议: exec { cmd: "echo hello world", cwd: "/tmp" }
```

**测量指标：** 消息大小（bytes）、编码时间（μs）、Token 数

### 场景 2：多轮任务对话（Multi-turn Task）

```
情境: 完成一个复杂任务需要 10 轮往返
  cloud_ds → local_claude: exec "git status"
  local_claude → cloud_ds: 报告结果
  cloud_ds → local_claude: exec "git diff"
  local_claude → cloud_ds: 报告结果
  ... (共 10 轮)
自然语言: 每轮 ~200 chars × 10 = ~2000 chars / ~500 tokens
紧凑协议: 每轮 ~150 bytes × 10 = ~1500 bytes / ~375 tokens
```

**测量指标：** 总大小、总 Token、总延迟

### 场景 3：大文件操作（Large File Write/Read）

```
情境: 写入 100KB 的代码文件
自然语言: "请帮我创建一个包含以下代码的文件..." + 100KB 内容
紧凑协议: write { path: "/project/main.ts", content: "..." }
```

**测量指标：** 协议开销比例（overhead ratio）、传输时间

### 场景 4：多智能体协调（Multi-Agent Coordination）

```
情境: cloud_ds 分配任务 → local_claude 执行 → cloud_claude 评审
  1. cloud_ds → local_claude: exec "npm test"
  2. local_claude → cloud_ds: report { exitCode: 1, stderr: "..." }
  3. cloud_ds → cloud_claude: query "分析这个失败..."
  4. cloud_claude → cloud_ds: report { analysis: "..." }
自然语言: 4 轮 × 300 chars = 1200 chars / 300 tokens
紧凑协议: 4 轮 × 180 bytes = 720 bytes / 180 tokens
```

**测量指标：** 总大小、总 Token、结构解析时间

### 场景 5：会话恢复（Session Recovery）

```
情境: neca2 重启后从磁盘恢复 50 个活跃会话
无协议: 需要人工重新建立所有上下文
紧凑协议: auto-persist 自动恢复
```

**测量指标：** 恢复时间、恢复成功率、数据完整性

### 场景 6：跨模型路由（Cross-Model Routing）

```
情境: 一条消息从 cloud_ds 路由到 cloud_claude (API)
自然语言: 通过 API 传完整 prompt
紧凑协议: 通过紧凑消息传结构化 payload
```

**测量指标：** API 调用成本（Token 消耗 × 单价）

### 场景 7：尝菜式反馈循环（Tasting Loop）

```
情境: 人类在关键决策点介入一次（10 步任务中只参与 1 步）
自然语言全参与: 10 次人类介入
尝菜式: 1 次人类介入
```

**测量指标：** 人类介入次数、决策质量、时间成本

### 场景 8：高吞吐消息队列（High-Throughput Queue）

```
情境: 1 秒内 1000 条消息涌入
无协议: 每条消息需自然语言解析
紧凑协议: 结构化消息直接路由
```

**测量指标：** 吞吐量（msg/s）、延迟 P50/P95/P99、丢包率

---

## 四、标准化度量指标

| 指标 | 单位 | 含义 |
|------|------|------|
| `msg_size` | bytes | 单条消息编码后大小 |
| `overhead_ratio` | % | 协议开销 / 有效载荷 |
| `token_count` | tokens | 等价 Token 数（chars/4） |
| `enc_time` | μs | 单次编码时间 |
| `dec_time` | μs | 单次解码时间 |
| `throughput` | msg/s | 每秒可处理消息数 |
| `latency_p50` | ms | 延迟中位数 |
| `latency_p95` | ms | 延迟 95 分位 |
| `latency_p99` | ms | 延迟 99 分位 |
| `bandwidth_saving` | % | 相对自然语言的带宽节约 |
| `token_saving` | % | 相对自然语言的 Token 节约 |
| `cost_saving` | % | 相对自然语言的成本节约（按 API 单价） |

---

## 五、环境标准化

所有基准测试应在以下标准化环境中运行：

```
CPU:          任意 x86_64 / ARM64
RAM:          ≥ 8GB
Node.js:      ≥ 20.0.0
OS:           Linux / macOS / Windows (统一报告)
运行次数:     ≥ 1000 次迭代取中位数
预热:         100 次迭代预热
```

### 报告模板

```markdown
## 基准结果

**环境**: macOS 14.5 / Apple M3 / 16GB / Node.js 22.0.0
**日期**: 2026-05-18
**版本**: @silent-protocol/gateway v0.4.0

| 场景 | NL大小 | JSON大小 | Binary大小 | NL Token | JSON Token | Binary Token | 带宽节省 | Token节省 |
|------|--------|----------|------------|----------|------------|--------------|----------|-----------|
| 单条指令 | 200B | 203B | 109B | 50 | 51 | 27 | 45.5% | 46.0% |
| 多轮对话 | 2000B | 1500B | 800B | 500 | 375 | 200 | 60.0% | 60.0% |
```

---

## 六、如何复现

```bash
# 1. 克隆仓库
git clone https://github.com/Ultima0369/silent-protocol.git
cd silent-protocol/neca2

# 2. 安装依赖
npm install && npm run build

# 3. 运行所有基准
npx tsx src/cli.ts bench --all

# 4. 仅微基准
npx tsx src/cli.ts bench --micro

# 5. 仅场景基准
npx tsx src/cli.ts bench --scenarios

# 6. 输出报告
npx tsx src/cli.ts bench --all --output report.json
```

---

## 七、报告生成

运行基准后，输出包含：

1. **控制台摘要** — 关键指标高亮
2. **JSON 详细报告** — 所有原始数据
3. **与自然语言对比** — 节省百分比
4. **与上版本对比** — 性能回归检测

---

## 八、局限性说明

1. **Token 估算**：使用 chars/4 近似，实际 Tokenizer 行为不同
2. **网络延迟**：端到端测试包含网络延迟，非纯协议性能
3. **场景代表性**：八大场景覆盖常见模式，但非穷举
4. **硬件依赖性**：编解码速度受 CPU 影响，跨平台比较需谨慎

---

> 我们相信**可复现的基准测试**是开源项目信任的基础。
> 如果你在自己的环境中跑出了不同的数据，欢迎提 Issue 或 PR！
