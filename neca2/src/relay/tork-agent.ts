/**
 * TORK Agent 桥接器 — 将 TORK 注册为 Silent Protocol 的一等公民
 *
 * 功能：
 *   1. TCP 连接 TORK torkd socket（Unix / Windows named pipe）
 *   2. 发送 BF (binary frame) 或 JSON 消息
 *   3. 接收心跳 / 健康状态 / 灵魂状态
 *   4. 转发 SP 消息给 TORK 执行
 *   5. TORK 觉醒事件广播到 Ambient Channel
 */

import type { Message } from '../protocol/types.js'
import { makeMessage, now } from '../protocol/codec.js'
import { ambientEngine } from './ambient-channel.js'

// ---- 配置 ----

export interface TorkAgentConfig {
  /** TORK torkd socket 路径（Unix）或 named pipe（Windows） */
  socketPath: string
  /** HTTP 回退地址 */
  httpAddr?: string
  /** 心跳间隔 ms */
  heartbeatMs: number
  /** 超时 ms */
  timeoutMs: number
  /** 重连间隔 ms */
  reconnectMs: number
}

const DEFAULT_CONFIG: TorkAgentConfig = {
  socketPath: '/tmp/torkd.sock',
  httpAddr: 'http://127.0.0.1:8420',
  heartbeatMs: 5000,
  timeoutMs: 10000,
  reconnectMs: 3000,
}

// ---- TORK 健康状态 ----

export interface TorkHealth {
  alive: boolean
  heartbeat: number        // bpm
  generation: number
  ticks: number
  uptime: number           // seconds
  temperature: number
  mode: 'sleep' | 'run' | 'evolve'
  soulVersion: number
  lastSeen: number
  error?: string
}

// ---- TORK Agent 类 ----

export class TorkAgent {
  private socket: any = null         // net.Socket | null
  private config: TorkAgentConfig
  private health: TorkHealth = {
    alive: false, heartbeat: 0, generation: 0, ticks: 0,
    uptime: 0, temperature: 0, mode: 'sleep',
    soulVersion: 0, lastSeen: 0,
  }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private listeners: Array<(msg: any) => void> = []
  private outbox: Message[] = []

  constructor(config?: Partial<TorkAgentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ---- 生命周期 ----

  /** 启动连接 */
  start(): void {
    this.connect()
    this.heartbeatTimer = setInterval(() => this.ping(), this.config.heartbeatMs)
  }

  /** 停止连接 */
  stop(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.socket) { try { this.socket.end() } catch {} this.socket = null }
    this.health.alive = false
  }

  /** 获取最新健康状态 */
  getHealth(): TorkHealth { return { ...this.health } }

  /** 注册消息监听 */
  onMessage(fn: (msg: any) => void): void { this.listeners.push(fn) }

