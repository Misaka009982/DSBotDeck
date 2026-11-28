// SPDX-License-Identifier: Apache-2.0
// 每台服务器使用独立 partition 与协议闭包；页面不拿到主窗口特权。
import { randomUUID } from 'node:crypto'
import { WebContentsView, session, shell } from 'electron'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import path from 'node:path'
import type { ContentCommand, ContentStatus, Selection } from '../shared/domain.ts'
import { command, record, validEntityId } from '../shared/validation.ts'
import { clientHandler, readReceiptKey, SCHEME } from './protocol.ts'
import type { ReadReceipt } from './protocol.ts'
import { RequestGate } from './request-gate.ts'
import { ServerManager } from './server-manager.ts'
interface Entry {
  instance: string
  view: WebContentsView
  ready: boolean
  failed: boolean
  drafts: boolean
  pending: ContentCommand | null
  receipts: Map<string, ReadReceipt>
}
export class ContentViews {
  private readonly window: BrowserWindow
  private readonly manager: ServerManager
  private readonly dist: string
  private readonly gate: RequestGate
  private readonly entries = new Map<string, Entry>()
  private readonly protocols = new Set<string>()
  private current: string | null = null
  private activation = 0
  private overlay = false
  private rectangle = { x: 280, y: 0, width: 600, height: 700 }
  private readonly report: (message: string | null) => void
  private readonly localBackground: () => boolean
  constructor(window: BrowserWindow, manager: ServerManager, dist: string, gate: RequestGate, report: (message: string | null) => void, localBackground: () => boolean = () => false) {
    this.window = window; this.manager = manager; this.dist = dist; this.gate = gate; this.report = report; this.localBackground = localBackground
    manager.setNavigation((id, packet) => this.navigate(id, packet))
    window.on('hide', () => { this.activation += 1; this.sync() })
    window.on('minimize', () => { this.activation += 1; this.sync() })
    window.on('restore', () => this.sync())
  }
  active(id: string): boolean {
    const entry = this.entries.get(id)
    return this.current === id && !this.overlay && !this.window.isDestroyed() && this.window.isVisible() && !this.window.isMinimized() && entry !== undefined && !entry.failed
  }
  private target(id: string): Selection | null {
    const selected = this.manager.currentSelection()
    return selected?.serverId === id ? selected : null
  }
  private create(id: string): Entry {
    const isolated = session.fromPartition(`persist:dsbotdeck-server-${id}`)
    isolated.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' && this.entries.get(id)?.view.webContents === contents && this.active(id)))
    isolated.setPermissionCheckHandler((contents, permission) => permission === 'clipboard-sanitized-write' && this.entries.get(id)?.view.webContents === contents && this.active(id))
    if (!this.protocols.has(id)) {
      isolated.protocol.handle(SCHEME, clientHandler({
        host: id, root: path.join(this.dist, 'remote'), connection: () => this.manager.connection(id), gate: this.gate,
        active: () => this.active(id), instance: () => this.entries.get(id)?.instance ?? null,
        context: () => { const opening = this.activation; const entry = this.entries.get(id); return () => this.activation === opening && this.entries.get(id) === entry && this.active(id) },
        renderedTarget: () => this.target(id),
        read: (receipt, instance) => { const entry = this.entries.get(id); if (entry?.instance === instance) entry.receipts.set(readReceiptKey(receipt), receipt) },
      }))
      this.protocols.add(id)
    }
    const view = new WebContentsView({ webPreferences: {
      session: isolated, preload: path.join(this.dist, 'preload/content.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
    } })
    view.setBackgroundColor('#00000000')
    const entry: Entry = { instance: randomUUID(), view, ready: false, failed: false, drafts: false, pending: null, receipts: new Map() }
    this.entries.set(id, entry)
    this.window.contentView.addChildView(view)
    view.setVisible(false)
    view.webContents.setZoomFactor(1)
    const own = `${SCHEME}://${id}/${entry.instance}/`
    view.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(own)) event.preventDefault() })
    view.webContents.on('will-redirect', (event, url) => { if (!url.startsWith(own)) event.preventDefault() })
    view.webContents.on('will-attach-webview', event => event.preventDefault())
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (this.active(id) && /^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
    view.webContents.on('render-process-gone', () => {
      const lostDrafts = entry.drafts
      entry.failed = true; entry.ready = false; entry.drafts = false; entry.receipts.clear(); view.setVisible(false)
      if (this.current === id) this.report(lostDrafts ? '此服务器界面进程已停止，内存中的编辑、附件和待确认记录已丢失；已提交的保存或消息仍可能完成。可重新打开界面后核对服务器记录。' : '此服务器的界面进程已停止，目录和连接仍保留；请点击“重新打开界面”恢复。')
    })
    view.webContents.on('did-fail-load', (_event, _code, _description, _url, mainFrame) => {
      if (!mainFrame) return
      entry.failed = true; view.setVisible(false)
      if (this.current === id) this.report('本地 DS-Bot 界面加载失败，请检查客户端构建；没有重启远程 Bot。')
    })
    void view.webContents.loadURL(`${own}index.html`).catch(() => { entry.failed = true; view.setVisible(false); this.report('本地界面无法加载，请先完成客户端构建。') })
    return entry
  }
  private status(id: string): ContentStatus {
    const server = this.manager.connection(id).view()
    const appearance = this.manager.appearanceSettings()
    return { mode: server.mode, cached: server.cached, active: this.active(id), viewEpoch: this.activation, state: server.state, alias: server.alias, error: server.error, lastSyncAt: server.lastSyncAt, localBackground: this.localBackground(), uiLanguage: appearance.language, uiTheme: { theme: appearance.theme, themeMode: appearance.themeMode } }
  }
  sync(): void {
    if (this.window.isDestroyed()) return
    const next = this.manager.activeServer()
    if (next !== this.current) this.activation += 1
    this.current = next
    for (const [id, entry] of this.entries) {
      if (id !== next || this.overlay || entry.failed) entry.view.setVisible(false)
      if (entry.ready && !entry.view.webContents.isDestroyed()) {
        try { entry.view.webContents.send('deck:content-status', this.status(id)) } catch {}
      }
    }
    if (next === null || this.overlay) return
    const entry = this.entries.get(next) ?? this.create(next)
    if (!entry.failed) { entry.view.setBounds(this.rectangle); entry.view.setVisible(this.active(next)); this.report(null) }
    else this.report('此服务器的界面暂不可用，请显式重新打开界面。')
    // 已打开页面随服务器保留；后台暂停正文读取，不按最近两页淘汰会话与草稿。
  }
  viewport(value: unknown): void {
    const data = record(value)
    if (!data || !['x', 'y', 'width', 'height'].every(key => typeof data[key] === 'number' && Number.isFinite(data[key]))) return
    const content = this.window.getContentBounds()
    const x = Math.max(0, Math.min(content.width, Math.round(Number(data.x))))
    const y = Math.max(0, Math.min(content.height, Math.round(Number(data.y))))
    this.rectangle = { x, y, width: Math.max(1, Math.min(content.width - x, Math.round(Number(data.width)))), height: Math.max(1, Math.min(content.height - y, Math.round(Number(data.height)))) }
    const entry = this.current ? this.entries.get(this.current) : undefined
    if (entry && !entry.failed) entry.view.setBounds(this.rectangle)
  }
  setOverlay(value: boolean): void { if (this.overlay !== value) this.activation += 1; this.overlay = value; this.sync() }
  navigate(id: string, value: unknown): void {
    const packet = command(value)
    if (!packet) return
    this.activation += 1
    this.current = id; this.sync()
    const entry = this.entries.get(id)
    if (!entry) return
    if (packet.action === 'chat') entry.receipts.clear()
    if (entry.ready && !entry.failed) { entry.view.webContents.send('deck:content-command', packet); entry.view.webContents.focus() }
    else entry.pending = packet
  }
  private owner(event: IpcMainEvent): [string, Entry] | null {
    if (event.senderFrame !== event.sender.mainFrame) return null
    for (const item of this.entries) if (item[1].view.webContents === event.sender && !event.sender.isDestroyed()) return item
    return null
  }
  ready(event: IpcMainEvent): void {
    const owned = this.owner(event)
    if (!owned) return
    const [id, entry] = owned; entry.ready = true
    event.sender.send('deck:content-status', this.status(id))
    const selected = this.target(id)
    const packet = entry.pending ?? (selected ? { action: 'chat' as const, kind: selected.kind, id: selected.id } : null)
    entry.pending = null
    if (packet) event.sender.send('deck:content-command', packet)
  }
  selected(event: IpcMainEvent, value: unknown): void {
    const owned = this.owner(event)
    if (!owned || !this.active(owned[0])) return
    const before = this.manager.currentSelection()
    this.manager.noteSelection(owned[0], value)
    const after = this.manager.currentSelection()
    if (before?.serverId !== after?.serverId || before?.kind !== after?.kind || before?.id !== after?.id) { this.activation += 1; this.sync() }
  }
  viewed(event: IpcMainEvent, value: unknown): void {
    const owned = this.owner(event); const data = record(value)
    if (!owned || !data || !this.active(owned[0]) || !this.window.isFocused() || !validEntityId(data.id)) return
    const [id, entry] = owned; const receiptKey = `chat:${data.kind}:${data.id}`; const receipt = entry.receipts.get(receiptKey)
    const selected = this.target(id)
    if (!receipt || !selected || receipt.kind !== data.kind || receipt.id !== data.id || selected.kind !== receipt.kind || selected.id !== receipt.id) return
    const connection = this.manager.connection(id)
    if (!connection.valid(receipt.token)) return
    connection.acknowledge(receipt.key, receipt.pending); entry.receipts.delete(receiptKey)
  }
  taskViewed(event: IpcMainEvent, value: unknown): void {
    const owned = this.owner(event); const data = record(value)
    if (!owned || !data || !this.active(owned[0]) || !this.window.isFocused() || !validEntityId(data.botId) || !validEntityId(data.taskId)) return
    const [id, entry] = owned; const receiptKey = `task:${data.botId}\0${data.taskId}`; const receipt = entry.receipts.get(receiptKey)
    if (!receipt || receipt.botId !== data.botId || receipt.taskId !== data.taskId) return
    const connection = this.manager.connection(id)
    if (!connection.valid(receipt.token)) return
    connection.acknowledge(receipt.key, receipt.pending, data.taskId); entry.receipts.delete(receiptKey)
  }
  hasDrafts(id?: string): boolean { return id === undefined ? [...this.entries.values()].some(entry => entry.drafts) : this.entries.get(id)?.drafts === true }
  drafts(event: IpcMainEvent, value: unknown): void {
    const owned = this.owner(event)
    if (owned && typeof value === 'boolean') owned[1].drafts = value
  }
  reopen(id: string): void {
    if (this.hasDrafts(id)) { this.report('此服务器有未保存的编辑、聊天附件或待确认记录，请先在对应栏处理或明确丢弃。'); return }
    this.remove(id); if (this.current === id) this.sync()
  }
  remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (id === this.current) this.activation += 1
    this.entries.delete(id)
    this.window.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }
  close(): void {
    for (const id of [...this.entries.keys()]) this.remove(id)
    for (const id of this.protocols) session.fromPartition(`persist:dsbotdeck-server-${id}`).protocol.unhandle(SCHEME)
    this.protocols.clear()
  }
}
