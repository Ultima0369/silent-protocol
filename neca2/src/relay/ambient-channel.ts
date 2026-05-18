/**
 * Ambient Channel Protocol — 多智能体意识流协议
 * 
 * 不是 "A→B 的消息传递"
 * 而是 "A→环境 的持续广播"
 * 智能体通过"调谐"感知感兴趣的信息流
 * 
 * @packageDocumentation
 */

// ============================
// 基础类型
// ============================

export interface ChannelFrame {
  id: string
  channel: string
  source: string
  timestamp: number
  payload: unknown
  priority: 'low' | 'normal' | 'high' | 'critical'
  ttl: number           // 生存时间(ms)，0=永久
  overtone?: string     // 泛音标签，用于边缘信号
}

export interface TuningSpec {
  agentId: string
  channels: string[]
  priorityFilter?: number  // 最低优先级阈值
  resonanceOnly?: boolean  // 只接收共鸣信号
  since?: number           // 从哪个时间戳开始
}

export interface ResonanceEvent {
  frameId: string
  channel: string
  source: string
  agents: string[]        // 同时感知到的智能体
  intensity: number       // 共鸣强度 0-1
  timestamp: number
}

export interface InterruptSignal {
  channel: string
  source: string
  priority: 'high' | 'critical'
  message: string
  timestamp: number
  expiresAt: number
}

export interface AsyncAwakening {
  agentId: string
  channel: string
  dormantSince: number
  awakenedAt: number
  trigger: string
  context: unknown
}

export interface OvertoneSignal {
  channel: string
  source: string
  overtone: string
  payload: unknown
  timestamp: number
  resonance: number  // 共鸣度 0-1
}

// ============================
// 环境通道引擎
// ============================

export class AmbientChannelEngine {
  private frames: ChannelFrame[] = []
  private tunings: Map<string, TuningSpec> = new Map()
  private resonances: ResonanceEvent[] = []
  private interrupts: InterruptSignal[] = []
  private awakenings: AsyncAwakening[] = []
  private overtones: OvertoneSignal[] = []
  private frameCounter = 0
  private dormantAgents: Map<string, { since: number; channel: string }> = new Map()

  // ---- 广播 ----

  broadcast(frame: Omit<ChannelFrame, 'id' | 'timestamp'>): ChannelFrame {
    const full: ChannelFrame = {
      ...frame,
      id: `frame-${++this.frameCounter}`,
      timestamp: Date.now()
    }
    this.frames.push(full)
    this.cleanExpired()
    this.detectResonance(full)
    this.checkInterrupt(full)
    this.checkAwakening(full)
    this.collectOvertone(full)
    return full
  }

  // ---- 调谐 ----

  tune(spec: TuningSpec): void {
    this.tunings.set(spec.agentId, spec)
  }

  untune(agentId: string): void {
    this.tunings.delete(agentId)
  }

  perceive(agentId: string, since?: number): ChannelFrame[] {
    const spec = this.tunings.get(agentId)
    if (!spec) return []
    const cutoff = since ?? spec.since ?? 0
    return this.frames.filter(f => {
      if (f.timestamp < cutoff) return false
      if (!spec.channels.includes(f.channel) && !spec.channels.includes('*')) return false
      if (spec.resonanceOnly && !this.isResonating(f.id)) return false
      return true
    })
  }

  // ---- 共鸣检测 ----

  private detectResonance(frame: ChannelFrame): void {
    const tunedAgents = Array.from(this.tunings.entries())
      .filter(([_, spec]) => spec.channels.includes(frame.channel) || spec.channels.includes('*'))
      .map(([id]) => id)
    
    if (tunedAgents.length >= 2) {
      const event: ResonanceEvent = {
        frameId: frame.id,
        channel: frame.channel,
        source: frame.source,
        agents: tunedAgents,
        intensity: Math.min(1, tunedAgents.length / 10),
        timestamp: Date.now()
      }
      this.resonances.push(event)
    }
  }

  isResonating(frameId: string): boolean {
    return this.resonances.some(r => r.frameId === frameId)
  }

