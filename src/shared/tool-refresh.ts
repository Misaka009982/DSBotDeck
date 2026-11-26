// SPDX-License-Identifier: Apache-2.0
// 合并工具变化读取；保留原 hello/room 读取，隐藏、断线和卸载时不追加请求。
import { record } from './validation.ts'
export const TOOL_REFRESH_DELAY_MS = 1000
export interface ToolFeed { on(listener: (event: string, data: unknown) => void): () => void }
export interface ToolRefreshTarget { readonly botId?: string; readonly roomId?: string; readonly sessionId?: string }
export type ToolRefreshSchedule = (callback: () => void, delay: number) => () => void
const scheduleLater: ToolRefreshSchedule = (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer) }
function relevant(event: string, data: unknown, target: ToolRefreshTarget): boolean {
  if (event === 'live' || event === 'revision') return true
  const entry = record(data)
  if (!entry) return false
  if (target.roomId !== undefined) return (event === 'notice' || event === 'extra-update') && entry.roomId === target.roomId
  if (entry.botId !== target.botId || entry.roomId !== undefined) return false
  if (event === 'extra-update') return entry.sessionId === target.sessionId
  if (event === 'notice') return true
  return event === 'message' && entry.sessionId === target.sessionId && record(entry.item)?.kind === 'bot'
}
export function watchToolSteps(feed: ToolFeed, target: ToolRefreshTarget, refresh: () => void, available: () => boolean, schedule: ToolRefreshSchedule = scheduleLater): () => void {
  const fixed = { ...target }
  if (fixed.botId === undefined && fixed.roomId === undefined) return () => {}
  let stopped = false
  let cancel: (() => void) | null = null
  const clear = () => { cancel?.(); cancel = null }
  const off = feed.on((event, data) => {
    if (stopped) return
    if (event === 'hello' || event === 'lost') { clear(); return }
    if (cancel !== null || !available() || !relevant(event, data, fixed)) return
    cancel = schedule(() => {
      cancel = null
      if (!stopped && available()) refresh()
    }, TOOL_REFRESH_DELAY_MS)
  })
  return () => { stopped = true; clear(); off() }
}
