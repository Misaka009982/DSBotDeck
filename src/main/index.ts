// SPDX-License-Identifier: Apache-2.0
// 仅管理本机窗口与远程连接，不启动 DSH、Agent 或 HTTP 服务。
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, safeStorage, screen, session, shell, Tray } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { AppearanceSettings, BotResult, PetSettings } from '../shared/domain.ts'
import { DeckError, errorCode, finite, iconPng, localMark, localPath, petSkin, record, safeMessage, savedAppearance, savedBuiltinIcon } from '../shared/validation.ts'
import { ContentViews } from './content-views.ts'
import { builtinIconBytes, LocalAssets, readImage } from './local-assets.ts'
import { WindowsUnlock } from './native-unlock.ts'
import { PetWindow } from './pet-window.ts'
import { SCHEME, staticResponse } from './protocol.ts'
import { RequestGate } from './request-gate.ts'
import { ServerManager } from './server-manager.ts'
import { Vault } from './vault.ts'
import { syncStartMenuIcon } from './shortcut-icon.ts'
import { minimumWindowSize, restoreWindowBounds, WindowStateTracker } from './window-state.ts'

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])
app.setName('DSBotDeck')
app.setPath('userData', path.join(app.getPath('appData'), 'DSBotDeck'))
app.setAppUserModelId('io.dsbotdeck.desktop')
const single = app.requestSingleInstanceLock()
if (!single || process.platform !== 'win32') app.quit()
else void app.whenReady().then(start).catch(() => { app.quit() })

