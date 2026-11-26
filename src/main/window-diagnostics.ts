// SPDX-License-Identifier: Apache-2.0
// 只观测窗口数字与配置文件元数据；诊断失败不能阻止原操作，也不保存凭据或完整快照。
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { unwatchFile, watchFile } from 'node:fs'
import type { Stats } from 'node:fs'
import { appendFile, lstat, mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Bounds, WindowState } from '../shared/domain.ts'

const REASONS = [
  'move', 'resize', 'maximize', 'unmaximize', 'restore', 'leave-full-screen', 'minimize', 'enter-full-screen',
  'show', 'hide', 'focus', 'blur', 'ready-to-show', 'tracker-init', 'close', 'before-quit', 'flush', 'window-layout', 'user-resize', 'user-resize-end', 'none',
] as const
const SOURCES = [
  'server-paired', 'server-pair', 'server-connect', 'server-disconnect', 'server-rename', 'server-forget',
  'selection', 'content-selection', 'follow', 'pet-settings', 'pet-position', 'appearance-settings',
  'window-state', 'file-observer', 'unspecified',
] as const
const EVENTS = [
  'session-start', 'session-stop', 'log-overflow', 'vault-load-start', 'vault-load-success', 'vault-load-failed',
  'vault-update-queued', 'vault-update-start', 'vault-update-prepared', 'vault-update-success', 'vault-update-failed', 'vault-file-observed',
  'display-metrics-changed', 'display-added', 'display-removed', 'window-created', 'window-ready', 'window-show-request', 'window-show-complete',
  'window-close', 'window-closed', 'window-event', 'window-menu-before', 'window-menu-after', 'window-icon-before', 'window-icon-after',
  'window-minimum-before', 'window-minimum-after', 'window-theme-before', 'window-theme-after',
  'restore-start', 'restore-minimum', 'restore-bounds', 'restore-correction', 'restore-unmatched', 'restore-maximize', 'restore-complete', 'window-layout-request',
  'tracker-capture', 'tracker-capture-skipped', 'tracker-write-queued', 'tracker-write-start', 'tracker-write-skipped',
  'tracker-write-success', 'tracker-write-failed', 'tracker-dispose',
] as const
const ERROR_CODES = ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EISDIR', 'ENOTDIR', 'EBUSY', 'diagnostics/refused', 'vault/corrupt', 'vault/unavailable', 'vault/full', 'vault/encryption-failed', 'vault/write-failed', 'bot/invalid']
export type WindowSaveReason = typeof REASONS[number]
export type VaultWriteSource = typeof SOURCES[number]
export interface ConfigurationFileStamp {
  state: 'file' | 'missing' | 'link' | 'other' | 'unavailable' | 'missing-or-unavailable'
  size: number | null
  mtimeMs: number | null
  ctimeMs: number | null
  ino: number | null
  errorCode?: string
}
interface DisplayGeometry { id: number; bounds: Bounds; workArea: Bounds; scaleFactor: number }
interface WindowGeometryPort {
  isDestroyed(): boolean
  isVisible(): boolean
  isMaximized(): boolean
  isMinimized(): boolean
  isFullScreen(): boolean
  getBounds(): Bounds
  getNormalBounds(): Bounds
  getContentBounds(): Bounds
  getMinimumSize(): number[]
}
export interface WindowGeometry {
  outer: Bounds
  physical: Bounds | null
  normal: Bounds
  content: Bounds
  minimum: { width: number; height: number }
  visible: boolean
  maximized: boolean
  minimized: boolean
  fullScreen: boolean
  display: DisplayGeometry
}
export interface WindowDiagnosticRecord {
  event: typeof EVENTS[number]
  source?: VaultWriteSource
  reason?: WindowSaveReason
  lastEvent?: WindowSaveReason
  operationId?: number
  windowId?: number
  windowWriteId?: number
  saved?: WindowState | null
  target?: Bounds
  requested?: Bounds
  attempt?: number
  captured?: WindowState | null
  persisted?: WindowState | null
  before?: WindowState | null
  after?: WindowState | null
  windowChanged?: boolean
  ready?: boolean
  quitting?: boolean
  minimum?: { width: number; height: number }
  overlayHeight?: number
  geometry?: WindowGeometry | null
  file?: ConfigurationFileStamp
  previousFile?: ConfigurationFileStamp
  errorCode?: string
  dropped?: number
}
export type WindowDiagnosticObserver = (entry: WindowDiagnosticRecord) => void
export function notifyDiagnostic(observer: WindowDiagnosticObserver | undefined, entry: WindowDiagnosticRecord): void {
  try { observer?.(structuredClone(entry)) } catch { /* 观测器不能改变窗口或配置的原有结果。 */ }
}
export function diagnosticErrorCode(error: unknown): string {
  try {
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null
    return typeof code === 'string' && ERROR_CODES.includes(code) ? code : 'unknown'
  } catch { return 'unknown' }
}
export function windowGeometry(window: WindowGeometryPort, display: (rectangle: Bounds) => DisplayGeometry, toPhysical?: (rectangle: Bounds) => Bounds): WindowGeometry | null {
  try {
    if (window.isDestroyed()) return null
    const outer = window.getBounds(); const [width, height] = window.getMinimumSize()
    let physical: Bounds | null = null
    try { physical = toPhysical?.(outer) ?? null } catch { /* 物理像素转换不可用时仍保留DIP值。 */ }
    return {
      outer, physical, normal: window.getNormalBounds(), content: window.getContentBounds(), minimum: { width, height },
      visible: window.isVisible(), maximized: window.isMaximized(), minimized: window.isMinimized(),
      fullScreen: window.isFullScreen(), display: display(outer),
    }
  } catch { return null }
}
const emptyStamp = (state: ConfigurationFileStamp['state'], errorCode?: string): ConfigurationFileStamp => ({ state, size: null, mtimeMs: null, ctimeMs: null, ino: null, errorCode })
const statsStamp = (info: Stats, state: ConfigurationFileStamp['state']): ConfigurationFileStamp => ({ state, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino })
export async function configurationFileStamp(file: string): Promise<ConfigurationFileStamp> {
  try {
    const info = await lstat(file)
    return statsStamp(info, info.isSymbolicLink() ? 'link' : info.isFile() ? 'file' : 'other')
  } catch (error) {
    const code = diagnosticErrorCode(error)
    return emptyStamp(code === 'ENOENT' ? 'missing' : 'unavailable', code)
  }
}
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const rectangleFields = (value: Bounds | null | undefined) => value ? { x: numeric(value.x), y: numeric(value.y), width: numeric(value.width), height: numeric(value.height) } : null
const stateFields = (value: WindowState | null | undefined) => value ? { ...rectangleFields(value), maximized: value.maximized === true } : null
const fileFields = (value: ConfigurationFileStamp | undefined) => value ? { state: value.state, size: numeric(value.size), mtimeMs: numeric(value.mtimeMs), ctimeMs: numeric(value.ctimeMs), ino: numeric(value.ino), errorCode: value.errorCode === undefined ? undefined : ERROR_CODES.includes(value.errorCode) ? value.errorCode : 'unknown' } : undefined
function geometryFields(value: WindowGeometry | null | undefined) {
  if (!value) return value
  return {
    outer: rectangleFields(value.outer), physical: rectangleFields(value.physical), normal: rectangleFields(value.normal),
    content: rectangleFields(value.content), minimum: { width: numeric(value.minimum.width), height: numeric(value.minimum.height) },
    visible: value.visible === true, maximized: value.maximized === true, minimized: value.minimized === true,
    fullScreen: value.fullScreen === true,
    display: { id: numeric(value.display.id), bounds: rectangleFields(value.display.bounds), workArea: rectangleFields(value.display.workArea), scaleFactor: numeric(value.display.scaleFactor) },
  }
}
function diagnosticFields(entry: WindowDiagnosticRecord) {
  return {
    event: entry.event,
    source: entry.source && SOURCES.includes(entry.source) ? entry.source : undefined,
    reason: entry.reason && REASONS.includes(entry.reason) ? entry.reason : undefined,
    lastEvent: entry.lastEvent && REASONS.includes(entry.lastEvent) ? entry.lastEvent : undefined,
    operationId: entry.operationId === undefined ? undefined : numeric(entry.operationId),
    windowId: entry.windowId === undefined ? undefined : numeric(entry.windowId),
    windowWriteId: entry.windowWriteId === undefined ? undefined : numeric(entry.windowWriteId),
    saved: entry.saved === undefined ? undefined : stateFields(entry.saved),
    target: entry.target === undefined ? undefined : rectangleFields(entry.target),
    requested: entry.requested === undefined ? undefined : rectangleFields(entry.requested),
    attempt: entry.attempt === undefined ? undefined : numeric(entry.attempt),
    captured: entry.captured === undefined ? undefined : stateFields(entry.captured),
    persisted: entry.persisted === undefined ? undefined : stateFields(entry.persisted),
    before: entry.before === undefined ? undefined : stateFields(entry.before),
    after: entry.after === undefined ? undefined : stateFields(entry.after),
    windowChanged: typeof entry.windowChanged === 'boolean' ? entry.windowChanged : undefined,
    ready: typeof entry.ready === 'boolean' ? entry.ready : undefined,
    quitting: typeof entry.quitting === 'boolean' ? entry.quitting : undefined,
    minimum: entry.minimum ? { width: numeric(entry.minimum.width), height: numeric(entry.minimum.height) } : undefined,
    overlayHeight: entry.overlayHeight === undefined ? undefined : numeric(entry.overlayHeight),
    geometry: geometryFields(entry.geometry), file: fileFields(entry.file), previousFile: fileFields(entry.previousFile),
    errorCode: entry.errorCode === undefined ? undefined : ERROR_CODES.includes(entry.errorCode) ? entry.errorCode : 'unknown',
  }
}
async function regularLog(file: string): Promise<Stats | null> {
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile()) throw Object.assign(new Error('诊断日志不能指向链接或非普通文件。'), { code: 'diagnostics/refused' })
    return info
  } catch (error) { if (diagnosticErrorCode(error) === 'ENOENT') return null; throw error }
}
export class WindowDiagnostics {
  readonly file: string
  private readonly version: string
  private readonly limit: number
  private readonly session = randomUUID()
  private sequence = 0
  private pending = 0
  private dropped = 0
  private failure: string | null = null
  private warned = false
  private queue: Promise<void> = Promise.resolve()
  constructor(file: string, version: string, limit = 2 * 1024 * 1024) {
    this.file = file; this.version = /^[\da-z.+-]{1,40}$/i.test(version) ? version : 'unknown'; this.limit = limit
    if (!Number.isInteger(limit) || limit < 1024 || limit > 32 * 1024 * 1024) throw new RangeError('诊断日志预算无效。')
  }
  get problem(): string | null { return this.failure }
  record(entry: WindowDiagnosticRecord): void {
    if (this.pending >= 1024) { this.dropped += 1; return }
    try {
      if (!EVENTS.includes(entry.event)) return
      const dropped = this.dropped + (entry.dropped ?? 0); this.dropped = 0
      const line = `${JSON.stringify({ schema: 1, at: new Date().toISOString(), session: this.session, sequence: ++this.sequence, pid: process.pid, version: this.version, ...diagnosticFields(entry), dropped: dropped || undefined })}\n`
      this.pending += 1
      // 排队落盘，不在原生窗口事件内等待磁盘，最多积压1024项。
      this.queue = this.queue.then(() => this.append(line)).catch(error => {
        this.failure = diagnosticErrorCode(error); this.dropped += 1
        if (!this.warned) { this.warned = true; console.warn('窗口诊断日志无法写入，未改变配置保存行为。') }
      }).finally(() => { this.pending -= 1 })
    } catch { this.dropped += 1 }
  }
  async flush(): Promise<void> {
    await this.queue
    if (this.dropped) { const dropped = this.dropped; this.dropped = 0; this.record({ event: 'log-overflow', dropped }); await this.queue }
  }
  watchConfiguration(file: string): () => void {
    const listener = (current: Stats, previous: Stats) => {
      this.record({ event: 'vault-file-observed', source: 'file-observer', file: current.nlink ? statsStamp(current, 'file') : emptyStamp('missing-or-unavailable'), previousFile: previous.nlink ? statsStamp(previous, 'file') : emptyStamp('missing-or-unavailable') })
    }
    watchFile(file, { persistent: false, interval: 1000 }, listener)
    return () => { unwatchFile(file, listener) }
  }
  private async append(line: string): Promise<void> {
    const size = Buffer.byteLength(line, 'utf8')
    if (size > this.limit) throw Object.assign(new Error('单条诊断超出预算。'), { code: 'diagnostics/refused' })
    const folder = path.dirname(this.file)
    await mkdir(folder, { recursive: true, mode: 0o700 })
    const directory = await lstat(folder)
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw Object.assign(new Error('诊断目录不能是链接。'), { code: 'diagnostics/refused' })
    const current = await regularLog(this.file)
    if (current && current.size + size > this.limit) {
      const older = `${this.file}.1`; const oldest = `${this.file}.2`
      const first = await regularLog(older); const second = await regularLog(oldest)
      if (second) await unlink(oldest)
      if (first) await rename(older, oldest)
      await rename(this.file, older)
    }
    await appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 })
    this.failure = null
  }
}
