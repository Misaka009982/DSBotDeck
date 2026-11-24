// SPDX-License-Identifier: Apache-2.0
// 主进程按原生桌面坐标采样和拖动，锁定规则不能由旧 renderer 消息解除。
import { BrowserWindow, screen } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron'
import path from 'node:path'
import type { Bounds, LocalAssetsView, Point } from '../shared/domain.ts'
import { dragBounds, petInteractive, petRegion, petRegions } from '../shared/pet-geometry.ts'
import type { PetRegions } from '../shared/pet-geometry.ts'
import { PET_CANVAS, legacyPetAnchor, petBodySize, placePet } from '../shared/pet-layout.ts'
import type { PetLayoutMessage, PetPlacement } from '../shared/pet-layout.ts'
import { record } from '../shared/validation.ts'
import { ServerManager } from './server-manager.ts'
import { SCHEME } from './protocol.ts'
export class PetWindow {
  private readonly manager: ServerManager
  private readonly dist: string
  private window: BrowserWindow | null = null
  private regions: PetRegions = { body: null, controls: [] }
  private layout: PetLayoutMessage | null = null
  private layoutKey = ''
  private layoutRevision = 0
  private sampling: ReturnType<typeof setInterval> | undefined
  private dragging: { start: Point; origin: Bounds } | null = null
  private interactive = false
  private readonly openMain: () => void
  private readonly openSettings: () => void
  private assets: LocalAssetsView | null = null
  constructor(manager: ServerManager, dist: string, openMain: () => void, openSettings: () => void) { this.manager = manager; this.dist = dist; this.openMain = openMain; this.openSettings = openSettings }
  updateAssets(value: LocalAssetsView): void { this.assets = value; if (this.window && !this.window.webContents.isDestroyed()) this.window.webContents.send('deck:pet-assets', value) }
  owns(contents: WebContents): boolean { return this.window?.webContents === contents && !contents.isDestroyed() }
  private locate(anchor: Point, size = this.manager.petSettings().size): PetPlacement {
    const body = petBodySize(size)
    const area = screen.getDisplayNearestPoint({ x: Math.round(anchor.x + body.width / 2), y: Math.round(anchor.y + body.height / 2) }).workArea
    return placePet(anchor, size, area, this.layout?.side ?? null)
  }
  private currentAnchor(): Point | null {
    if (!this.window || this.window.isDestroyed() || !this.layout) return null
    const bounds = this.window.getBounds(); const body = this.layout.body
    return { x: bounds.x + body.x, y: bounds.y + body.y }
  }
  private applyPlacement(value: PetPlacement, publish = true): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    const key = JSON.stringify(value.layout); const changed = key !== this.layoutKey
    if (changed) {
      this.layoutKey = key; this.layoutRevision += 1
      this.layout = { ...value.layout, revision: this.layoutRevision }
      this.regions = { body: null, controls: [] }
      // 新布局确认前不复用旧控件区；正在拖动则保留原生指针捕获。
      if (!this.dragging) { this.interactive = false; window.setIgnoreMouseEvents(true, { forward: true }) }
    }
    const current = window.getBounds(); const next = value.bounds
    if (current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height) window.setBounds(next, false)
    if (changed && publish && !window.webContents.isDestroyed()) window.webContents.send('deck:pet-layout', this.layout)
  }
  private create(): void {
    const prefs = this.manager.petSettings()
    const area = screen.getPrimaryDisplay().workArea
    const placement = this.locate(legacyPetAnchor(prefs.position ?? { x: area.x + area.width - PET_CANVAS.width - 16, y: area.y + area.height - PET_CANVAS.height - 16 }, prefs.size), prefs.size)
    const window = new BrowserWindow({
      ...placement.bounds, show: false, title: 'DSBotDeck 四色宠物', frame: false, transparent: true,
      backgroundColor: '#00000000', resizable: false, maximizable: false, minimizable: false,
      hasShadow: false, skipTaskbar: true, alwaysOnTop: prefs.alwaysOnTop,
      webPreferences: { preload: path.join(this.dist, 'preload/pet.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
    })
    this.window = window
    this.applyPlacement(placement, false)
    window.setMenu(null); window.setIgnoreMouseEvents(true, { forward: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== `${SCHEME}://pet/pet.html`) event.preventDefault() })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.once('ready-to-show', () => { if (this.manager.petSettings().enabled) window.showInactive(); this.sync() })
    window.on('closed', () => { if (this.window === window) this.window = null; clearInterval(this.sampling); this.sampling = undefined; this.dragging = null; this.regions = { body: null, controls: [] }; this.layout = null; this.layoutKey = '' })
    void window.loadURL(`${SCHEME}://pet/pet.html`).catch(() => {})
    this.sampling = setInterval(() => this.sample(), 32)
  }
  sync(): void {
    const prefs = this.manager.petSettings()
    if (!prefs.enabled) { this.hide(); return }
    if (this.window === null) { this.create(); return }
    if (this.window.isDestroyed()) return
    const anchor = this.currentAnchor()
    if (anchor && this.layout) {
      if (this.layout.size !== prefs.size) {
        const body = petBodySize(prefs.size)
        anchor.x += this.layout.body.width - body.width; anchor.y += this.layout.body.height - body.height
        this.dragging = null
      }
      this.applyPlacement(this.locate(anchor, prefs.size))
    }
    this.window.setAlwaysOnTop(prefs.alwaysOnTop)
    if (prefs.locked) this.dragging = null
    if (!this.window.isVisible()) this.window.showInactive()
    this.window.webContents.send('deck:pet-snapshot', this.manager.snapshot())
    this.sample()
  }
  ready(event: IpcMainEvent): void { if (this.owns(event.sender) && event.senderFrame === event.sender.mainFrame) { event.sender.send('deck:pet-snapshot', this.manager.snapshot()); event.sender.send('deck:pet-assets', this.assets); if (this.layout) event.sender.send('deck:pet-layout', this.layout) } }
  updateRegions(event: IpcMainEvent, value: unknown): void {
    if (!this.owns(event.sender) || event.senderFrame !== event.sender.mainFrame || !this.layout || record(value)?.layoutRevision !== this.layout.revision) return
    const regions = petRegions(value)
    if (regions) { this.regions = regions; this.sample() }
  }
  private sample(): void {
    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return
    const cursor = screen.getCursorScreenPoint(); const prefs = this.manager.petSettings(); const locked = prefs.locked
    if (locked) this.dragging = null
    const anchor = this.dragging ? dragBounds(this.dragging.origin, this.dragging.start, cursor) : this.currentAnchor()
    if (anchor) this.applyPlacement(this.locate(anchor, prefs.size))
    const bounds = window.getBounds(); const local = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
    const region = petRegion(this.regions, local)
    const interactive = this.dragging !== null || petInteractive(region, locked)
    if (interactive !== this.interactive) { this.interactive = interactive; window.setIgnoreMouseEvents(!interactive, { forward: true }) }
    if (this.layout) window.webContents.send('deck:pet-pointer', { ...local, layoutRevision: this.layout.revision })
  }
  startDrag(event: IpcMainEvent): void {
    if (!this.owns(event.sender) || event.senderFrame !== event.sender.mainFrame || !this.window || !this.layout || this.manager.petSettings().locked) return
    const cursor = screen.getCursorScreenPoint(); const bounds = this.window.getBounds(); const body = this.layout.body
    if (petRegion(this.regions, { x: cursor.x - bounds.x, y: cursor.y - bounds.y }) !== 'body') return
    this.dragging = { start: cursor, origin: { ...body, x: bounds.x + body.x, y: bounds.y + body.y } }; this.sample()
  }
  async endDrag(event: IpcMainEvent): Promise<void> {
    if (!this.owns(event.sender) || event.senderFrame !== event.sender.mainFrame || !this.window || this.dragging === null) return
    this.dragging = null
    const anchor = this.currentAnchor()
    if (!anchor) return
    const current = this.locate(anchor); this.applyPlacement(current)
    await this.manager.setPet({ position: current.position }); this.sample()
  }
  showMain(): void { this.openMain() }
  showSettings(): void { this.openSettings() }
  hide(): void { if (this.window && !this.window.isDestroyed()) this.window.hide(); this.dragging = null }
  close(): void { clearInterval(this.sampling); this.sampling = undefined; this.window?.destroy(); this.window = null }
}