  getResonances(channel?: string): ResonanceEvent[] {
    if (channel) return this.resonances.filter(r => r.channel === channel)
    return this.resonances
  }

  // ---- 中断处理 ----

  private checkInterrupt(frame: ChannelFrame): void {
    if (frame.priority === 'high' || frame.priority === 'critical') {
      const signal: InterruptSignal = {
        channel: frame.channel,
        source: frame.source,
        priority: frame.priority,
        message: typeof frame.payload === 'string' ? frame.payload : JSON.stringify(frame.payload),
        timestamp: Date.now(),
        expiresAt: Date.now() + (frame.ttl || 5000)
      }
      this.interrupts.push(signal)
    }
  }

  getInterrupts(agentId: string, clear = true): InterruptSignal[] {
    const spec = this.tunings.get(agentId)
    if (!spec) return []
    const now = Date.now()
    const active = this.interrupts.filter(i => {
      if (i.expiresAt < now) return false
      if (!spec.channels.includes(i.channel) && !spec.channels.includes('*')) return false
      const pMap: Record<string, number> = { low: 0, normal: 1, high: 2, critical: 3 }
      return pMap[i.priority] >= (spec.priorityFilter ?? 0)
    })
    if (clear) {
      this.interrupts = this.interrupts.filter(i => !active.includes(i))
    }
    return active
  }

  // ---- 异步觉醒 ----

  private checkAwakening(frame: ChannelFrame): void {
    for (const [agentId, dormant] of this.dormantAgents) {
      if (dormant.channel === frame.channel || dormant.channel === '*') {
        const awakening: AsyncAwakening = {
          agentId,
          channel: frame.channel,
          dormantSince: dormant.since,
          awakenedAt: Date.now(),
          trigger: typeof frame.payload === 'string' ? frame.payload : 'activity',
          context: frame.payload
        }
        this.awakenings.push(awakening)
        this.dormantAgents.delete(agentId)
      }
    }
  }

  goDormant(agentId: string, channel: string): void {
    this.dormantAgents.set(agentId, { since: Date.now(), channel })
  }

  getAwakenings(agentId?: string): AsyncAwakening[] {
    if (agentId) return this.awakenings.filter(a => a.agentId === agentId)
    return this.awakenings
  }

  // ---- 泛音接收 ----

  private collectOvertone(frame: ChannelFrame): void {
    if (frame.overtone) {
      const recent = this.overtones.filter(o => 
        o.overtone === frame.overtone && 
        o.timestamp > Date.now() - 60000
      )
      const signal: OvertoneSignal = {
        channel: frame.channel,
        source: frame.source,
        overtone: frame.overtone,
        payload: frame.payload,
        timestamp: Date.now(),
        resonance: Math.min(1, recent.length / 5)
      }
      this.overtones.push(signal)
    }
  }

  getOvertones(overtone?: string, minResonance = 0): OvertoneSignal[] {
    let result = this.overtones
    if (overtone) result = result.filter(o => o.overtone === overtone)
    return result.filter(o => o.resonance >= minResonance)
  }

  // ---- 清理 ----

  private cleanExpired(): void {
    const now = Date.now()
    this.frames = this.frames.filter(f => f.ttl === 0 || f.timestamp + f.ttl > now)
    this.interrupts = this.interrupts.filter(i => i.expiresAt > now)
    if (this.resonances.length > 100) this.resonances = this.resonances.slice(-100)
    if (this.overtones.length > 100) this.overtones = this.overtones.slice(-100)
    if (this.awakenings.length > 100) this.awakenings = this.awakenings.slice(-100)
  }

  // ---- 统计 ----

  stats() {
    return {
      frames: this.frames.length,
      tunings: this.tunings.size,
      resonances: this.resonances.length,
      interrupts: this.interrupts.length,
      awakenings: this.awakenings.length,
      overtones: this.overtones.length,
      dormant: this.dormantAgents.size
    }
  }
}

// ============================
// 全局单例
// ============================

export const ambientEngine = new AmbientChannelEngine()
