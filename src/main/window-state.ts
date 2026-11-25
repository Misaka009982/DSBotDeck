// SPDX-License-Identifier: Apache-2.0
// 就绪后显式恢复布局，再立即捕获有效状态；未变化时不重复写盘。
import type { Bounds, WindowState } from '../shared/domain.ts'
import { bounds } from '../shared/validation.ts'
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
export function restoreWindowLayout(window: WindowRestorePort, value: WindowState | null, area: Bounds): void {
  if (window.isDestroyed()) return
  const minimum = minimumWindowSize(area)
  window.setMinimumSize(minimum.width, minimum.height)
  window.setBounds(restoreWindowBounds(value, area), false)
  if (value?.maximized) window.maximize()
}
export class WindowStateTracker {
  private readonly window: WindowPort
  private readonly save: (state: WindowState) => Promise<void>
  private readonly failed: (error: unknown) => void
  private state: WindowState | null = null
  private persisted: WindowState | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()
  private readonly events = ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'leave-full-screen']
  constructor(window: WindowPort, save: (state: WindowState) => Promise<void>, failed: (error: unknown) => void = () => {}, persisted: WindowState | null = null) {
    this.window = window; this.save = save; this.failed = failed
    this.persisted = persisted ? { ...persisted } : null
    this.capture()
    for (const event of this.events) window.on(event, this.schedule)
  }
  private capture(): void {
    const window = this.window
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    const maximized = window.isMaximized()
    // 贴靠使用当前矩形；只有最大化时使用还原矩形。
    const rectangle = bounds(maximized ? window.getNormalBounds() : window.getBounds())
    if (rectangle) this.state = { ...rectangle, maximized }
  }
  private readonly schedule = (): void => {
    this.capture(); this.clearTimer()
    this.timer = setTimeout(() => { this.timer = undefined; void this.write().catch(this.failed) }, 500)
  }
  private write(): Promise<void> {
    if (!this.state) return this.writing
    const state = { ...this.state }
    // 在写队列内比较，避免相同刷新重复写入，也不遗漏待写变更后的回退。
    const next = this.writing.then(async () => {
      if (sameWindowState(state, this.persisted)) return
      await this.save(state)
      this.persisted = state
    })
    this.writing = next.catch(() => {})
    return next
  }
  flush(): Promise<void> {
    this.clearTimer(); this.capture()
    return this.write()
  }
  dispose(): void {
    this.clearTimer()
    for (const event of this.events) this.window.removeListener(event, this.schedule)
  }
  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined }
}
