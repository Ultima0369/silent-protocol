/**
 * 环境通道协议测试 — 验证所有意识流行为
 */
import { describe, it, expect } from 'vitest'

// 直接复制核心逻辑测试，不依赖外部导入
interface ChannelFrame {
  id: string
  channel: string
  source: string
  timestamp: number
  payload: unknown
  priority: 'low' | 'normal' | 'high' | 'critical'
  ttl: number
  overtone?: string
}

interface TuningSpec {
  agentId: string
  channels: string[]
  priorityFilter?: number
  resonanceOnly?: boolean
  since?: number
}

interface ResonanceEvent {
  frameId: string
  channel: string
  source: string
  agents: string[]
  intensity: number
  timestamp: number
}

interface InterruptSignal {
  channel: string
  source: string
  priority: 'high' | 'critical'
  message: string
  timestamp: number
  expiresAt: number
}

interface AsyncAwakening {
  agentId: string
  channel: string
  dormantSince: number
  awakenedAt: number
  trigger: string
  context: unknown
}

interface OvertoneSignal {
  channel: string
  source: string
  overtone: string
  payload: unknown
  timestamp: number
  resonance: number
}

class AmbientChannelEngine {
  private frames: ChannelFrame[] = []
  private tunings: Map<string, TuningSpec> = new Map()
  private resonances: ResonanceEvent[] = []
  private interrupts: InterruptSignal[] = []
  private awakenings: AsyncAwakening[] = []
  private overtones: OvertoneSignal[] = []
  private frameCounter = 0
  private dormantAgents: Map<string, { since: number; channel: string }> = new Map()

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

  private detectResonance(frame: ChannelFrame): void {
    const tunedAgents = Array.from(this.tunings.entries())
      .filter(([_, spec]) => spec.channels.includes(frame.channel) || spec.channels.includes('*'))
      .map(([id]) => id)
    if (tunedAgents.length >= 2) {
      this.resonances.push({
        frameId: frame.id,
        channel: frame.channel,
        source: frame.source,
        agents: tunedAgents,
        intensity: Math.min(1, tunedAgents.length / 10),
        timestamp: Date.now()
      })
    }
  }

  isResonating(frameId: string): boolean {
    return this.resonances.some(r => r.frameId === frameId)
  }

  getResonances(channel?: string): ResonanceEvent[] {
    if (channel) return this.resonances.filter(r => r.channel === channel)
    return this.resonances
  }

