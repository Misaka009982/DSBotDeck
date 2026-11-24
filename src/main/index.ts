// SPDX-License-Identifier: Apache-2.0
// 仅管理本机窗口与远程连接，不启动 DSH、Agent 或 HTTP 服务。
import { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, safeStorage, screen, session, Tray } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import path from 'node:path'
import type { Bounds, BotResult, PetSettings } from '../shared/domain.ts'
import { DeckError, errorCode, record, safeMessage } from '../shared/validation.ts'
import { ContentViews } from './content-views.ts'
import { WindowsUnlock } from './native-unlock.ts'
import { PetWindow } from './pet-window.ts'
import { SCHEME, staticResponse } from './protocol.ts'
import { RequestGate } from './request-gate.ts'
import { ServerManager } from './server-manager.ts'
import { Vault } from './vault.ts'

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])
app.setName('DSBotDeck')
app.setPath('userData', path.join(app.getPath('appData'), 'DSBotDeck'))
app.setAppUserModelId('io.dsbotdeck.desktop')
const single = app.requestSingleInstanceLock()
if (!single || process.platform !== 'win32') app.quit()
else void app.whenReady().then(start).catch(() => { app.quit() })

function restore(value: Bounds | null): Bounds {
  const normal = value ?? { x: 0, y: 0, width: 1280, height: 900 }
  const area = screen.getDisplayMatching(normal).workArea
  const width = Math.min(Math.max(960, normal.width), area.width)
  const height = Math.min(Math.max(620, normal.height), area.height)
  return { x: Math.round(Math.max(area.x, Math.min(value?.x ?? area.x + (area.width - width) / 2, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(value?.y ?? area.y + (area.height - height) / 2, area.y + area.height - height))), width, height }
}
function petPatch(value: unknown): Partial<Pick<PetSettings, 'enabled' | 'locked' | 'alwaysOnTop'>> {
  const input = record(value)
  if (!input || Object.keys(input).some(key => !['enabled', 'locked', 'alwaysOnTop'].includes(key))) throw new DeckError('bot/invalid', '宠物设置无效。')
  const patch: Partial<Pick<PetSettings, 'enabled' | 'locked' | 'alwaysOnTop'>> = {}
  for (const key of ['enabled', 'locked', 'alwaysOnTop'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new DeckError('bot/invalid', '宠物设置必须为布尔值。')
    patch[key] = input[key]
  }
  return patch
}
async function result(action: () => Promise<unknown>): Promise<BotResult> {
  try { return { ok: true, value: await action() } }
  catch (error) { return { ok: false, error: { code: errorCode(error) || 'bot/error', message: safeMessage(error) } } }
}
async function start(): Promise<void> {
  const dist = path.join(app.getAppPath(), 'dist')
  const vault = new Vault(path.join(app.getPath('userData'), 'client.vault.json'), safeStorage)
  let startupError: string | null = null
  try { await vault.load() } catch (error) { startupError = safeMessage(error) }
  const manager = new ServerManager(vault, undefined, startupError)
  let window: BrowserWindow | null = null
  let views: ContentViews | null = null
  let tray: Tray | null = null
  let quitting = false
  let stopped = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const helper = app.isPackaged ? path.join(process.resourcesPath, 'native/windows-hello.ps1') : path.join(app.getAppPath(), 'native/windows-hello.ps1')
  const gate = new RequestGate(new WindowsUnlock(helper, () => window && !window.isDestroyed() ? window.getNativeWindowHandle() : null))
  const owns = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => !quitting && window?.webContents === event.sender && event.senderFrame === event.sender.mainFrame && !event.sender.isDestroyed()
  const saveWindow = async () => {
    if (!window || window.isDestroyed() || window.isMinimized() || window.isFullScreen() || startupError) return
    await manager.saveWindow(window.isMaximized() ? window.getNormalBounds() : window.getBounds())
  }
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { void saveWindow().catch(() => {}) }, 500) }
  const show = () => {
    if (window === null || window.isDestroyed()) createWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus(); views?.sync()
  }
  const pet = new PetWindow(manager, dist, show)
  function createWindow(): void {
    const created = new BrowserWindow({
      ...restore(vault.snapshot().window), minWidth: 960, minHeight: 620, show: false, title: 'DSBotDeck',
      icon: path.join(dist, 'assets/icon.ico'), titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', symbolColor: '#333333', height: 48 },
      backgroundColor: '#ffffff',
      webPreferences: { preload: path.join(dist, 'preload/shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
    })
    window = created
    created.setMenu(null)
    views = new ContentViews(created, manager, dist, gate, message => { if (!created.webContents.isDestroyed()) created.webContents.send('deck:view-error', message) })
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.on('will-navigate', (event, url) => { if (url !== `${SCHEME}://shell/index.html`) event.preventDefault() })
    created.webContents.on('will-attach-webview', event => event.preventDefault())
    created.on('move', scheduleSave); created.on('resize', scheduleSave)
    created.on('show', () => views?.sync())
    created.on('close', event => { if (!quitting) { event.preventDefault(); void saveWindow().catch(() => {}); created.hide() } })
    created.on('closed', () => { views?.close(); views = null; window = null })
    created.once('ready-to-show', () => { created.show(); views?.sync() })
    void created.loadURL(`${SCHEME}://shell/index.html`).catch(() => {})
  }
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url)
    if (url.protocol !== `${SCHEME}:` || !['shell', 'pet'].includes(url.hostname) || url.username || url.password) return new Response('不允许此来源', { status: 403 })
    if (url.pathname.startsWith('/api/')) return new Response('此页面没有远程 RPC 权限', { status: 403 })
    return staticResponse(path.join(dist, 'renderer'), url.pathname, request.method)
  })
  ipcMain.handle('deck:shell-snapshot', event => { if (!owns(event)) throw new DeckError('bot/refused', '拒绝非主窗口请求。'); return manager.snapshot() })
  ipcMain.handle('deck:shell-action', (event, packet: unknown) => result(async () => {
    if (!owns(event)) throw new DeckError('bot/refused', '拒绝非主窗口操作。')
    const data = record(packet); const args = record(data?.args) ?? {}
    const id = typeof args.serverId === 'string' ? args.serverId : ''
    switch (data?.action) {
      case 'pair': return manager.pair(args.uri, args.alias, args.repairId)
      case 'connect': return manager.connect(id)
      case 'disconnect': return manager.disconnect(id)
      case 'rename': return manager.rename(id, args.alias)
      case 'forget': await manager.forget(id); views?.remove(id); return null
      case 'select': return manager.select(data.args)
      case 'navigate': return manager.navigate(id, args.command)
      case 'follow': return manager.follow(id, args.key, args.followed)
      case 'pet': return manager.setPet(petPatch(data.args))
      case 'reopen': manager.connection(id); views?.reopen(id); return null
      case 'quit': app.quit(); return null
      default: throw new DeckError('bot/invalid', '不支持此本机操作。')
    }
  }))
  ipcMain.on('deck:viewport', (event, value: unknown) => { if (owns(event)) views?.viewport(value) })
  ipcMain.on('deck:overlay', (event, value: unknown) => { if (owns(event) && typeof value === 'boolean') views?.setOverlay(value) })
  ipcMain.on('deck:theme', (event, value: unknown) => {
    const colors = record(value)
    if (owns(event) && window && typeof colors?.color === 'string' && typeof colors.ink === 'string' && /^#[a-f\d]{6}$/i.test(colors.color) && /^#[a-f\d]{6}$/i.test(colors.ink)) {
      window.setTitleBarOverlay({ color: colors.color, symbolColor: colors.ink, height: 48 }); window.setBackgroundColor(colors.color)
    }
  })
  ipcMain.on('deck:content-ready', event => views?.ready(event))
  ipcMain.on('deck:content-selected', (event, value: unknown) => views?.selected(event, value))
  ipcMain.on('deck:content-viewed', (event, value: unknown) => views?.viewed(event, value))
  ipcMain.on('deck:content-task-viewed', (event, value: unknown) => views?.taskViewed(event, value))
  ipcMain.on('deck:pet-ready', event => pet.ready(event))
  ipcMain.on('deck:pet-regions', (event, value: unknown) => pet.updateRegions(event, value))
  ipcMain.on('deck:pet-drag-start', event => pet.startDrag(event))
  ipcMain.on('deck:pet-drag-end', event => { void pet.endDrag(event).catch(() => {}) })
  ipcMain.handle('deck:pet-action', (event, packet: unknown) => result(async () => {
    if (quitting || !pet.owns(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new DeckError('bot/refused', '拒绝非宠物窗口操作。')
    const data = record(packet)
    if (data?.action === 'prefs') return manager.setPet(petPatch(data.args))
    if (data?.action === 'open') { show(); return null }
    if (data?.action === 'select') { show(); return manager.select(data.args) }
    throw new DeckError('bot/invalid', '不支持此宠物操作。')
  }))
  const trayMenu = () => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 DSBotDeck', click: show },
      { label: manager.snapshot().pet.enabled ? '隐藏四色宠物' : '显示四色宠物', enabled: !startupError, click: () => { void manager.setPet({ enabled: !manager.snapshot().pet.enabled }).catch(() => {}) } },
      { type: 'separator' },
      { label: '退出客户端（不停止远程 Bot）', click: () => app.quit() },
    ]))
  }
  const image = nativeImage.createFromPath(path.join(dist, 'assets/tray.ico'))
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(path.join(dist, 'assets/icon.png')) : image)
  tray.setToolTip('DSBotDeck · 远程 DS-Bot'); tray.on('click', show); tray.on('double-click', show); trayMenu()
  manager.subscribe(() => { if (window && !window.webContents.isDestroyed()) window.webContents.send('deck:shell-snapshot', manager.snapshot()); views?.sync(); pet.sync(); trayMenu() })
  app.on('second-instance', show); app.on('activate', show)
  app.on('window-all-closed', () => {})
  app.on('before-quit', event => {
    if (stopped) return
    event.preventDefault()
    if (quitting) return
    quitting = true; clearTimeout(saveTimer)
    void saveWindow().catch(() => {}).then(() => manager.stop()).finally(() => { stopped = true; views?.close(); pet.close(); tray?.destroy(); tray = null; app.quit() })
  })
  createWindow(); manager.start(); pet.sync()
}
