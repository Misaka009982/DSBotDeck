// SPDX-License-Identifier: Apache-2.0
// 连接、状态读取与缓存按服务器隔离；写入只调用一次上游 RpcClient。
import { createNoticeCursor } from '@dsbot/notices'
import type { BotResult, SavedServer, ServerView, TeamView } from '../shared/domain.ts'
import { emptyCounts } from '../shared/domain.ts'
import { countEntities, TaskModel } from '../shared/task-model.ts'
import { learningCanAnswer } from '../shared/learning-model.ts'
import { DeckError, errorCode, finite, record, safeMessage } from '../shared/validation.ts'
import type { Peer, PeerEvent, PeerFactory } from './link-factory.ts'

export interface ConnectionToken { generation: number; peer: Peer }
export interface ConnectionHooks { changed(): void; paired(): Promise<void> }
const RETRY = [2000, 4000, 8000, 16000, 30000]
const FATAL = new Set(['NOT_PAIRED', 'PAIRING_REJECTED', 'PEER_IDENTITY_MISMATCH'])
export const reconnectDelay = (failures: number): number => RETRY[Math.min(RETRY.length - 1, Math.max(0, failures))]
export class ServerConnection {
  private config: SavedServer
  private readonly factory: PeerFactory
  private readonly hooks: ConnectionHooks
  private peer: Peer | null = null
  private authenticated = false
  private generation = 0
  private state: ServerView['state']
  private error: string | null = null
  private retryAt: number | null = null
  private lastSyncAt: number | null = null
  private team: TeamView | null = null
  private raw: Record<string, unknown> | null = null
  private stale = true
  private stopped = false
  private failures = 0
  private model = new TaskModel()
  private readonly cursor = createNoticeCursor()
  private hello: { api: number; boot: string; seq: number } | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private pollAt: number | null = null
  private reading: { generation: number; promise: Promise<void> } | null = null
  private readAgain = false
  private fullState = false
  private stateReads = 0
  private stateApplied = 0
  private stateFullApplied = 0
  private readonly listeners = new Set<(entry: PeerEvent) => void>()
  constructor(config: SavedServer, factory: PeerFactory, hooks: ConnectionHooks) {
    this.config = structuredClone(config); this.factory = factory; this.hooks = hooks
    this.state = config.paired ? 'disconnected' : 'unpaired'
  }
  id(): string { return this.config.id }
  settings(): SavedServer { return structuredClone(this.config) }
  update(config: SavedServer): void {
    if (config.id !== this.config.id || config.hostKey !== this.config.hostKey || config.hostDeviceId !== this.config.hostDeviceId || config.mode !== this.config.mode
      || config.identity.deviceId !== this.config.identity.deviceId || config.identity.publicKey !== this.config.identity.publicKey
      || config.identity.privateKey !== this.config.identity.privateKey || config.identity.accessToken !== this.config.identity.accessToken) throw new DeckError('bot/invalid', '不能隐式替换已绑定的服务器身份。')
    if (config.relayUrl !== this.config.relayUrl && !this.stopped) throw new DeckError('bot/refused', '更换隧道地址前必须先断开旧连接。')
    this.config = structuredClone(config); this.reproject(); this.hooks.changed()
  }
  view(): ServerView {
    return {
      id: this.config.id, alias: this.config.alias, relay: this.config.relayUrl, mode: this.config.mode,
      state: this.state, error: this.error, generation: this.generation, retryAt: this.retryAt,
      lastSyncAt: this.lastSyncAt, cached: this.stale || this.state !== 'ready',
      team: this.team === null ? null : structuredClone(this.team), counts: this.team === null ? emptyCounts() : countEntities(this.team.entities),
    }
  }
  learningApproval(): boolean { return !this.stale && this.state === 'ready' && learningCanAnswer(this.raw, this.config.mode) }
  token(): ConnectionToken | null { return this.peer && this.authenticated ? { generation: this.generation, peer: this.peer } : null }
  valid(token: ConnectionToken, requireFresh = true): boolean {
    return this.peer === token.peer && this.generation === token.generation && this.authenticated && !this.stopped && (!requireFresh || !this.stale && this.state === 'ready')
  }
  subscribe(listener: (entry: PeerEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  pendingToken(key: string, taskId: string | null = null): string | null { return this.model.pendingToken(key, taskId) }
  taskKey(botId: string, taskId: string): string | null { return this.model.taskKey(botId, taskId) }
  acknowledge(key: string, token: string | null, taskId: string | null = null): boolean {
    const changed = this.model.acknowledge(key, token, taskId)
    if (changed) { this.reproject(); this.hooks.changed() }
    return changed
  }
  acknowledgeFailure(taskId: string): void { this.model.acknowledgeFailure(taskId); this.reproject(); this.hooks.changed() }
  private current(peer: Peer, generation: number): boolean { return this.peer === peer && this.generation === generation && !this.stopped }
  private emit(event: string, data: unknown): void { for (const listener of [...this.listeners]) listener({ event, data }) }
  private reproject(): void { if (this.raw !== null) this.team = this.model.project(this.raw, this.config.unfollowed) }
  private hasBlockedBot(id: unknown, value = this.raw): boolean {
    if (typeof id !== 'string' || !Array.isArray(value?.bots)) return false
    return value.bots.some(item => { const bot = record(item); return bot !== null && bot.id === id && record(bot.blocked) !== null })
  }
  private stopTimers(): void { clearTimeout(this.retryTimer); clearTimeout(this.pollTimer); this.retryTimer = undefined; this.pollTimer = undefined; this.pollAt = null; this.retryAt = null }
  private later(): void {
    if (this.stopped || !this.config.autoConnect) return
    const delay = reconnectDelay(this.failures); this.failures += 1
    clearTimeout(this.retryTimer)
    this.retryAt = Date.now() + delay; this.state = 'reconnecting'; this.hooks.changed()
    this.retryTimer = setTimeout(() => { void this.connect().catch(() => {}) }, delay)
  }
  private lost(peer: Peer, generation: number): void {
    if (!this.current(peer, generation)) return
    const reason = peer.reason()
    this.peer = null; this.authenticated = false; this.generation += 1; this.stale = true
    clearTimeout(this.pollTimer); this.pollTimer = undefined; this.pollAt = null
    this.error = FATAL.has(errorCode(reason)) ? safeMessage(reason) : '连接中断，当前内容为缓存，完成状态待确认。'
    this.emit('lost', {})
    if (FATAL.has(errorCode(reason))) { this.state = 'needs-pairing'; this.retryAt = null; this.hooks.changed() }
    else this.later()
  }
  async connect(pairingCode?: string): Promise<void> {
    this.stopTimers(); this.stopped = false
    const old = this.peer
    this.peer = null; this.authenticated = false; this.generation += 1
    this.fullState = true
    const generation = this.generation
    if (old) await old.close().catch(() => {})
    if (this.generation !== generation || this.stopped) return
    this.state = 'connecting'; this.stale = true; this.error = null; this.hooks.changed()
    let peer: Peer | null = null
    try {
      peer = this.factory(this.config, pairingCode)
      this.peer = peer
      const active = peer
      active.onClose(() => this.lost(active, generation))
      active.onEvent(entry => { if (this.current(active, generation) && this.authenticated) this.onEvent(entry) })
      await active.connect()
      if (!this.current(active, generation)) return
      // 设备身份已在配对前加密保存；成功握手后即确认配对，不因 hello/state 失败丢失身份。
      await this.hooks.paired()
      if (!this.current(active, generation)) return
      const answer = record(await this.callPeer(active, generation, 'hello', {}))
      if (!answer || answer.api !== 1 || typeof answer.boot !== 'string' || !finite(answer.seq)) throw new DeckError('bot/incompatible', '服务器的 DS-Bot 远程 API 不兼容，请更新服务器或客户端。')
      const changedBoot = this.hello !== null && this.hello.boot !== answer.boot
      if (changedBoot) this.raw = null
      this.hello = { api: 1, boot: answer.boot, seq: answer.seq }
      this.authenticated = true
      const cursor = this.cursor.connect(this.hello)
      await this.poll()
      if (!this.current(active, generation)) return
      this.failures = 0; this.retryAt = null
      this.emit('hello', this.hello)
      void this.catchUp(active, generation, this.hello, cursor.sameBoot, cursor.since)
    } catch (error) {
      if (peer !== null && !this.current(peer, generation)) return
      this.peer = null; this.authenticated = false; this.generation += 1; this.stale = true
      if (peer) await peer.close().catch(() => {})
      this.error = safeMessage(error)
      this.emit('lost', {})
      if (errorCode(error) === 'bot/incompatible') { this.state = 'incompatible'; this.hooks.changed() }
      else if (FATAL.has(errorCode(error))) { this.state = 'needs-pairing'; this.hooks.changed() }
      else this.later()
      throw error
    }
  }
  private async catchUp(peer: Peer, generation: number, hello: { boot: string }, sameBoot: boolean, since: number): Promise<void> {
    try {
      const answer = record(await this.callPeer(peer, generation, 'notices', { boot: hello.boot, since }))
      if (!answer || !this.current(peer, generation)) return
      const result = this.cursor.acceptCatchUp(hello.boot, sameBoot, {
        boot: typeof answer.boot === 'string' ? answer.boot : undefined,
        seq: finite(answer.seq) ? answer.seq : undefined, reset: answer.reset === true,
        notices: Array.isArray(answer.notices) ? answer.notices : [],
      })
      if (result.reset) void this.poll()
      for (const entry of result.replay) this.onEvent({ event: 'notice', data: entry }, true)
    } catch {}
  }
  private onEvent(entry: PeerEvent, accepted = false): void {
    if (entry.event === 'notice' && this.hello) {
      if (!accepted && !this.cursor.acceptLive(this.hello.boot, entry.data)) return
      if (this.model.notice(entry.data, this.hello.boot)) {
        const notice = record(entry.data)
        if (notice?.kind === 'message' && notice.roomId === undefined && notice.taskId === undefined && this.hasBlockedBot(notice.botId)) this.fullState = true
        this.reproject(); this.hooks.changed()
      }
    }
    this.emit(entry.event, entry.data)
    if (['revision', 'live', 'room', 'notice'].includes(entry.event)) this.schedulePoll(300)
  }
  private schedulePoll(delay = 15000): void {
    if (!this.peer || !this.authenticated || this.stopped) return
    const due = Date.now() + delay
    if (this.pollTimer !== undefined && this.pollAt !== null && this.pollAt <= due) return
    clearTimeout(this.pollTimer); this.pollAt = due
    this.pollTimer = setTimeout(() => { this.pollTimer = undefined; this.pollAt = null; void this.poll() }, delay)
  }
  async poll(): Promise<void> {
    const peer = this.peer; const generation = this.generation
    if (!peer || !this.authenticated || this.stopped) return
    if (this.reading?.generation === generation) { this.readAgain = true; return this.reading.promise }
    this.readAgain = false
    // 重连或阻塞对象有新活动后核对真实快照，不在客户端删掉服务器阻塞。
    const full = this.fullState; this.fullState = false
    const since = !full && finite(this.raw?.revision) ? this.raw.revision : -1
    const stateOrder = this.stateReads + 1
    const promise: Promise<void> = this.callPeer(peer, generation, 'state', { since, avatars: 'ref', ...(since !== -1 && typeof this.raw?.liveKey === 'string' ? { live: this.raw.liveKey } : {}) })
      .then(() => {})
      .catch(error => {
        if (!this.current(peer, generation) || stateOrder < this.stateApplied) return
        this.stateApplied = stateOrder
        this.stale = true; this.error = '团队状态读取失败，保留缓存并按该服务器继续读取。'
        this.hooks.changed()
        if (FATAL.has(errorCode(error))) this.lost(peer, generation)
      })
      .finally(() => {
        if (this.reading?.promise === promise) this.reading = null
        if (!this.current(peer, generation)) return
        // 较新的增量回包可使旧请求失效，但只有实际应用的完整快照才能完成本次核对。
        const missedFull = since === -1 && this.stateFullApplied < stateOrder
        if (missedFull) this.fullState = true
        this.schedulePoll(this.readAgain || (missedFull && stateOrder < this.stateApplied) ? 300 : 15000)
      })
    this.reading = { generation, promise }
    return promise
  }
  // 返回是否实际应用了完整快照；旧版本与增量均不能完成全量核对。
  applyState(value: unknown, requireFull = false): boolean {
    const next = record(value)
    if (!next) throw new DeckError('bot/incompatible', '团队状态格式无效；保留缓存。')
    if (requireFull && next.unchanged === true) throw new DeckError('bot/incompatible', '服务器未返回完整团队状态；保留缓存。')
    if (this.raw && finite(this.raw.revision) && finite(next.revision) && next.revision < this.raw.revision) return false
    const merged = next.unchanged === true && this.raw ? { ...this.raw, ...next } : next
    const projected = this.model.project(merged, this.config.unfollowed)
    const verifyBlocked = next.unchanged === true && this.team?.entities.some(entity => entity.kind === 'bot' && entity.task === 'green' && this.hasBlockedBot(entity.id, merged) && projected.entities.some(current => current.key === entity.key && current.task === 'red')) === true
    const changed = this.stale || this.state !== 'ready' || this.error !== null || JSON.stringify(projected) !== JSON.stringify(this.team)
    this.raw = merged; this.team = projected; this.stale = false; this.state = 'ready'; this.error = null; this.lastSyncAt = Date.now()
    if (verifyBlocked) { this.fullState = true; this.schedulePoll(300) }
    if (changed) this.hooks.changed()
    return next.unchanged !== true
  }
  private async callPeer(peer: Peer, generation: number, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const stateOrder = endpoint === 'state' ? ++this.stateReads : 0
    const value = record(await peer.rpc<BotResult>('bot', { endpoint, payload }, { signal }))
    if (!this.current(peer, generation) || signal?.aborted) throw new DeckError('RPC_ABORTED', '该请求属于旧连接或已取消，没有自动重发。')
    if (!value || typeof value.ok !== 'boolean') throw new DeckError('bot/incompatible', '服务器回包格式不兼容。')
    if (!value.ok) {
      const error = record(value.error)
      throw new DeckError(typeof error?.code === 'string' ? error.code : 'bot/error', typeof error?.message === 'string' ? error.message.slice(0, 1000) : '服务器未完成请求。')
    }
    if (endpoint === 'state' && stateOrder >= this.stateApplied) {
      if (this.applyState(value.value, record(payload)?.since === -1)) this.stateFullApplied = stateOrder
      this.stateApplied = stateOrder
    }
    return value.value
  }
  async call(endpoint: string, payload: unknown, signal?: AbortSignal, token = this.token()): Promise<unknown> {
    const openingRead = ['hello', 'state', 'notices'].includes(endpoint)
    if (!token || !this.valid(token, !openingRead)) throw new DeckError('bot/read-only', '当前内容为缓存，连接恢复并确认状态后才能操作。')
    return this.callPeer(token.peer, token.generation, endpoint, payload, signal)
  }
  async disconnect(): Promise<void> {
    this.stopped = true; this.stopTimers()
    const peer = this.peer; this.peer = null; this.authenticated = false; this.generation += 1
    this.state = 'disconnected'; this.stale = true; this.error = null
    this.emit('lost', {}); this.hooks.changed()
    if (peer) await peer.close().catch(() => {})
  }
}
