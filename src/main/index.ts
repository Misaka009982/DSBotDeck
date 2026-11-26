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
import { PetWindow } from './pet-window.ts'
import { SCHEME, staticResponse } from './protocol.ts'
import { RequestGate } from './request-gate.ts'
import { ServerManager } from './server-manager.ts'
import { Vault } from './vault.ts'
import { syncStartMenuIcon } from './shortcut-icon.ts'
import { icoFile } from './icon-format.ts'
import { minimumWindowSize, restoreWindowBounds, restoreWindowLayout, WindowStateTracker } from './window-state.ts'
import { windowGeometry, WindowDiagnostics } from './window-diagnostics.ts'
import type { WindowDiagnosticRecord, WindowSaveReason } from './window-diagnostics.ts'
import { windowLayoutRequest, windowLayoutTarget } from '../shared/window-layout.ts'
import type { WindowLayoutView } from '../shared/window-layout.ts'

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
  const vaultFile = path.join(app.getPath('userData'), 'client.vault.json')
  const diagnostics = new WindowDiagnostics(path.join(app.getPath('userData'), 'diagnostics/window-state.jsonl'), app.getVersion())
  diagnostics.record({ event: 'session-start' })
  const vault = new Vault(vaultFile, safeStorage, entry => diagnostics.record(entry))
  let startupError: string | null = null
  try { await vault.load() } catch (error) { startupError = safeMessage(error) }
  const stopWatching = diagnostics.watchConfiguration(vaultFile)
  const manager = new ServerManager(vault, undefined, startupError)
  const assets = new LocalAssets(path.join(homedir(), '.codex', 'pets'))
  await assets.refresh(manager.appearanceSettings(), manager.petSettings().skin)
  let window: BrowserWindow | null = null
  let windowReady = false
  let pendingSettings = false
  let views: ContentViews | null = null
  let tray: Tray | null = null
  let quitting = false
  let stopped = false
  let diagnosticsStopped = false
  let windowState: WindowStateTracker | null = null
  let localQueue: Promise<unknown> = Promise.resolve()
  let iconSignature = ''
  const localAction = (action: () => Promise<unknown>): Promise<unknown> => { const next = localQueue.then(action); localQueue = next.catch(() => {}); return next }
  // 标准客户端按原配对与服务器权限执行，不额外要求 Windows Hello。
  const gate = new RequestGate()
  const owns = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => !quitting && window?.webContents === event.sender && event.senderFrame === event.sender.mainFrame && !event.sender.isDestroyed()
  const traceWindow = (entry: WindowDiagnosticRecord, subject: BrowserWindow | null = window): void => {
    try {
      diagnostics.record({ ...entry, saved: entry.saved === undefined ? vault.windowState() : entry.saved, windowId: entry.windowId ?? (subject && !subject.isDestroyed() ? subject.id : undefined), geometry: subject ? windowGeometry(subject, rectangle => screen.getDisplayMatching(rectangle), rectangle => screen.dipToScreenRect(subject, rectangle)) : null, ready: windowReady, quitting })
    } catch { /* 原生观测不可用时，不影响窗口操作。 */ }
  }
  const displayListeners = {
    metricsChanged: () => traceWindow({ event: 'display-metrics-changed' }),
    added: () => traceWindow({ event: 'display-added' }),
    removed: () => traceWindow({ event: 'display-removed' }),
  }
  // Electron按具体事件名声明重载，显式绑定保留SDK的类型检查。
  screen.on('display-metrics-changed', displayListeners.metricsChanged)
  screen.on('display-added', displayListeners.added)
  screen.on('display-removed', displayListeners.removed)
  const saveWindow = async (reason: WindowSaveReason) => { await windowState?.flush(reason) }
  const windowLayoutView = (subject: BrowserWindow): WindowLayoutView => {
    const rectangle = subject.getBounds(); const display = screen.getDisplayMatching(rectangle)
    const [width, height] = subject.getMinimumSize()
    return { bounds: rectangle, userSize: windowState?.userSize() ?? { width: rectangle.width, height: rectangle.height }, sizeRevision: windowState?.userSizeRevision() ?? 0, workArea: display.workArea, minimum: { width, height }, scaleFactor: display.scaleFactor }
  }
  const publishWindowLayout = (subject: BrowserWindow) => {
    if (window !== subject || !windowReady || subject.isDestroyed() || subject.webContents.isDestroyed()) return
    subject.webContents.send('deck:window-layout', windowLayoutView(subject))
  }
  const windowSaveFailed = (error: unknown) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('deck:view-error', safeMessage(error))
  }
  const show = () => {
    traceWindow({ event: 'window-show-request' })
    if (window === null || window.isDestroyed()) createWindow()
    if (!window || !windowReady) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus(); views?.sync()
    traceWindow({ event: 'window-show-complete' })
  }
  const openSettings = () => {
    show()
    if (!windowReady) pendingSettings = true
    else window?.webContents.send('deck:open-settings')
  }
  const pet = new PetWindow(manager, dist, show, openSettings)
  pet.updateAssets(assets.view('pet'))
  const publishAssets = () => {
    if (window && !window.webContents.isDestroyed()) window.webContents.send('deck:local-assets', assets.view('shell'))
    pet.updateAssets(assets.view('pet')); views?.sync()
  }
  const applyIcon = async (force = false) => {
    const bytes = assets.iconNeedsRaster() ? null : assets.iconBytes()
    const source = manager.appearanceSettings().iconPath
    const signature = bytes ? createHash('sha256').update(bytes).digest('hex') : 'default'
    if (!force && signature === iconSignature) return
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
      await writeFile(iconPath, icoFile([{ size: 256, png }]))
    }
    if (window && !window.isDestroyed()) {
      traceWindow({ event: 'window-icon-before' })
      window.setIcon(image); window.setAppDetails({ appId: 'io.dsbotdeck.desktop', appIconPath: iconPath, appIconIndex: 0 })
      traceWindow({ event: 'window-icon-after' })
    }
    tray?.setImage(bytes ? image.resize({ width: 20, height: 20 }) : nativeImage.createFromPath(path.join(dist, 'assets/tray.ico')))
    let shortcutSynced = true
    if (app.isPackaged && !assets.iconNeedsRaster()) {
      const roots = [app.getPath('appData'), ...(process.env.ProgramData ? [process.env.ProgramData] : [])]
      shortcutSynced = await syncStartMenuIcon(roots, process.execPath, iconPath, shell)
      if (!shortcutSynced) assets.warn('开始菜单图标未能同步，请检查快捷方式权限；窗口和托盘图标仍已应用。')
    }
    iconSignature = shortcutSynced ? signature : ''
  }
  const refreshAssets = async (forceIcon = false) => {
    await assets.refresh(manager.appearanceSettings(), manager.petSettings().skin)
    try { await applyIcon(forceIcon) }
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
      // 构造只用默认尺寸，保存矩形在原生窗口就绪后显式恢复。
      ...restoreWindowBounds(null, area), minWidth: minimum.width, minHeight: minimum.height, show: false, title: 'DSBotDeck',
      icon: path.join(dist, 'assets/icon.ico'), titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#333333', height: 48 },
      backgroundColor: '#ffffff',
      webPreferences: { preload: path.join(dist, 'preload/shell.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
    })
    window = created; windowReady = false
    const windowId = created.id
    const report = (entry: WindowDiagnosticRecord): void => traceWindow({ ...entry, windowId }, created)
    report({ event: 'window-created', saved, target: restoreWindowBounds(null, area), minimum })
    const recordEvent = (reason: WindowSaveReason) => () => report({ event: 'window-event', reason })
    created.on('move', recordEvent('move'))
    created.on('resize', recordEvent('resize'))
    created.on('maximize', recordEvent('maximize'))
    created.on('unmaximize', recordEvent('unmaximize'))
    created.on('minimize', recordEvent('minimize'))
    created.on('restore', recordEvent('restore'))
    created.on('enter-full-screen', recordEvent('enter-full-screen'))
    created.on('leave-full-screen', recordEvent('leave-full-screen'))
    created.on('show', recordEvent('show'))
    created.on('hide', recordEvent('hide'))
    created.on('focus', recordEvent('focus'))
    created.on('blur', recordEvent('blur'))
    created.on('ready-to-show', recordEvent('ready-to-show'))
    report({ event: 'window-menu-before' })
    created.setMenu(null)
    report({ event: 'window-menu-after' })
    views = new ContentViews(created, manager, dist, gate, message => { if (!created.webContents.isDestroyed()) created.webContents.send('deck:view-error', message) }, () => assets.hasBackground())
    iconSignature = ''
    void localAction(applyIcon).catch(() => { assets.warn('图标缓存未能应用；请检查客户端数据目录权限。'); publishAssets() })
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.on('will-navigate', (event, url) => { if (url !== `${SCHEME}://shell/index.html`) event.preventDefault() })
    created.webContents.on('will-attach-webview', event => event.preventDefault())
    created.on('move', () => {
      if (created.isMinimized() || created.isFullScreen() || created.isMaximized()) return
      const current = created.getBounds()
      const target = minimumWindowSize(screen.getDisplayMatching(current).workArea)
      // 更新约束不能在用户停下后把现有外框主动撑大。
      const next = { width: Math.min(target.width, current.width), height: Math.min(target.height, current.height) }
      const [width, height] = created.getMinimumSize()
      if (width !== next.width || height !== next.height) {
        report({ event: 'window-minimum-before', minimum: next })
        created.setMinimumSize(next.width, next.height)
        report({ event: 'window-minimum-after', minimum: next })
      }
      publishWindowLayout(created)
    })
    created.on('will-resize', (_event, rectangle) => { if (!quitting && window === created && windowReady) windowState?.beginUserResize(rectangle) })
    created.on('resized', () => { if (!quitting && window === created && windowReady) windowState?.finishUserResize() })
    created.on('show', () => views?.sync())
    created.on('close', event => { report({ event: 'window-close', reason: 'close' }); if (!quitting) { event.preventDefault(); void saveWindow('close').catch(windowSaveFailed); created.hide() } })
    created.on('closed', () => { report({ event: 'window-closed' }); windowState?.dispose(); windowState = null; windowReady = false; views?.close(); views = null; window = null })
    created.once('ready-to-show', () => {
      if (quitting || window !== created || created.isDestroyed()) return
      report({ event: 'window-ready', saved })
      const restoredArea = screen.getDisplayMatching(saved ?? created.getBounds()).workArea
      restoreWindowLayout(created, saved, restoredArea, report)
      // 恢复后才记录；启动期间的默认矩形和程序性移动不覆盖旧保存值。
      windowState = new WindowStateTracker(created, async (state, reason) => { if (!startupError) await manager.saveWindow(state, reason) }, windowSaveFailed, saved, report, { initialSize: restoreWindowBounds(null, restoredArea), onSize: () => publishWindowLayout(created) })
      windowReady = true
      created.show(); views?.sync()
      report({ event: 'window-show-complete' })
      if (pendingSettings) { pendingSettings = false; created.webContents.send('deck:open-settings') }
    })
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
      case 'pair':
        if (typeof args.repairId === 'string' && views?.hasDrafts(args.repairId)) throw new DeckError('bot/refused', '重新配对前请先处理或丢弃该服务器的未保存文件编辑。')
        return manager.pair(args.uri, args.alias, args.repairId)
      case 'connect': return manager.connect(id)
      case 'disconnect': return manager.disconnect(id)
      case 'rename': return manager.rename(id, args.alias)
      case 'forget':
        if (views?.hasDrafts(id)) throw new DeckError('bot/refused', '移除服务器前请先处理或丢弃其未保存文件编辑。')
        await manager.forget(id); views?.remove(id); return null
      case 'select': return manager.select(data.args)
      case 'navigate': return manager.navigate(id, args.command)
      case 'follow': return manager.follow(id, args.key, args.followed)
      case 'window-layout': return localAction(async (): Promise<WindowLayoutView> => {
        if (!owns(event)) throw new DeckError('bot/refused', '窗口请求已过期。')
        const request = windowLayoutRequest(data?.args)
        const subject = window
        if (!subject || !windowReady || subject.isDestroyed()) throw new DeckError('bot/refused', '窗口尚未就绪。')
        const current = subject.getBounds(); const display = screen.getDisplayMatching(current)
        if (request) {
          if (startupError) throw new DeckError('vault/unavailable', startupError)
          if (subject.isFullScreen()) throw new DeckError('bot/refused', '请先退出全屏，再调整窗口布局。')
          const target = windowLayoutTarget(request, current, display.workArea)
          traceWindow({ event: 'window-layout-request', reason: 'window-layout', target }, subject)
          if (subject.isMaximized()) subject.unmaximize()
          restoreWindowLayout(subject, { ...target, maximized: false }, display.workArea, entry => traceWindow(entry, subject))
          windowState?.setUserBounds(restoreWindowBounds(target, display.workArea))
          await saveWindow('window-layout')
          if (!owns(event) || window !== subject || subject.isDestroyed()) throw new DeckError('bot/refused', '窗口已关闭，未返回旧布局。')
        }
        return windowLayoutView(subject)
      })
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
      case 'refresh-assets': return localAction(() => refreshAssets(true))
      case 'reset-asset': return localAction(async () => {
        if (!['icon', 'background', 'pets'].includes(String(args.kind))) throw new DeckError('bot/invalid', '不能重置此素材。')
        await manager.setAppearance(args.kind === 'icon' ? { iconPath: null, builtinIcon: null } : args.kind === 'background' ? { backgroundPath: null, backgroundCrop: null } : { petLibraryPath: null })
        await refreshAssets()
      })
      case 'appearance': return localAction(async () => {
        if (Object.keys(args).some(key => !['opacity', 'blur', 'fit', 'language', 'backgroundCrop', 'theme', 'themeMode'].includes(key))) throw new DeckError('bot/invalid', '图片与目录只能由本机选择器授权。')
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
      traceWindow({ event: 'window-theme-before', overlayHeight: 48 })
      window.setTitleBarOverlay({ color: '#00000000', symbolColor: colors.ink, height: 48 }); window.setBackgroundColor(colors.color)
      traceWindow({ event: 'window-theme-after', overlayHeight: 48 })
    }
  })
  ipcMain.on('deck:content-drafts', (event, value: unknown) => views?.drafts(event, value))
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
      { label: '打开窗口诊断日志文件夹', click: () => {
        if (quitting) return
        void diagnostics.flush().then(async () => {
          const error = await shell.openPath(path.dirname(diagnostics.file))
          if (error || diagnostics.problem) dialog.showErrorBox('窗口诊断日志', '诊断日志未能写入或打开，请检查本机客户端数据目录的权限；原配置不会因此被重置。')
        }).catch(() => dialog.showErrorBox('窗口诊断日志', '未能打开诊断目录，请检查当前用户的目录权限。'))
      } },
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
    if (views?.hasDrafts() && dialog.showMessageBoxSync({ type: 'warning', title: '仍有文件编辑未处理',
      message: '未保存的编辑只保留在内存，退出会丢失；待确认的服务器保存不会因退出而撤销。',
      buttons: ['返回处理', '放弃本地内容并退出'], defaultId: 0, cancelId: 0, noLink: true }) !== 1) return
    quitting = true
    traceWindow({ event: 'window-close', reason: 'before-quit' })
    const saving = saveWindow('before-quit'); windowState?.dispose()
    void saving.catch(windowSaveFailed).then(() => localQueue).then(() => manager.stop()).finally(() => { stopped = true; views?.close(); pet.close(); tray?.destroy(); tray = null; app.quit() })
  })
  app.on('will-quit', event => {
    if (diagnosticsStopped) return
    event.preventDefault(); stopWatching()
    screen.removeListener('display-metrics-changed', displayListeners.metricsChanged)
    screen.removeListener('display-added', displayListeners.added)
    screen.removeListener('display-removed', displayListeners.removed)
    diagnostics.record({ event: 'session-stop', saved: vault.windowState() })
    void diagnostics.flush().finally(() => { diagnosticsStopped = true; app.quit() })
  })
  createWindow(); manager.start(); pet.sync()
}
