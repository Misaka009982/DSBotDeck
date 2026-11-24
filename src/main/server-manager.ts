// SPDX-License-Identifier: Apache-2.0
// 只有主进程可以读取 Vault；对外快照严格排除身份、令牌和配对码。
import { randomUUID } from 'node:crypto'
import type { AppearanceSettings, ContentCommand, PetSettings, SavedClient, SavedServer, Selection, Snapshot, WindowState } from '../shared/domain.ts'
import { emptyCounts } from '../shared/domain.ts'
import { MAX_SERVERS, DeckError, command, record, selection, text, validServerId } from '../shared/validation.ts'
import { makePeer, newIdentity, pairingOffer } from './link-factory.ts'
import type { PeerEvent, PeerFactory } from './link-factory.ts'
import { ServerConnection } from './server-connection.ts'
import { Vault } from './vault.ts'
export class ServerManager {
  private readonly vault: Vault
  private readonly factory: PeerFactory
  private readonly connections = new Map<string, ServerConnection>()
  private readonly listeners = new Set<() => void>()
  private readonly startups = new Set<ReturnType<typeof setTimeout>>()
  private revision = 0
  private closing = false
  private chosen: Selection | null
  private active: string | null
  private navigation: ((serverId: string, command: ContentCommand) => void) | null = null
  readonly startupError: string | null
  constructor(vault: Vault, factory: PeerFactory = makePeer, startupError: string | null = null) {
    this.vault = vault; this.factory = factory; this.startupError = startupError
    const data = vault.snapshot(); this.chosen = data.selected; this.active = data.selected?.serverId ?? data.servers[0]?.id ?? null
    for (const config of data.servers) this.create(config)
  }
  private changed(): void { this.revision += 1; for (const listener of [...this.listeners]) listener() }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  setNavigation(handler: (serverId: string, command: ContentCommand) => void): void { this.navigation = handler }
  activeServer(): string | null { return this.active }
  petSettings(): PetSettings { return this.vault.petSettings() }
  appearanceSettings(): AppearanceSettings { return this.vault.snapshot().appearance }
  currentSelection(): Selection | null { return this.chosen === null ? null : { ...this.chosen } }
  connection(id: string): ServerConnection {
    const connection = this.connections.get(id)
    if (!validServerId(id) || !connection) throw new DeckError('bot/not-found', '此服务器不在客户端配置中。')
    return connection
  }
  private create(config: SavedServer): ServerConnection {
    const connection: ServerConnection = new ServerConnection(config, this.factory, {
      changed: () => this.changed(),
      paired: async () => {
        await this.vault.update(value => {
          const server = value.servers.find(item => item.id === config.id)
          if (server && server.identity.publicKey === config.identity.publicKey) server.paired = true
          return value
        })
        const saved = this.vault.snapshot().servers.find(item => item.id === config.id)
        if (saved && this.connections.get(config.id) === connection) connection.update(saved)
      },
    })
    this.connections.set(config.id, connection)
    return connection
  }
  start(): void {
    if (this.startupError) return
    this.vault.snapshot().servers.forEach((server, index) => {
      if (!server.paired || !server.autoConnect) return
      const timer = setTimeout(() => { this.startups.delete(timer); const connection = this.connections.get(server.id); if (!this.closing && connection) void connection.connect().catch(() => {}) }, index * 250)
      this.startups.add(timer)
    })
  }
  snapshot(): Snapshot {
    const servers = [...this.connections.values()].map(connection => connection.view())
    const tasks: Snapshot['tasks'] = []
    const counts = emptyCounts()
    for (const server of servers) for (const entity of server.team?.entities ?? []) {
      if (!entity.followed || entity.task === null) continue
      counts[entity.task] += 1
      tasks.push({ serverId: server.id, kind: entity.kind, id: entity.id, key: entity.key, title: entity.name, serverAlias: server.alias, color: entity.task, detail: entity.detail, cached: server.cached })
    }
    const local = this.vault.snapshot()
    const { builtinIcon, ...appearance } = local.appearance
    return { revision: this.revision, servers, activeServerId: this.active, selected: this.currentSelection(), pet: local.pet, appearance: { ...appearance, builtinIcon: builtinIcon ? { look: builtinIcon.look } : null }, tasks, counts, startupError: this.startupError }
  }
  async pair(input: unknown, alias: unknown, repairId?: unknown): Promise<string> {
    if (this.startupError) throw new DeckError('vault/unavailable', this.startupError)
    const offer = pairingOffer(input)
    const mode = offer.device === 'browser' ? 'browser' : 'phone'
    const before = this.vault.snapshot()
    let config: SavedServer
    if (repairId !== undefined && repairId !== null) {
      if (!validServerId(repairId)) throw new DeckError('bot/invalid', '重新配对的目标无效。')
      const saved = before.servers.find(server => server.id === repairId)
      if (!saved) throw new DeckError('bot/not-found', '重新配对的服务器不存在。')
      if (saved.hostKey !== offer.hostKey || saved.hostDeviceId !== offer.hostDeviceId || saved.relayUrl !== offer.server) throw new DeckError('bot/refused', '新配对码的主机身份或中转地址不同；请作为新服务器添加，不能隐式替换原目标。')
      if (saved.mode !== mode) throw new DeckError('bot/refused', '浏览器身份不能通过复用旧设备升级；请先在服务器撤销旧设备，再用手机配对码新添加客户端。')
      config = { ...saved, alias: text(alias, 80).trim() || saved.alias, autoConnect: true }
      await this.connection(saved.id).disconnect()
    } else {
      if (before.servers.length >= MAX_SERVERS) throw new DeckError('bot/invalid', `客户端最多保存 ${MAX_SERVERS} 台服务器。`)
      if (before.servers.some(server => server.hostDeviceId === offer.hostDeviceId && server.relayUrl === offer.server)) throw new DeckError('bot/invalid', '此服务器已经存在，请使用该行的连接或重新配对。')
      config = { id: randomUUID(), alias: text(alias, 80).trim() || offer.name || '远程 DS-Bot', relayUrl: offer.server, hostDeviceId: offer.hostDeviceId, hostKey: offer.hostKey, mode, identity: newIdentity(), paired: false, autoConnect: true, unfollowed: [] }
    }
    // 先保存设备身份再消费一次性配对码，后续网络失败不会造成无法恢复的已配对设备。
    await this.vault.update(value => {
      const index = value.servers.findIndex(server => server.id === config.id)
      if (index >= 0) value.servers[index] = config
      else {
        if (value.servers.length >= MAX_SERVERS || value.servers.some(server => server.hostDeviceId === config.hostDeviceId && server.relayUrl === config.relayUrl)) throw new DeckError('bot/invalid', '服务器已存在或数量已达上限，没有重复消费配对码。')
        value.servers.push(config)
      }
      return value
    })
    let connection = this.connections.get(config.id)
    if (connection) connection.update(config)
    else connection = this.create(config)
    this.active = config.id; this.changed()
    try { await connection.connect(offer.code) }
    finally {
      const main = connection.view().team?.entities.find(entity => entity.main) ?? connection.view().team?.entities[0]
      if (main) {
        this.chosen = { serverId: config.id, kind: main.kind, id: main.id }
        this.navigation?.(config.id, { action: 'chat', kind: main.kind, id: main.id }); this.changed()
      }
    }
    return config.id
  }
  async connect(id: string): Promise<void> {
    const connection = this.connection(id)
    await this.vault.update(value => { const server = value.servers.find(item => item.id === id); if (server) server.autoConnect = true; return value })
    const saved = this.vault.snapshot().servers.find(item => item.id === id)
    if (saved) connection.update(saved)
    await connection.connect()
  }
  async disconnect(id: string): Promise<void> {
    const connection = this.connection(id)
    await connection.disconnect()
    await this.vault.update(value => { const server = value.servers.find(item => item.id === id); if (server) server.autoConnect = false; return value })
    const saved = this.vault.snapshot().servers.find(item => item.id === id)
    if (saved) connection.update(saved)
  }
  async rename(id: string, alias: unknown): Promise<void> {
    const connection = this.connection(id)
    const name = text(alias, 80).trim()
    if (!name) throw new DeckError('bot/invalid', '服务器别名不能为空。')
    await this.vault.update(value => { const server = value.servers.find(item => item.id === id); if (server) server.alias = name; return value })
    const saved = this.vault.snapshot().servers.find(item => item.id === id)
    if (saved) connection.update(saved)
  }
  async forget(id: string): Promise<void> {
    const connection = this.connection(id)
    await connection.disconnect()
    await this.vault.update(value => { value.servers = value.servers.filter(server => server.id !== id); if (value.selected?.serverId === id) value.selected = null; return value })
    this.connections.delete(id)
    if (this.chosen?.serverId === id) this.chosen = null
    if (this.active === id) this.active = [...this.connections.keys()][0] ?? null
    this.changed()
  }
  async select(input: unknown): Promise<void> {
    const selected = selection(input)
    if (!selected) throw new DeckError('bot/invalid', '导航目标无效。')
    const view = this.connection(selected.serverId).view()
    if (!view.team?.entities.some(entity => entity.id === selected.id && entity.kind === selected.kind)) throw new DeckError('bot/not-found', '此对象不在当前可显示目录中；没有切换到其他服务器。')
    this.active = selected.serverId; this.chosen = selected; this.changed()
    this.navigation?.(selected.serverId, { action: 'chat', kind: selected.kind, id: selected.id })
    await this.vault.update(value => ({ ...value, selected }))
  }
  navigate(id: string, input: unknown): void {
    this.connection(id)
    const next = command(input)
    if (!next) throw new DeckError('bot/invalid', '界面操作无效。')
    this.active = id; this.changed(); this.navigation?.(id, next)
  }
  noteSelection(serverId: string, input: unknown): void {
    const chosen = selection({ ...record(input), serverId })
    if (!chosen || this.active !== serverId || !this.connection(serverId).view().team?.entities.some(entity => entity.kind === chosen.kind && entity.id === chosen.id)) return
    if (this.chosen?.serverId === serverId && this.chosen.kind === chosen.kind && this.chosen.id === chosen.id) return
    this.chosen = chosen; this.changed()
    void this.vault.update(value => ({ ...value, selected: chosen })).catch(() => {})
  }
  async follow(id: string, key: unknown, followed: unknown): Promise<void> {
    const connection = this.connection(id)
    if (typeof key !== 'string' || typeof followed !== 'boolean' || !connection.view().team?.entities.some(entity => entity.key === key)) throw new DeckError('bot/invalid', '关注对象无效。')
    await this.vault.update(value => {
      const server = value.servers.find(item => item.id === id)
      if (server) server.unfollowed = followed ? server.unfollowed.filter(item => item !== key) : [...new Set([...server.unfollowed, key])]
      return value
    })
    const saved = this.vault.snapshot().servers.find(item => item.id === id)
    if (saved) connection.update(saved)
  }
  async setPet(patch: Partial<PetSettings>): Promise<void> {
    await this.vault.update(value => ({ ...value, pet: { ...value.pet, ...patch } }))
    this.changed()
  }
  async setAppearance(patch: Partial<AppearanceSettings>): Promise<void> {
    await this.vault.update(value => ({ ...value, appearance: { ...value.appearance, ...patch } }))
    this.changed()
  }
  async saveWindow(window: WindowState): Promise<void> { await this.vault.update(value => ({ ...value, window })) }
  async stop(): Promise<void> {
    this.closing = true; for (const timer of this.startups) clearTimeout(timer); this.startups.clear()
    await Promise.all([...this.connections.values()].map(connection => connection.disconnect()))
    await this.vault.flush()
  }
}