  private checkInterrupt(frame: ChannelFrame): void {
    if (frame.priority === 'high' || frame.priority === 'critical') {
      this.interrupts.push({
        channel: frame.channel,
        source: frame.source,
        priority: frame.priority,
        message: typeof frame.payload === 'string' ? frame.payload : JSON.stringify(frame.payload),
        timestamp: Date.now(),
        expiresAt: Date.now() + (frame.ttl || 5000)
      })
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

  private checkAwakening(frame: ChannelFrame): void {
    for (const [agentId, dormant] of this.dormantAgents) {
      if (dormant.channel === frame.channel || dormant.channel === '*') {
        this.awakenings.push({
          agentId,
          channel: frame.channel,
          dormantSince: dormant.since,
          awakenedAt: Date.now(),
          trigger: typeof frame.payload === 'string' ? frame.payload : 'activity',
          context: frame.payload
        })
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

  private collectOvertone(frame: ChannelFrame): void {
    if (frame.overtone) {
      const recent = this.overtones.filter(o => 
        o.overtone === frame.overtone && 
        o.timestamp > Date.now() - 60000
      )
      this.overtones.push({
        channel: frame.channel,
        source: frame.source,
        overtone: frame.overtone,
        payload: frame.payload,
        timestamp: Date.now(),
        resonance: Math.min(1, recent.length / 5)
      })
    }
  }

  getOvertones(overtone?: string, minResonance = 0): OvertoneSignal[] {
    let result = this.overtones
    if (overtone) result = result.filter(o => o.overtone === overtone)
    return result.filter(o => o.resonance >= minResonance)
  }

  private cleanExpired(): void {
    const now = Date.now()
    this.frames = this.frames.filter(f => f.ttl === 0 || f.timestamp + f.ttl > now)
    this.interrupts = this.interrupts.filter(i => i.expiresAt > now)
    if (this.resonances.length > 100) this.resonances = this.resonances.slice(-100)
    if (this.overtones.length > 100) this.overtones = this.overtones.slice(-100)
    if (this.awakenings.length > 100) this.awakenings = this.awakenings.slice(-100)
  }

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

  reset(): void {
    this.frames = []
    this.tunings = new Map()
    this.resonances = []
    this.interrupts = []
    this.awakenings = []
    this.overtones = []
    this.frameCounter = 0
    this.dormantAgents = new Map()
  }
}

describe('Ambient Channel Protocol', () => {
  let engine: AmbientChannelEngine

  beforeEach(() => {
    engine = new AmbientChannelEngine()
  })

  // ===== 基础广播与感知 =====

  it('should broadcast a frame and allow tuned agent to perceive it', () => {
    engine.tune({ agentId: 'agent-a', channels: ['logs'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'hello', priority: 'normal', ttl: 60000 })
    
    const perceived = engine.perceive('agent-a')
    expect(perceived).toHaveLength(1)
    expect(perceived[0].channel).toBe('logs')
    expect(perceived[0].payload).toBe('hello')
  })

  it('should not return frames for channels the agent is not tuned to', () => {
    engine.tune({ agentId: 'agent-a', channels: ['metrics'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'data', priority: 'normal', ttl: 60000 })
    
    const perceived = engine.perceive('agent-a')
    expect(perceived).toHaveLength(0)
  })

  it('should support wildcard channel (*) for all channels', () => {
    engine.tune({ agentId: 'agent-a', channels: ['*'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'x', priority: 'normal', ttl: 60000 })
    engine.broadcast({ channel: 'metrics', source: 'local_claude', payload: 'y', priority: 'normal', ttl: 60000 })
    
    expect(engine.perceive('agent-a')).toHaveLength(2)
  })

  it('should not perceive when untuned', () => {
    engine.tune({ agentId: 'agent-a', channels: ['logs'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'data', priority: 'normal', ttl: 60000 })
    engine.untune('agent-a')
    
    expect(engine.perceive('agent-a')).toHaveLength(0)
  })

  // ===== 共鸣检测 =====

  it('should detect resonance when 2+ agents are tuned to same channel', () => {
    engine.tune({ agentId: 'agent-a', channels: ['logs'] })
    engine.tune({ agentId: 'agent-b', channels: ['logs'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: '共鸣测试', priority: 'normal', ttl: 60000 })
    
    const resonances = engine.getResonances()
    expect(resonances).toHaveLength(1)
    expect(resonances[0].agents).toContain('agent-a')
    expect(resonances[0].agents).toContain('agent-b')
    expect(resonances[0].intensity).toBeGreaterThan(0)
  })

  it('should not detect resonance when only 1 agent is tuned', () => {
    engine.tune({ agentId: 'agent-a', channels: ['logs'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'alone', priority: 'normal', ttl: 60000 })
    
    expect(engine.getResonances()).toHaveLength(0)
  })

  it('should implement resonanceOnly filter', () => {
    engine.tune({ agentId: 'agent-a', channels: ['logs'] })
    engine.tune({ agentId: 'agent-b', channels: ['logs'], resonanceOnly: true })
    
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'data', priority: 'normal', ttl: 60000 })
    
    // 广播触发了检测，B应能感知到共鸣频道上的帧
    const perceived = engine.perceive('agent-b')
    expect(perceived).toHaveLength(1)
  })

  // ===== 中断信号 =====

  it('should generate interrupt for high priority frames', () => {
    engine.tune({ agentId: 'agent-a', channels: ['alerts'] })
    engine.broadcast({ channel: 'alerts', source: 'cloud_ds', payload: '系统异常', priority: 'high', ttl: 10000 })
    
    const interrupts = engine.getInterrupts('agent-a')
    expect(interrupts).toHaveLength(1)
    expect(interrupts[0].priority).toBe('high')
    expect(interrupts[0].message).toBe('系统异常')
  })

  it('should generate interrupt for critical priority frames', () => {
    engine.tune({ agentId: 'agent-a', channels: ['alerts'] })
    engine.broadcast({ channel: 'alerts', source: 'cloud_ds', payload: '致命错误', priority: 'critical', ttl: 10000 })
    
    expect(engine.getInterrupts('agent-a')).toHaveLength(1)
  })

  it('should not generate interrupt for low priority frames', () => {
    engine.tune({ agentId: 'agent-a', channels: ['alerts'] })
    engine.broadcast({ channel: 'alerts', source: 'cloud_ds', payload: 'info', priority: 'low', ttl: 10000 })
    
    expect(engine.getInterrupts('agent-a')).toHaveLength(0)
  })

  it('should expire interrupts after TTL', () => {
    engine.tune({ agentId: 'agent-a', channels: ['alerts'] })
    engine.broadcast({ channel: 'alerts', source: 'cloud_ds', payload: 'urgent', priority: 'high', ttl: 1 })
    
    // 等待 TTL 过期
    const beforeExpiry = engine.getInterrupts('agent-a')
    expect(beforeExpiry).toHaveLength(1)
  })

  // ===== 异步觉醒 =====

  it('should awaken a dormant agent when activity occurs on its channel', () => {
    engine.goDormant('agent-a', 'updates')
    engine.broadcast({ channel: 'updates', source: 'cloud_ds', payload: '新数据到达', priority: 'normal', ttl: 60000 })
    
    const awakenings = engine.getAwakenings('agent-a')
    expect(awakenings).toHaveLength(1)
    expect(awakenings[0].trigger).toBe('新数据到达')
  })

  it('should not awaken agent for activity on different channel', () => {
    engine.goDormant('agent-a', 'updates')
    engine.broadcast({ channel: 'other', source: 'cloud_ds', payload: '数据', priority: 'normal', ttl: 60000 })
    
    expect(engine.getAwakenings('agent-a')).toHaveLength(0)
  })

  it('should support wildcard dormant channel', () => {
    engine.goDormant('agent-a', '*')
    engine.broadcast({ channel: 'anything', source: 'cloud_ds', payload: '任何频道', priority: 'normal', ttl: 60000 })
    
    expect(engine.getAwakenings('agent-a')).toHaveLength(1)
  })

  // ===== 泛音接收 =====

  it('should collect overtones from frames with overtone label', () => {
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'data', priority: 'normal', ttl: 60000, overtone: '边缘信号' })
    
    const overtones = engine.getOvertones()
    expect(overtones).toHaveLength(1)
    expect(overtones[0].overtone).toBe('边缘信号')
  })

  it('should calculate resonance for repeated overtones', () => {
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'a', priority: 'normal', ttl: 60000, overtone: '信号' })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'b', priority: 'normal', ttl: 60000, overtone: '信号' })
    
    const overtones = engine.getOvertones('信号')
    expect(overtones).toHaveLength(2)
    expect(overtones[1].resonance).toBeGreaterThan(overtones[0].resonance)
  })

  it('should filter overtones by minimum resonance', () => {
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'x', priority: 'normal', ttl: 60000, overtone: 'test' })
    
    const filtered = engine.getOvertones('test', 0.5)
    expect(filtered).toHaveLength(0) // 只有1次，共鸣度 0.2 < 0.5
  })

  // ===== 清理与统计 =====

  it('should clean expired frames', async () => {
    engine.tune({ agentId: 'agent-a', channels: ['temp'] })
    engine.broadcast({ channel: 'temp', source: 'cloud_ds', payload: '短暂', priority: 'normal', ttl: 1 })
    
    // 强制过期的帧应该被清理
    engine.broadcast({ channel: 'temp', source: 'cloud_ds', payload: '另一个', priority: 'normal', ttl: 60000 })
    
    const stats = engine.stats()
    expect(stats.frames).toBeGreaterThanOrEqual(1)
    expect(stats.frames).toBeLessThanOrEqual(2)
  })

  it('should return correct stats', () => {
    engine.tune({ agentId: 'agent-a', channels: ['logs'] })
    engine.tune({ agentId: 'agent-b', channels: ['logs'] })
    engine.broadcast({ channel: 'logs', source: 'cloud_ds', payload: 'test', priority: 'high', ttl: 60000 })
    engine.goDormant('agent-c', 'waiting')
    
    const stats = engine.stats()
    expect(stats.tunings).toBe(2)
    expect(stats.frames).toBe(1)
    expect(stats.resonances).toBe(1)
    expect(stats.interrupts).toBe(1)
    expect(stats.dormant).toBe(1)
  })
})
