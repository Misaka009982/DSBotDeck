// SPDX-License-Identifier: Apache-2.0
// 主进程按原生桌面坐标采样和拖动，锁定规则不能由旧 renderer 消息解除。
import { BrowserWindow, screen } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron'
import path from 'node:path'
import type { Bounds, LocalAssetsView, Point } from '../shared/domain.ts'
import { dragBounds, petInteractive, petRegion, petRegions } from '../shared/pet-geometry.ts'
import type { PetRegions } from '../shared/pet-geometry.ts'
import { ServerManager } from './server-manager.ts'
import { SCHEME } from './protocol.ts'
const SIZE = { width: 380, height: 440 }
export class PetWindow {
  private readonly manager: ServerManager
  private readonly dist: string
  private window: BrowserWindow | null = null
  private regions: PetRegions = { body: null, controls: [] }
  private sampling: ReturnType<typeof setInterval> | undefined
  private dragging: { start: Point; origin: Bounds } | null = null
  private interactive = false
  private readonly openMain: () => void
  private readonly openSettings: () => void
  private assets: LocalAssetsView | null = null
  constructor(manager: ServerManager, dist: string, openMain: () => void, openSettings: () => void) { this.manager = manager; this.dist = dist; this.openMain = openMain; this.openSettings = openSettings }
  updateAssets(value: LocalAssetsView): void { this.assets = value; if (this.window && !this.window.webContents.isDestroyed()) this.window.webContents.send('deck:pet-assets', value) }
  owns(contents: WebContents): boolean { return this.window?.webContents === contents && !contents.isDestroyed() }
  private safe(point: Point): Point {
    const area = screen.getDisplayNearestPoint({ x: point.x + SIZE.width - 60, y: point.y + SIZE.height - 50 }).workArea
    return { x: Math.round(Math.max(area.x - SIZE.width + 120, Math.min(point.x, area.x + area.width - SIZE.width))), y: Math.round(Math.max(area.y - SIZE.height + 120, Math.min(point.y, area.y + area.height - SIZE.height))) }
  }
  private create(): void {
    const prefs = this.manager.petSettings()
    const area = screen.getPrimaryDisplay().workArea
    const origin = this.safe(prefs.position ?? { x: area.x + area.width - SIZE.width - 16, y: area.y + area.height - SIZE.height - 16 })
    const window = new BrowserWindow({
      ...SIZE, ...origin, show: false, title: 'DSBotDeck 四色宠物', frame: false, transparent: true,
      backgroundColor: '#00000000', resizable: false, maximizable: false, minimizable: false,
      hasShadow: false, skipTaskbar: true, alwaysOnTop: prefs.alwaysOnTop,
      webPreferences: { preload: path.join(this.dist, 'preload/pet.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
    })
    this.window = window
    window.setMenu(null); window.setIgnoreMouseEvents(true, { forward: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== `${SCHEME}://pet/pet.html`) event.preventDefault() })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.once('ready-to-show', () => { if (this.manager.petSettings().enabled) window.showInactive(); this.sync() })
    window.on('closed', () => { if (this.window === window) this.window = null; clearInterval(this.sampling); this.sampling = undefined; this.dragging = null; this.regions = { body: null, controls: [] } })
    void window.loadURL(`${SCHEME}://pet/pet.html`).catch(() => {})
    this.sampling = setInterval(() => this.sample(), 32)
  }
  sync(): void {
    const prefs = this.manager.petSettings()
    if (!prefs.enabled) { this.hide(); return }
    if (this.window === null) { this.create(); return }
    if (this.window.isDestroyed()) return
    this.window.setAlwaysOnTop(prefs.alwaysOnTop)
    if (prefs.locked) this.dragging = null
    if (!this.window.isVisible()) this.window.showInactive()
    this.window.webContents.send('deck:pet-snapshot', this.manager.snapshot())
    this.sample()
  }
  ready(event: IpcMainEvent): void { if (this.owns(event.sender) && event.senderFrame === event.sender.mainFrame) { event.sender.send('deck:pet-snapshot', this.manager.snapshot()); event.sender.send('deck:pet-assets', this.assets) } }
  updateRegions(event: IpcMainEvent, value: unknown): void {
    if (!this.owns(event.sender) || event.senderFrame !== event.sender.mainFrame) return
    const regions = petRegions(value)
    if (regions) { this.regions = regions; this.sample() }
  }
  private sample(): void {
    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return
    const cursor = screen.getCursorScreenPoint(); const locked = this.manager.petSettings().locked
    if (this.dragging && !locked) {
      const next = dragBounds(this.dragging.origin, this.dragging.start, cursor)
      window.setPosition(next.x, next.y, false)
    }
    const bounds = window.getBounds(); const local = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
    const region = petRegion(this.regions, local)
    const interactive = this.dragging !== null || petInteractive(region, locked)
    if (interactive !== this.interactive) { this.interactive = interactive; window.setIgnoreMouseEvents(!interactive, { forward: true }) }
    window.webContents.send('deck:pet-pointer', local)
  }
  startDrag(event: IpcMainEvent): void {
    if (!this.owns(event.sender) || !this.window || this.manager.petSettings().locked) return
    const cursor = screen.getCursorScreenPoint(); const bounds = this.window.getBounds()
    if (petRegion(this.regions, { x: cursor.x - bounds.x, y: cursor.y - bounds.y }) !== 'body') return
    this.dragging = { start: cursor, origin: bounds }; this.sample()
  }
  async endDrag(event: IpcMainEvent): Promise<void> {
    if (!this.owns(event.sender) || !this.window || this.dragging === null) return
    this.dragging = null
    const current = this.safe(this.window.getBounds()); this.window.setPosition(current.x, current.y, false)
    await this.manager.setPet({ position: current }); this.sample()
  }
  showMain(): void { this.openMain() }
  showSettings(): void { this.openSettings() }
  hide(): void { if (this.window && !this.window.isDestroyed()) this.window.hide(); this.dragging = null }
  close(): void { clearInterval(this.sampling); this.sampling = undefined; this.window?.destroy(); this.window = null }
}
