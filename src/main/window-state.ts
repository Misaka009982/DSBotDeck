// SPDX-License-Identifier: Apache-2.0
// 立即捕获有效窗口状态，只延后磁盘写入，避免最小化吞掉尚未保存的移动或缩放。
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
export class WindowStateTracker {
  private readonly window: WindowPort
  private readonly save: (state: WindowState) => Promise<void>
  private readonly failed: (error: unknown) => void
  private state: WindowState | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()
  private readonly events = ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'leave-full-screen']
  constructor(window: WindowPort, save: (state: WindowState) => Promise<void>, failed: (error: unknown) => void = () => {}) {
    this.window = window; this.save = save; this.failed = failed
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
    const next = this.writing.then(() => this.save(state))
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
