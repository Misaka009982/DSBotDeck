// SPDX-License-Identifier: Apache-2.0
// 仅合并已核对的失败／重试诊断；取消与未知状态仍独立显示。
import { record } from './validation.ts'
const FAILURE_TITLES = new Set(['模型请求失败', '模型请求正在重试', '模型尝试失败'])
export interface DiagnosticScope { sessionId?: string; serverId?: string; targetId?: string; fullMessages?: boolean }
interface HistoryGroup { key: string; owner: string; tokens: Set<string> }
const sequenceOf = (entry: Record<string, unknown>): number | null => typeof entry.seq === 'number' && Number.isSafeInteger(entry.seq) && entry.seq >= 0 ? entry.seq : null
export function diagnosticEntries(value: unknown): Record<string, unknown>[] {
  const entry = record(value)
  return entry?.kind === 'diagnostic' && Array.isArray(entry.deckDiagnosticEntries)
    ? entry.deckDiagnosticEntries.map(record).filter((row): row is Record<string, unknown> => row?.kind === 'diagnostic') : []
}
function ownerOf(entry: Record<string, unknown>, scope: DiagnosticScope): string {
  return JSON.stringify([entry.serverId ?? scope.serverId ?? null, entry.targetId ?? scope.targetId ?? null, entry.sessionId ?? scope.sessionId ?? null, entry.botId ?? null])
}
function tokenOf(entry: Record<string, unknown>): string {
  const seq = sequenceOf(entry)
  return seq === null ? JSON.stringify(['legacy', entry.id ?? null, entry.time ?? null, entry.turn ?? null, entry.title ?? null]) : JSON.stringify(['seq', seq])
}
export class DiagnosticHistoryModel {
  private serial = 0
  private scope = ''
  private groups: HistoryGroup[] = []
  group(items: readonly unknown[], scope: DiagnosticScope = {}): unknown[] {
    const target = JSON.stringify(scope)
    if (target !== this.scope) { this.scope = target; this.groups = [] }
    const result: unknown[] = []; const next: HistoryGroup[] = []; const used = new Set<string>()
    let pending: Record<string, unknown>[] = []; let owner = ''
    const flush = () => {
      if (pending.length === 0) return
      const entries: Record<string, unknown>[] = []; const bySequence = new Map<number, number>()
      for (const entry of pending) {
        const seq = sequenceOf(entry); const index = seq === null ? undefined : bySequence.get(seq)
        // 重复页用当前完整行替换，不能合回旧授权下的 detail；缺序号不猜去重。
        if (index === undefined) { if (seq !== null) bySequence.set(seq, entries.length); entries.push(entry) }
        else entries[index] = entry
      }
      const tokenList = entries.map(tokenOf); const tokens = new Set(tokenList)
      const previous = this.groups.find(group => !used.has(group.key) && group.owner === owner && tokenList.some(token => group.tokens.has(token)))
      const key = previous?.key ?? `diagnostic-group-${++this.serial}`
      used.add(key); next.push({ key, owner, tokens })
      const last = entries.at(-1)!
      result.push({ ...entries[0], deckDiagnosticEntries: entries, deckDiagnosticGroupKey: key,
        ...(typeof last.time === 'number' ? { end: last.end ?? last.time } : {}) })
      pending = []; owner = ''
    }
    for (const value of items) {
      const entry = record(value)
      const grouped = diagnosticEntries(entry)
      if (grouped.length > 0) {
        flush(); result.push(value)
        if (typeof entry?.deckDiagnosticGroupKey === 'string') {
          used.add(entry.deckDiagnosticGroupKey)
          next.push({ key: entry.deckDiagnosticGroupKey, owner: ownerOf(entry, scope), tokens: new Set(grouped.map(tokenOf)) })
        }
        continue
      }
      if (!entry || entry.kind !== 'diagnostic' || typeof entry.title !== 'string' || !FAILURE_TITLES.has(entry.title)) {
        flush(); result.push(value); continue
      }
      const current = ownerOf(entry, scope)
      if (pending.length > 0 && current !== owner) flush()
      owner = current; pending.push(entry)
    }
    flush(); this.groups = next
    return result
  }
}
