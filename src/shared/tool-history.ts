// SPDX-License-Identifier: Apache-2.0
// 只在分页合并后的呈现层分组，不改写服务器行或按工具名称去重。
import { record } from './validation.ts'
import { toolCallKey, toolCalls } from './tool-model.ts'
import type { ToolCall } from './tool-model.ts'
export interface ToolHistoryScope { sessionId?: string; serverId?: string; targetId?: string }
const entriesOf = (entry: Record<string, unknown>) => Array.isArray(entry.deckToolEntries) ? entry.deckToolEntries.map(record).filter((item): item is Record<string, unknown> => item !== null) : [entry]
function historyScope(entry: Record<string, unknown>, fallback: ToolHistoryScope): string {
  const sessions = new Set(toolCalls(entry, fallback.sessionId).flatMap(call => call.reference ? [call.reference.sessionId] : []))
  if (typeof entry.sessionId === 'string') sessions.add(entry.sessionId)
  if (sessions.size === 0 && fallback.sessionId) sessions.add(fallback.sessionId)
  return JSON.stringify([entry.serverId ?? fallback.serverId ?? null, entry.targetId ?? fallback.targetId ?? null, [...sessions]])
}
export function groupToolHistory(items: readonly unknown[], scope: ToolHistoryScope = {}): unknown[] {
  const result: unknown[] = []
  let pending: Record<string, unknown>[] = []; let current = ''
  const flush = () => {
    if (pending.length === 1) result.push(pending[0])
    else if (pending.length > 1) {
      const last = pending.at(-1)
      result.push({ ...pending[0], deckToolEntries: pending.slice(), ...(typeof last?.time === 'number' ? { end: last.end ?? last.time } : {}) })
    }
    pending = []; current = ''
  }
  for (const value of items) {
    const entry = record(value)
    if (entry?.kind === 'steps' && Array.isArray(entry.deckToolEntries)) {
      flush(); result.push(entry); continue
    }
    if (!entry || toolCalls(entry, scope.sessionId).length === 0) { flush(); result.push(value); continue }
    const key = historyScope(entry, scope)
    if (pending.length > 0 && key !== current) flush()
    current = key; pending.push(entry)
  }
  flush()
  return result
}
export function toolGroupRows(value: unknown, fallbackSessionId?: string): ToolCall[] {
  const entry = record(value)
  if (!entry || entry.kind !== 'steps') return []
  const result: ToolCall[] = []; const seen = new Map<string, number>()
  for (const source of entriesOf(entry)) {
    for (const call of toolCalls(source, fallbackSessionId)) {
      // 同一稳定调用的重复页只更新最新状态；缺编号时每次实际出现都保留。
      const key = call.reference ? toolCallKey(call.reference) : null
      const index = key === null ? undefined : seen.get(key)
      if (index === undefined) { if (key !== null) seen.set(key, result.length); result.push(call) }
      else {
        const previous = result[index]
        result[index] = { ...call, turn: call.turn ?? previous.turn, reference: call.reference && previous.reference ? { ...previous.reference, ...call.reference } : call.reference }
      }
    }
  }
  return result
}
export function toolGroupKey(value: unknown, fallbackSessionId?: string, fallbackKey = ''): string {
  const entry = record(value); const first = entry ? entriesOf(entry)[0] : null
  if (typeof entry?.deckToolGroupKey === 'string') return entry.deckToolGroupKey
  const call = first ? toolCalls(first, fallbackSessionId)[0] : null
  const stable = call?.reference ? toolCallKey(call.reference) : first?.id ?? first?.seq
  return JSON.stringify(['tools', first?.sessionId ?? call?.reference?.sessionId ?? fallbackSessionId ?? null, stable ?? [first?.turn ?? null, first?.time ?? null, fallbackKey]])
}
interface HistoryGroup { key: string; scope: string; tokens: Set<string> }
export class ToolHistoryModel {
  private serial = 0
  private scope = ''
  private groups: HistoryGroup[] = []
  group(items: readonly unknown[], scope: ToolHistoryScope = {}): unknown[] {
    const target = JSON.stringify(scope)
    if (target !== this.scope) { this.scope = target; this.groups = [] }
    const used = new Set<string>(); const next: HistoryGroup[] = []
    const result = groupToolHistory(items, scope).map(value => {
      const entry = record(value)
      if (!entry || toolGroupRows(entry, scope.sessionId).length === 0) return value
      const owner = historyScope(entry, scope)
      const tokens = new Set(entriesOf(entry).flatMap(source => toolCalls(source, scope.sessionId).map(call => call.reference
        ? JSON.stringify(['call', toolCallKey(call.reference)])
        : JSON.stringify(['legacy', source.sessionId ?? scope.sessionId, source.id ?? source.seq ?? null, source.turn ?? null, source.time ?? null]))))
      const previous = this.groups.find(group => !used.has(group.key) && group.scope === owner && [...tokens].some(token => group.tokens.has(token)))
      const key = previous?.key ?? `tool-group-${++this.serial}`
      used.add(key); next.push({ key, scope: owner, tokens })
      return { ...entry, deckToolGroupKey: key }
    })
    this.groups = next
    return result
  }
}
