// SPDX-License-Identifier: Apache-2.0
// 用户 PTY 只绑定服务端句柄；字节游标与控制序号独立，未知结果不重放。
import { DeckError, record } from './validation.ts'
import { ordinal, resourceFormat, resourceId } from './resource-model.ts'
import type { ResourceTarget } from './resource-model.ts'
export const TERMINAL_INPUT_BYTES = 16 * 1024
export const TERMINAL_OUTPUT_BYTES = 512 * 1024
export const TERMINAL_STATUSES = { creating: '正在创建', running: '运行中', exited: '已退出', failed: '进程结果未确认', closing: '正在关闭', 'close-unknown': '关闭待确认', closed: '已关闭' } as const
export type TerminalStatus = keyof typeof TERMINAL_STATUSES
export type ControlStatus = 'accepted' | 'pending' | 'unknown'
export interface TerminalState {
  terminalId: string; sessionId: string; status: TerminalStatus; control: 'ready' | 'unknown'; cols: number; rows: number
  exitCode: number | null; outputEnded: boolean; error: boolean
}
export interface TerminalHandle extends TerminalState {
  handleId: string; expiresAt: number; cleanupOnly: boolean; nextSequence: number
  lastControl: { sequence: number; status: ControlStatus } | null; writable: boolean
}
export interface TerminalPage extends TerminalState {
  handleId: string; nextSequence: number; lastControl: TerminalHandle['lastControl']; writable: boolean
  from: number; nextOffset: number; throughOffset: number; truncated: boolean; bytes: Uint8Array
}
export function terminalDimensions(cols: unknown, rows: unknown): boolean { return ordinal(cols) && cols >= 2 && cols <= 500 && ordinal(rows) && rows >= 1 && rows <= 200 }
function stateOf(value: unknown): TerminalState {
  const item = record(value)
  if (!item || !resourceId(item.terminalId) || !resourceId(item.sessionId) || item.owner !== 'user'
    || typeof item.status !== 'string' || !Object.hasOwn(TERMINAL_STATUSES, item.status) || item.control !== 'ready' && item.control !== 'unknown'
    || !terminalDimensions(item.cols, item.rows) || typeof item.outputEnded !== 'boolean'
    || item.exitCode !== null && (typeof item.exitCode !== 'number' || !Number.isSafeInteger(item.exitCode))) throw resourceFormat()
  return { terminalId: item.terminalId, sessionId: item.sessionId, status: item.status as TerminalStatus, control: item.control,
    cols: item.cols as number, rows: item.rows as number, exitCode: item.exitCode as number | null, outputEnded: item.outputEnded, error: item.error !== undefined }
}
function controlOf(item: Record<string, unknown>): Pick<TerminalHandle, 'nextSequence' | 'lastControl' | 'writable'> {
  const last = record(item.lastControl)
  if (!ordinal(item.nextSequence) || item.nextSequence < 1 || typeof item.writable !== 'boolean'
    || item.nextSequence === 1 && item.lastControl !== null || item.nextSequence > 1 && (!last || last.sequence !== item.nextSequence - 1)
    || last && !['accepted', 'pending', 'unknown'].includes(typeof last.status === 'string' ? last.status : '')) throw resourceFormat()
  if (item.writable && (item.status !== 'running' || item.control !== 'ready' || item.cleanupOnly === true)) throw resourceFormat()
  return { nextSequence: item.nextSequence, lastControl: last ? { sequence: last.sequence as number, status: last.status as ControlStatus } : null, writable: item.writable }
}
export function terminalHandle(value: unknown, target: ResourceTarget | null): TerminalHandle {
  const state = stateOf(value); const item = record(value)!
  if (!resourceId(item.handleId) || !ordinal(item.expiresAt) || typeof item.cleanupOnly !== 'boolean'
    || target === null && item.cleanupOnly !== true || target !== null && (item.cleanupOnly !== false || state.sessionId !== target.sessionId)) throw resourceFormat()
  return { ...state, ...controlOf(item), handleId: item.handleId, expiresAt: item.expiresAt, cleanupOnly: item.cleanupOnly }
}
export function terminalCreated(value: unknown, target: ResourceTarget): TerminalHandle {
  if (record(value)?.schema !== 1) throw resourceFormat()
  return terminalHandle(value, target)
}
export function terminalList(value: unknown, target: ResourceTarget | null): { items: TerminalHandle[] } {
  const page = record(value)
  if (!page || page.schema !== 1 || !Array.isArray(page.items) || page.items.length > 32
    || target === null && page.cleanupOnly !== true || target !== null && (page.sessionId !== target.sessionId || page.maxInputBytes !== TERMINAL_INPUT_BYTES || page.maxOutputBytes !== TERMINAL_OUTPUT_BYTES)) throw resourceFormat()
  const items = page.items.map(item => terminalHandle(item, target))
  if (new Set(items.map(item => item.terminalId)).size !== items.length || new Set(items.map(item => item.handleId)).size !== items.length) throw resourceFormat()
  return { items }
}
export function terminalPage(value: unknown, handle: TerminalHandle, offset: number): TerminalPage {
  const state = stateOf(value); const page = record(value)!
  if (handle.cleanupOnly || page.schema !== 1 || state.terminalId !== handle.terminalId || state.sessionId !== handle.sessionId
    || page.handleId !== handle.handleId || page.encoding !== 'base64' || !ordinal(offset) || !ordinal(page.from) || !ordinal(page.nextOffset) || !ordinal(page.throughOffset)
    || offset > page.throughOffset || page.from !== Math.max(offset, page.throughOffset - TERMINAL_OUTPUT_BYTES)
    || page.truncated !== (page.from !== offset) || page.nextOffset > page.throughOffset
    || typeof page.data !== 'string' || page.data.length > 43692 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(page.data)) throw resourceFormat()
  const decoded = atob(page.data)
  if (decoded.length > 32 * 1024 || page.nextOffset !== page.from + decoded.length || btoa(decoded) !== page.data
    || page.from < page.throughOffset && decoded.length === 0) throw resourceFormat()
  return { ...state, ...controlOf(page), handleId: handle.handleId, from: page.from, nextOffset: page.nextOffset, throughOffset: page.throughOffset,
    truncated: page.truncated as boolean, bytes: Uint8Array.from(decoded, char => char.charCodeAt(0)) }
}
export function terminalClosed(value: unknown, terminalId: string): void {
  const result = record(value)
  if (!result || result.schema !== 1 || result.terminalId !== terminalId || result.status !== 'closed') throw resourceFormat()
}
export function terminalInput(value: unknown): string {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value) || new TextEncoder().encode(value).length > TERMINAL_INPUT_BYTES) throw new DeckError('bot/invalid', '单次终端输入必须为完整 Unicode，且不超过 16 KiB。')
  return value
}
export class TerminalControl {
  readonly handleId: string
  readonly terminalId: string
  nextSequence: number
  state: 'ready' | 'sending' | 'pending' | 'unknown' = 'ready'
  private waiting: number | null = null
  private writable: boolean
  constructor(handle: TerminalHandle) {
    this.handleId = handle.handleId; this.terminalId = handle.terminalId; this.nextSequence = handle.nextSequence
    this.writable = handle.writable && !handle.cleanupOnly
    if (handle.control === 'unknown' || handle.lastControl?.status === 'unknown') this.state = 'unknown'
    else if (handle.lastControl?.status === 'pending') { this.state = 'pending'; this.waiting = handle.lastControl.sequence }
  }
  get canSend(): boolean { return this.writable && this.state === 'ready' }
  get acceptsInput(): boolean { return this.writable && (this.state === 'ready' || this.state === 'sending') }
  begin(): number {
    if (!this.canSend) throw new DeckError('bot/refused', '终端只读或上次输入仍待确认，没有发送新操作。')
    this.waiting = this.nextSequence; this.state = 'sending'; return this.waiting
  }
  finish(value: unknown): void {
    const item = record(value)
    if (!item || item.schema !== 1 || this.waiting === null || item.sequence !== this.waiting || !['accepted', 'pending', 'unknown'].includes(typeof item.status === 'string' ? item.status : '')) throw resourceFormat()
    if (item.status === 'accepted') { this.nextSequence = Math.max(this.nextSequence, this.waiting + 1); this.waiting = null; this.state = 'ready' }
    else this.state = item.status as 'pending' | 'unknown'
  }
  uncertain(): void { this.state = 'unknown' }
  observe(value: Pick<TerminalHandle, 'terminalId' | 'handleId' | 'nextSequence' | 'lastControl' | 'writable' | 'control' | 'status'>): void {
    if (value.terminalId !== this.terminalId || value.handleId !== this.handleId) throw resourceFormat()
    this.writable = value.writable && value.status === 'running'
    if (value.control === 'unknown') { this.state = 'unknown'; return }
    if (this.waiting !== null) {
      if (this.state !== 'sending' && value.lastControl?.sequence === this.waiting && value.lastControl.status === 'accepted' && value.nextSequence === this.waiting + 1) {
        this.nextSequence = value.nextSequence; this.waiting = null; this.state = 'ready'
      }
    } else this.nextSequence = Math.max(this.nextSequence, value.nextSequence)
  }
}