function petPatch(value: unknown): Partial<Omit<PetSettings, 'position'>> {
  const input = record(value)
  if (!input || Object.keys(input).some(key => !['enabled', 'locked', 'alwaysOnTop', 'skin', 'size', 'mark'].includes(key))) throw new DeckError('bot/invalid', '宠物设置无效。')
  const patch: Partial<Omit<PetSettings, 'position'>> = {}
  for (const key of ['enabled', 'locked', 'alwaysOnTop'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new DeckError('bot/invalid', '宠物设置必须为布尔值。')
    patch[key] = input[key]
  }
  if (input.skin !== undefined) patch.skin = petSkin(input.skin)
  if (input.mark !== undefined) patch.mark = localMark(input.mark)
  if (input.size !== undefined) {
    if (!finite(input.size) || input.size < 72 || input.size > 144) throw new DeckError('bot/invalid', '宠物尺寸须在 72 到 144 之间。')
    patch.size = Math.round(input.size)
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
  const assets = new LocalAssets(path.join(homedir(), '.codex', 'pets'))
  await assets.refresh(manager.appearanceSettings(), manager.petSettings().skin)
  let window: BrowserWindow | null = null
  let views: ContentViews | null = null
  let tray: Tray | null = null
  let quitting = false
  let stopped = false
  let windowState: WindowStateTracker | null = null
  let localQueue: Promise<unknown> = Promise.resolve()
  let iconSignature = ''
  const localAction = (action: () => Promise<unknown>): Promise<unknown> => { const next = localQueue.then(action); localQueue = next.catch(() => {}); return next }
  const helper = app.isPackaged ? path.join(process.resourcesPath, 'native/windows-hello.ps1') : path.join(app.getAppPath(), 'native/windows-hello.ps1')
  const gate = new RequestGate(new WindowsUnlock(helper, () => window && !window.isDestroyed() ? window.getNativeWindowHandle() : null))
  const owns = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => !quitting && window?.webContents === event.sender && event.senderFrame === event.sender.mainFrame && !event.sender.isDestroyed()
  const saveWindow = async () => { await windowState?.flush() }
  const windowSaveFailed = (error: unknown) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('deck:view-error', safeMessage(error))
  }
  const show = () => {
    if (window === null || window.isDestroyed()) createWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus(); views?.sync()
  }
  const openSettings = () => { show(); window?.webContents.send('deck:open-settings') }
  const pet = new PetWindow(manager, dist, show, openSettings)
  pet.updateAssets(assets.view('pet'))
  const publishAssets = () => {
    if (window && !window.webContents.isDestroyed()) window.webContents.send('deck:local-assets', assets.view('shell'))
    pet.updateAssets(assets.view('pet')); views?.sync()
  }
  const applyIcon = async () => {
    const bytes = assets.iconNeedsRaster() ? null : assets.iconBytes()
    const source = manager.appearanceSettings().iconPath
    const signature = bytes ? createHash('sha256').update(bytes).digest('hex') : 'default'
    if (signature === iconSignature) return
    let image = bytes ? nativeImage.createFromBuffer(bytes) : nativeImage.createFromPath(path.join(dist, 'assets/icon.png'))
    if (image.isEmpty() && source && bytes) image = nativeImage.createFromPath(source)
    if (image.isEmpty()) image = nativeImage.createFromPath(path.join(dist, 'assets/icon.png'))
    // 开始菜单由系统读取图标，默认图标必须指向真实 EXE，不能使用 asar 内路径。
    let iconPath = app.isPackaged ? process.execPath : path.join(dist, 'assets/icon.ico')
    if (bytes && !image.isEmpty()) {
      // 每张图片使用独立 ICO 路径，让 Windows 快捷方式缓存能区分新旧图标。
      const folder = path.join(app.getPath('userData'), 'appearance')
      await mkdir(folder, { recursive: true })
      if ((await lstat(folder)).isSymbolicLink()) throw new DeckError('asset/refused', '图标缓存目录不能是链接。')
      iconPath = path.join(folder, `deck-${signature}.ico`)
      try { if ((await lstat(iconPath)).isSymbolicLink()) throw new DeckError('asset/refused', '图标缓存不能是链接。') } catch (error) { if (record(error)?.code !== 'ENOENT') throw error }
      const png = image.resize({ width: 256, height: 256 }).toPNG()
      const header = Buffer.alloc(22)
      header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18)
      await writeFile(iconPath, Buffer.concat([header, png]))
    }
    if (window && !window.isDestroyed()) { window.setIcon(image); window.setAppDetails({ appId: 'io.dsbotdeck.desktop', appIconPath: iconPath, appIconIndex: 0 }) }
    tray?.setImage(bytes ? image.resize({ width: 20, height: 20 }) : nativeImage.createFromPath(path.join(dist, 'assets/tray.ico')))
    let shortcutSynced = true
    if (app.isPackaged && !assets.iconNeedsRaster()) {
      const roots = [app.getPath('appData'), ...(process.env.ProgramData ? [process.env.ProgramData] : [])]
      shortcutSynced = await syncStartMenuIcon(roots, process.execPath, iconPath, shell)
      if (!shortcutSynced) assets.warn('开始菜单图标未能同步，请检查快捷方式权限；窗口和托盘图标仍已应用。')
    }
    iconSignature = shortcutSynced ? signature : ''
  }
  const refreshAssets = async () => {
    await assets.refresh(manager.appearanceSettings(), manager.petSettings().skin)
    try { await applyIcon() }
    catch (error) { assets.warn('图标未能完整应用，请检查本机图片和客户端缓存目录权限。'); throw error }
    finally { publishAssets() }
  }
  const chooseAsset = async (kind: unknown) => {
    if (!window || !['icon', 'background', 'pets'].includes(String(kind))) throw new DeckError('bot/invalid', '本机素材类型无效。')
    const picked = await dialog.showOpenDialog(window, kind === 'pets'
      ? { title: '选择 Codex 宠物合集目录', properties: ['openDirectory'] }
      : { title: kind === 'icon' ? '选择 Deck 图标' : '选择 Deck 背景', properties: ['openFile'], filters: [{ name: '本机图片', extensions: kind === 'icon' ? ['png', 'jpg', 'jpeg', 'webp', 'ico'] : ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (picked.canceled || !picked.filePaths[0]) return null
    const selected = localPath(picked.filePaths[0])
    if (!selected) return null
    if (kind !== 'pets') {
      const asset = await readImage(selected, kind === 'icon')
      // WebP 由 Chromium 解码；nativeImage 不支持它，窗口图标随后使用本机栅格化 PNG。
      if (asset.type !== 'image/webp') {
        const image = nativeImage.createFromPath(selected)
        if (image.isEmpty() || image.getSize().width * image.getSize().height > 40_000_000) throw new DeckError('asset/invalid', '图片无法解码或尺寸过大；原设置未修改。')
      }
    }
    const patch: Partial<AppearanceSettings> = kind === 'icon' ? { iconPath: selected, builtinIcon: null } : kind === 'background' ? { backgroundPath: selected, backgroundCrop: null } : { petLibraryPath: selected }
    await manager.setAppearance(patch); await refreshAssets()
    return null
  }
  function createWindow(): void {
    const saved = vault.snapshot().window
    const area = (saved ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay()).workArea
    const minimum = minimumWindowSize(area)
    const created = new BrowserWindow({
      ...restoreWindowBounds(saved, area), minWidth: minimum.width, minHeight: minimum.height, show: false, title: 'DSBotDeck',
      icon: path.join(dist, 'assets/icon.ico'), titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#333333', height: 48 },
      backgroundColor: '#ffffff',
      webPreferences: { preload: path.join(dist, 'preload/shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
    })
    window = created
    windowState = new WindowStateTracker(created, async state => { if (!startupError) await manager.saveWindow(state) }, windowSaveFailed)
    created.setMenu(null)
    views = new ContentViews(created, manager, dist, gate, message => { if (!created.webContents.isDestroyed()) created.webContents.send('deck:view-error', message) }, () => assets.hasBackground())
    iconSignature = ''
    void localAction(applyIcon).catch(() => { assets.warn('图标缓存未能应用；请检查客户端数据目录权限。'); publishAssets() })
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.on('will-navigate', (event, url) => { if (url !== `${SCHEME}://shell/index.html`) event.preventDefault() })
    created.webContents.on('will-attach-webview', event => event.preventDefault())
    created.on('move', () => {
      if (created.isMinimized() || created.isFullScreen()) return
      const next = minimumWindowSize(screen.getDisplayMatching(created.getBounds()).workArea)
      const [width, height] = created.getMinimumSize()
      if (width !== next.width || height !== next.height) created.setMinimumSize(next.width, next.height)
    })
    created.on('show', () => views?.sync())
    created.on('close', event => { if (!quitting) { event.preventDefault(); void saveWindow().catch(windowSaveFailed); created.hide() } })
    created.on('closed', () => { windowState?.dispose(); windowState = null; views?.close(); views = null; window = null })
    created.once('ready-to-show', () => { if (saved?.maximized) created.maximize(); created.show(); views?.sync() })
    void created.loadURL(`${SCHEME}://shell/index.html`).catch(() => {})
  }
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url)
    if (url.protocol !== `${SCHEME}:` || !['shell', 'pet'].includes(url.hostname) || url.username || url.password) return new Response('不允许此来源', { status: 403 })
    if (url.pathname.startsWith('/api/')) return new Response('此页面没有远程 RPC 权限', { status: 403 })
    if (url.pathname.startsWith('/local/')) {
      const origin = request.headers.get('origin')
      if (origin && origin !== `${SCHEME}://${url.hostname}`) return new Response('拒绝跨来源素材请求', { status: 403 })
      return assets.response(url.hostname === 'shell' ? 'shell' : 'pet', url.pathname, request.method)
    }
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
      case 'pet': return localAction(async () => {
        const patch = petPatch(data.args)
        if (patch.skin && !assets.view('shell').pets.some(entry => entry.key === patch.skin && entry.available)) throw new DeckError('asset/invalid', '所选宠物不在可用合集中，请先刷新目录。')
        const changedSkin = patch.skin !== undefined && patch.skin !== manager.petSettings().skin
        await manager.setPet(patch)
        if (changedSkin) await refreshAssets()
      })
      case 'assets': return assets.view('shell')
      case 'icon-raster': return localAction(async () => {
        if (args.revision !== assets.view('shell').revision || !assets.iconNeedsRaster()) return null
        const bytes = builtinIconBytes(iconPng(args.png))
        const image = nativeImage.createFromBuffer(bytes)
        if (image.isEmpty() || image.getSize().width !== 256 || image.getSize().height !== 256) throw new DeckError('asset/invalid', '本机 WebP 图标无法解码。')
        if (assets.setIconRaster(String(args.revision), bytes)) {
          try { await applyIcon() } finally { publishAssets() }
        }
      })
      case 'builtin-icon': return localAction(async () => {
        const icon = savedBuiltinIcon(data.args)
        if (!icon) throw new DeckError('asset/invalid', '请选择内置图标。')
        const image = nativeImage.createFromBuffer(builtinIconBytes(icon.png))
        const size = image.getSize()
        if (image.isEmpty() || size.width !== 256 || size.height !== 256) throw new DeckError('asset/invalid', '内置图标无法解码；原图标未修改。')
        await manager.setAppearance({ iconPath: null, builtinIcon: icon }); await refreshAssets()
      })
      case 'choose-asset': return localAction(() => chooseAsset(args.kind))
      case 'refresh-assets': return localAction(refreshAssets)
      case 'reset-asset': return localAction(async () => {
        if (!['icon', 'background', 'pets'].includes(String(args.kind))) throw new DeckError('bot/invalid', '不能重置此素材。')
        await manager.setAppearance(args.kind === 'icon' ? { iconPath: null, builtinIcon: null } : args.kind === 'background' ? { backgroundPath: null, backgroundCrop: null } : { petLibraryPath: null })
        await refreshAssets()
      })
      case 'appearance': return localAction(async () => {
        if (Object.keys(args).some(key => !['opacity', 'blur', 'fit', 'language', 'backgroundCrop'].includes(key))) throw new DeckError('bot/invalid', '图片与目录只能由本机选择器授权。')
        const next = savedAppearance({ ...manager.appearanceSettings(), ...args })
        await manager.setAppearance(next)
      })
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
      window.setTitleBarOverlay({ color: '#00000000', symbolColor: colors.ink, height: 48 }); window.setBackgroundColor(colors.color)
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
    if (data?.action === 'settings') { pet.showSettings(); return null }
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
    quitting = true
    const saving = saveWindow(); windowState?.dispose()
    void saving.catch(windowSaveFailed).then(() => localQueue).then(() => manager.stop()).finally(() => { stopped = true; views?.close(); pet.close(); tray?.destroy(); tray = null; app.quit() })
  })
  createWindow(); manager.start(); pet.sync()
}
