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
  setMinimumSize(width: number, height: number): void
  setBounds(rectangle: Bounds, animate: boolean): void
  maximize(): void
}
const sameWindowState = (a: WindowState, b: WindowState | null): boolean => b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.maximized === b.maximized
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
  window.setBounds(target, false)
  notifyDiagnostic(diagnostic, { event: 'restore-bounds', ...report })
  if (value?.maximized) { window.maximize(); notifyDiagnostic(diagnostic, { event: 'restore-maximize', ...report }) }
  notifyDiagnostic(diagnostic, { event: 'restore-complete', ...report })
}
export class WindowStateTracker {
  private readonly window: WindowPort
  private readonly save: (state: WindowState, reason: WindowSaveReason) => Promise<void>
  private readonly failed: (error: unknown) => void
  private state: WindowState | null = null
  private persisted: WindowState | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()
  private readonly events = ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'leave-full-screen'] as const
  private readonly listeners = this.events.map(event => ({ event, listener: () => this.schedule(event) }))
  private readonly diagnostic: WindowDiagnosticObserver | undefined
  private lastEvent: WindowSaveReason = 'none'
  private windowWriteId = 0
  constructor(window: WindowPort, save: (state: WindowState, reason: WindowSaveReason) => Promise<void>, failed: (error: unknown) => void = () => {}, persisted: WindowState | null = null, diagnostic?: WindowDiagnosticObserver) {
    this.window = window; this.save = save; this.failed = failed; this.diagnostic = diagnostic
    this.persisted = persisted ? { ...persisted } : null
    this.capture('tracker-init')
    for (const { event, listener } of this.listeners) window.on(event, listener)
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
    if (rectangle) this.state = { ...rectangle, maximized }
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
    this.clearTimer()
    for (const { event, listener } of this.listeners) this.window.removeListener(event, listener)
    this.report({ event: 'tracker-dispose' })
  }
  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined }
}