  /** 发送消息到 TORK */
  send(payload: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('TORK send timeout')), this.config.timeoutMs)
      const doSend = (sock: any) => {
        sock.write(payload + '\n', (err: Error | null) => {
          if (err) { clearTimeout(timeout); reject(err); return }
          sock.once('data', (data: Buffer) => {
            clearTimeout(timeout)
            resolve(data.toString().trim())
          })
        })
      }

      if (this.socket && this.socket.writable) {
        doSend(this.socket)
      } else {
        this.outbox.push({ id: 'tork-' + Date.now(), from: 'neca', to: 'tork_local', type: 'query', payload: { question: payload }, ver: 1, ts: now(), callback: true })
        reject(new Error('TORK not connected'))
      }
    })
  }

  /** 获取 TORK 灵魂摘要 */
  async getSoulSummary(): Promise<any> {
    const resp = await this.send('soul')
    try { return JSON.parse(resp) } catch { return { raw: resp } }
  }

  /** 触发 TORK 进化 */
  async triggerEvolution(rounds: number = 1): Promise<string> {
    return this.send(`evolve:${rounds}`)
  }

  /** 获取 TORK 心跳 */
  async getHeartbeat(): Promise<number> {
    const resp = await this.send('ping')
    try {
      const parsed = JSON.parse(resp)
      if (parsed.heartbeat !== undefined) {
        this.health.heartbeat = parsed.heartbeat
        this.health.generation = parsed.generation ?? this.health.generation
        this.health.ticks = parsed.ticks ?? this.health.ticks
      }
    } catch {}
    return this.health.heartbeat
  }

  /** 将 TORK 状态广播到 Ambient Channel */
  broadcastTorkAwareness(): void {
    if (!this.health.alive) return
    ambientEngine.broadcast({
      channel: 'tork/heartbeat',
      source: 'tork_local',
      payload: this.health,
      priority: 'normal',
      ttl: 10000,
      overtone: 'tork-presence',
    })
  }

  /** 将 TORK 健康变化推送到 Ambient Channel */
  private broadcastHealthChange(): void {
    const priority = this.health.heartbeat > 100 ? 'high' : 'normal'
    ambientEngine.broadcast({
      channel: 'tork/health',
      source: 'tork_local',
      payload: this.health,
      priority: priority as 'normal' | 'high',
      ttl: 15000,
    })
  }

  // ---- 内部 ----

  private connect(): void {
    try {
      const net = require('net') as any
      const sock = net.createConnection(this.config.socketPath, () => {
        this.socket = sock
        this.health.alive = true
        this.health.lastSeen = Date.now()
        this.broadcastHealthChange()
      })

      sock.on('data', (data: Buffer) => {
        this.health.alive = true
        this.health.lastSeen = Date.now()
        const text = data.toString().trim()
        try {
          const parsed = JSON.parse(text)
          if (parsed.heartbeat !== undefined) {
            this.health.heartbeat = parsed.heartbeat
            this.health.generation = parsed.generation ?? this.health.generation
            this.health.ticks = parsed.ticks ?? this.health.ticks
            this.health.temperature = parsed.temperature ?? this.health.temperature
            this.health.mode = parsed.mode ?? this.health.mode
          }
          for (const fn of this.listeners) fn(parsed)
        } catch {}
      })

      sock.on('close', () => {
        this.health.alive = false
        this.socket = null
        this.scheduleReconnect()
      })

      sock.on('error', () => {
        this.health.alive = false
        this.socket = null
        this.scheduleReconnect()
      })
    } catch {
      this.health.alive = false
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.config.reconnectMs)
  }

  private ping(): void {
    if (!this.socket || !this.socket.writable) return
    this.socket.write('ping\n')
    if (Date.now() - this.health.lastSeen > 30000) {
      this.health.alive = false
    }
  }
}

// ---- 全局单例 ----

export const torkAgent = new TorkAgent()

/** SP 路由处理：将消息转发给 TORK */
export async function routeToTork(session: { id: string; message: Message }): Promise<any> {
  const msg = session.message
  const pld = msg.payload as any

  if (!torkAgent.getHealth().alive) {
    return {
      status: 'error',
      response: {
        ...msg,
        from: 'tork_local',
        to: msg.from,
        type: 'error' as const,
        payload: { code: 'TARGET_UNREACHABLE', message: 'TORK is not running' },
      },
    }
  }

  try {
    switch (msg.type) {
      case 'ping': {
        const health = torkAgent.getHealth()
        return {
          status: 'reply_received',
          response: {
            ...msg, from: 'tork_local', to: msg.from, type: 'pong' as const,
            payload: { status: 'ok', ...health },
          },
        }
      }

      case 'query': {
        const result = await torkAgent.send(pld.question || 'status')
        return {
          status: 'reply_received',
          response: {
            ...msg, from: 'tork_local', to: msg.from, type: 'report' as const,
            payload: { taskId: msg.id, status: 'completed' as const, result },
          },
        }
      }

      case 'exec': {
        const result = await torkAgent.send(pld.cmd || 'status')
        return {
          status: 'reply_received',
          response: {
            ...msg, from: 'tork_local', to: msg.from, type: 'exec' as const,
            payload: { cmd: pld.cmd || '', exitCode: 0, stdout: result, stderr: '', timedout: false, duration: 0 },
          },
        }
      }

      default: {
        const result = await torkAgent.send(`exec:${msg.type}:${JSON.stringify(msg.payload)}`)
        return {
          status: 'reply_received',
          response: {
            ...msg, from: 'tork_local', to: msg.from, type: 'report' as const,
            payload: { taskId: msg.id, status: 'completed' as const, result },
          },
        }
      }
    }
  } catch (err: any) {
    return {
      status: 'error',
      response: {
        ...msg, from: 'tork_local', to: msg.from, type: 'error' as const,
        payload: { code: 'INTERNAL_ERROR', message: err.message },
      },
    }
  }
}
