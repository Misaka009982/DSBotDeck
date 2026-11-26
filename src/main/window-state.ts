// SPDX-License-Identifier: Apache-2.0
// 就绪后显式恢复布局，再立即捕获有效状态；未变化时不重复写盘。
import type { Bounds, WindowState } from '../shared/domain.ts'
import { bounds } from '../shared/validation.ts'
import { diagnosticErrorCode, notifyDiagnostic } from './window-diagnostics.ts'
import type { WindowDiagnosticObserver, WindowDiagnosticRecord, WindowSaveReason } from './window-diagnostics.ts'
interface WindowPort {
  isDestroyed(): boolean
  isMinimized(): boolean
  isFullScreen(): boolean
  isMaximized(): boolean
  getBounds(): Bounds
  getNormalBounds(): Bounds
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}
interface WindowRestorePort {
  isDestroyed(): boolean
  getBounds(): Bounds
  setMinimumSize(width: number, height: number): void
  setBounds(rectangle: Bounds, animate: boolean): void
  maximize(): void
}
interface WindowTrackerOptions { initialSize?: { width: number; height: number }; onSize?: () => void }
const sameBounds = (a: Bounds, b: Bounds): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
const sameWindowState = (a: WindowState, b: WindowState | null): boolean => b !== null && sameBounds(a, b) && a.maximized === b.maximized
export function minimumWindowSize(area: Bounds): { width: number; height: number } {
  return { width: Math.min(480, Math.floor(area.width / 2)), height: Math.min(320, Math.floor(area.height / 2)) }
}
export function restoreWindowBounds(value: Bounds | null, area: Bounds): Bounds {
  const normal = value ?? { x: 0, y: 0, width: 1280, height: 900 }
  const minimum = minimumWindowSize(area)
  const width = Math.min(Math.max(minimum.width, normal.width), area.width)
  const height = Math.min(Math.max(minimum.height, normal.height), area.height)
  return { x: Math.round(Math.max(area.x, Math.min(value?.x ?? area.x + (area.width - width) / 2, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(value?.y ?? area.y + (area.height - height) / 2, area.y + area.height - height))), width, height }
}
export function restoreWindowLayout(window: WindowRestorePort, value: WindowState | null, area: Bounds, diagnostic?: WindowDiagnosticObserver): void {
  if (window.isDestroyed()) return
  const minimum = minimumWindowSize(area); const target = restoreWindowBounds(value, area)
  const report = { saved: value, target, minimum }
  notifyDiagnostic(diagnostic, { event: 'restore-start', ...report })
  window.setMinimumSize(minimum.width, minimum.height)
  notifyDiagnostic(diagnostic, { event: 'restore-minimum', ...report })
  let requested = { ...target }; let actual: Bounds | null = null; let calls = 0
  let best: { requested: Bounds; actual: Bounds; distance: number; excess: number } | null = null
  const tried: Bounds[] = []
  const measure = (): Bounds | null => { try { return bounds(window.getBounds()) } catch { return null } }
  // 分数DPI和原生边框会使设置与读取不互逆；按实测差值校准，不写死像素扣减。
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (window.isDestroyed()) return
    const previous = actual
    tried.push({ ...requested }); window.setBounds({ ...requested }, false); calls++
    notifyDiagnostic(diagnostic, { event: 'restore-bounds', ...report, requested, attempt: calls })
    if (window.isDestroyed()) return
    actual = measure()
    if (!actual) break
    const distance = Math.abs(actual.x - target.x) + Math.abs(actual.y - target.y) + Math.abs(actual.width - target.width) + Math.abs(actual.height - target.height)
    const excess = Math.max(0, actual.width - target.width) + Math.max(0, actual.height - target.height)
    if (!best || distance < best.distance || distance === best.distance && excess < best.excess) best = { requested: { ...requested }, actual, distance, excess }
    if (sameBounds(actual, target) || previous && sameBounds(actual, previous) || attempt === 4) break
    const next = { x: requested.x + target.x - actual.x, y: requested.y + target.y - actual.y, width: Math.max(1, requested.width + target.width - actual.width), height: Math.max(1, requested.height + target.height - actual.height) }
    if (tried.some(value => sameBounds(value, next))) break
    requested = next
    notifyDiagnostic(diagnostic, { event: 'restore-correction', ...report, requested, attempt: calls + 1 })
  }
  if (window.isDestroyed()) return
  // 遇到原生最小尺寸或不可表示的DIP时有限退出，等距优先不扩大，并恢复最佳观测值。
  if (best && actual && !sameBounds(actual, best.actual)) {
    requested = best.requested; window.setBounds({ ...requested }, false); calls++
    notifyDiagnostic(diagnostic, { event: 'restore-bounds', ...report, requested, attempt: calls })
    if (window.isDestroyed()) return
    actual = measure()
  }
  if (!actual || !sameBounds(actual, target)) notifyDiagnostic(diagnostic, { event: 'restore-unmatched', ...report, requested, attempt: calls })
  if (value?.maximized) { window.maximize(); notifyDiagnostic(diagnostic, { event: 'restore-maximize', ...report }) }
  notifyDiagnostic(diagnostic, { event: 'restore-complete', ...report })
}
export class WindowStateTracker {
  private readonly window: WindowPort
  private readonly save: (state: WindowState, reason: WindowSaveReason) => Promise<void>
  private readonly failed: (error: unknown) => void
  private state: WindowState | null = null
  private persisted: WindowState | null = null
  private size: { width: number; height: number } = { width: 1280, height: 900 }
  private sizeRevision = 0
  private userResizing = false
  private readonly onSize: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()
  private readonly events = ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'leave-full-screen'] as const
  private readonly listeners = this.events.map(event => ({ event, listener: () => this.schedule(event) }))
  private readonly diagnostic: WindowDiagnosticObserver | undefined
  private lastEvent: WindowSaveReason = 'none'
  private windowWriteId = 0
  constructor(window: WindowPort, save: (state: WindowState, reason: WindowSaveReason) => Promise<void>, failed: (error: unknown) => void = () => {}, persisted: WindowState | null = null, diagnostic?: WindowDiagnosticObserver, options: WindowTrackerOptions = {}) {
    this.window = window; this.save = save; this.failed = failed; this.diagnostic = diagnostic; this.onSize = options.onSize
    this.persisted = persisted ? { ...persisted } : null
    const initial = persisted ?? options.initialSize ?? (window.isDestroyed() ? null : bounds(window.isMaximized() ? window.getNormalBounds() : window.getBounds()))
    if (initial) this.size = { width: initial.width, height: initial.height }
    this.capture('tracker-init')
    for (const { event, listener } of this.listeners) window.on(event, listener)
  }
  userSize(): { width: number; height: number } { return { ...this.size } }
  userSizeRevision(): number { return this.sizeRevision }
  beginUserResize(value: Bounds): void {
    if (!this.acceptUserBounds(value, 'user-resize')) return
    this.userResizing = true
  }
  finishUserResize(): void {
    if (!this.userResizing) return
    this.userResizing = false
    if (this.window.isDestroyed() || this.window.isMinimized() || this.window.isFullScreen()) return
    this.acceptUserBounds(this.window.getBounds(), 'user-resize-end')
  }
  setUserBounds(value: Bounds): void {
    this.userResizing = false
    this.acceptUserBounds(value, 'window-layout')
  }
  private acceptUserBounds(value: Bounds, reason: WindowSaveReason): boolean {
    if (this.window.isDestroyed() || this.window.isMinimized() || this.window.isFullScreen() || this.window.isMaximized()) return false
    const rectangle = bounds(value)
    if (!rectangle) return false
    const before = this.state
    if (rectangle.width !== this.size.width || rectangle.height !== this.size.height) this.sizeRevision += 1
    this.size = { width: rectangle.width, height: rectangle.height }
    this.state = { ...rectangle, maximized: false }; this.lastEvent = reason
    this.report({ event: 'tracker-capture', reason, before, after: this.state })
    this.clearTimer(); this.timer = setTimeout(() => { this.timer = undefined; void this.write(reason).catch(this.failed) }, 500)
    try { this.onSize?.() } catch { /* 设置显示失败不能改变用户尺寸或配置保存。 */ }
    return true
  }
  private report(entry: WindowDiagnosticRecord): void {
    notifyDiagnostic(this.diagnostic, { captured: this.state, persisted: this.persisted, lastEvent: this.lastEvent, ...entry })
  }
  private capture(reason: WindowSaveReason): void {
    const window = this.window
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) { this.report({ event: 'tracker-capture-skipped', reason }); return }
    const before = this.state
    const maximized = window.isMaximized()
    // 贴靠使用当前矩形；只有最大化时使用还原矩形。
    const rectangle = bounds(maximized ? window.getNormalBounds() : window.getBounds())
    // 自动事件只更新位置；尺寸只有用户拖拽或设置入口能改，避免原生读写偏差反馈。
    if (rectangle) this.state = { x: rectangle.x, y: rectangle.y, ...this.size, maximized }
    this.report({ event: rectangle ? 'tracker-capture' : 'tracker-capture-skipped', reason, before, after: this.state })
  }
  private readonly schedule = (reason: WindowSaveReason): void => {
    this.lastEvent = reason; this.capture(reason); this.clearTimer()
    this.timer = setTimeout(() => { this.timer = undefined; void this.write(reason).catch(this.failed) }, 500)
  }
  private write(reason: WindowSaveReason): Promise<void> {
    if (!this.state) { this.report({ event: 'tracker-write-skipped', reason }); return this.writing }
    const state = { ...this.state }
    const report = { reason, captured: state, lastEvent: this.lastEvent, windowWriteId: ++this.windowWriteId }
    this.report({ event: 'tracker-write-queued', ...report })
    // 在写队列内比较，避免相同刷新重复写入，也不遗漏待写变更后的回退。
    const next = this.writing.then(async () => {
      if (sameWindowState(state, this.persisted)) { this.report({ event: 'tracker-write-skipped', ...report }); return }
      this.report({ event: 'tracker-write-start', ...report })
      await this.save(state, reason)
      this.persisted = state
      this.report({ event: 'tracker-write-success', ...report })
    }).catch(error => { this.report({ event: 'tracker-write-failed', ...report, errorCode: diagnosticErrorCode(error) }); throw error })
    this.writing = next.catch(() => {})
    return next
  }
  flush(reason: WindowSaveReason = 'flush'): Promise<void> {
    this.clearTimer(); this.capture(reason)
    return this.write(reason)
  }
  dispose(): void {
    this.clearTimer(); this.userResizing = false
    for (const { event, listener } of this.listeners) this.window.removeListener(event, listener)
    this.report({ event: 'tracker-dispose' })
  }
  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined }
}
