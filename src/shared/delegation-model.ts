// SPDX-License-Identifier: Apache-2.0
// 委派状态只取子目录与真实结算；历史切面与当前生命周期分开呈现。
import { record } from './validation.ts'
import { boundedText, ordinal, resourceFormat, resourceId, resourceTarget } from './resource-model.ts'
import type { ResourceTarget } from './resource-model.ts'

export const DELEGATION_STATUSES = { running: '运行中', completed: '已完成', failed: '失败', canceled: '已取消', limited: '达到限制', refused: '已拒绝', interrupted: '已中断', unknown: '状态未知' } as const
export type DelegationStatus = keyof typeof DELEGATION_STATUSES
export interface DelegationChild {
  childId: string; mode: 'continuable' | 'one-shot' | 'external' | 'unknown'; createdAt: number; label: string | null
  status: DelegationStatus; statusSource: 'live-agent' | 'lifecycle' | 'settlement' | null; runId: string | null
  lastSettlement: { seq: number; status: DelegationStatus } | null
}
export interface DelegationCursor { childId: string; throughSeq: number; beforeSeq: number }
export interface DelegationText { text: string | null; truncated: boolean }
export interface DelegationResult extends DelegationText { source: 'lifecycle' | 'settlement'; runId: string | null; seq: number | null }
export interface DelegationEvent { seq: number; type: string; turn: number | null; text: string | null; truncated: boolean; callId: string | null; name: string | null; status: DelegationStatus | null }
export interface DelegationList { rootSessionId: string; parentSessionId: string; items: DelegationChild[]; nextAfterChildId: string | null; depthLimit: number; limited: boolean }
export interface DelegationPage {
  rootSessionId: string; parentSessionId: string; child: DelegationChild; history: 'session' | 'external'; throughSeq: number | null
  events: DelegationEvent[]; cursor: DelegationCursor | null; result: DelegationResult | null
  lastTurn: { turn: number; seq: number; status: DelegationStatus | 'open'; result: (DelegationText & { seq: number }) | null } | null; limited: boolean
}
const statusOf = (value: unknown): DelegationStatus => {
  if (typeof value !== 'string' || !Object.hasOwn(DELEGATION_STATUSES, value)) throw resourceFormat()
  return value as DelegationStatus
}
function textOf(value: unknown, limit: number): DelegationText {
  const text = record(value)
  if (!text || typeof text.truncated !== 'boolean' || text.text === null && !text.truncated) throw resourceFormat()
  return { text: text.text === null ? null : boundedText(text.text, limit), truncated: text.truncated }
}
function childOf(value: unknown): DelegationChild {
  const child = record(value); const settlement = record(child?.lastSettlement)
  if (!child || !resourceId(child.childId) || !ordinal(child.createdAt) || typeof child.mode !== 'string' || !['continuable', 'one-shot', 'external', 'unknown'].includes(child.mode)
    || child.statusSource !== null && (typeof child.statusSource !== 'string' || !['live-agent', 'lifecycle', 'settlement'].includes(child.statusSource))
    || child.runId !== null && !resourceId(child.runId) || child.lastSettlement !== null && (!settlement || !ordinal(settlement.seq))) throw resourceFormat()
  const status = statusOf(child.status)
  if (status !== 'unknown' && child.statusSource === null || child.statusSource === 'live-agent' && status !== 'running') throw resourceFormat()
  return { childId: child.childId, mode: child.mode as DelegationChild['mode'], createdAt: child.createdAt,
    label: child.label === null ? null : boundedText(child.label, 256), status, statusSource: child.statusSource as DelegationChild['statusSource'],
    runId: child.runId as string | null, lastSettlement: settlement ? { seq: settlement.seq as number, status: statusOf(settlement.status) } : null }
}
export function delegationRequest(target: ResourceTarget, childPath: readonly string[], detail = false): Record<string, unknown> {
  const checked = resourceTarget(target)
  if (childPath.length > (detail ? 8 : 7) || detail && childPath.length === 0 || !childPath.every(resourceId)
    || new Set([checked.sessionId, ...childPath]).size !== childPath.length + 1) throw resourceFormat()
  return { scope: checked.scope, rootSessionId: checked.sessionId, childPath: [...childPath], limit: 32 }
}
export function delegationList(value: unknown, target: ResourceTarget, childPath: readonly string[], after?: string): DelegationList {
  delegationRequest(target, childPath)
  const page = record(value); const parent = childPath.at(-1) ?? target.sessionId
  if (!page || page.schema !== 1 || page.rootSessionId !== target.sessionId || page.parentSessionId !== parent || page.depthLimit !== 8
    || !Array.isArray(page.items) || page.items.length > 32 || page.nextAfterChildId !== null && !resourceId(page.nextAfterChildId)) throw resourceFormat()
  const items = page.items.map(childOf)
  if (new Set(items.map(item => item.childId)).size !== items.length || items.some(item => [target.sessionId, ...childPath].includes(item.childId) || item.childId === after)
    || page.nextAfterChildId !== null && (items.at(-1)?.childId !== page.nextAfterChildId || page.nextAfterChildId === after)) throw resourceFormat()
  return { rootSessionId: target.sessionId, parentSessionId: parent, items, nextAfterChildId: page.nextAfterChildId as string | null, depthLimit: 8, limited: false }
}
export function appendDelegations(previous: DelegationList | null, next: DelegationList): DelegationList {
  if (!previous) return next
  const seen = new Set(previous.items.map(item => item.childId))
  if (previous.rootSessionId !== next.rootSessionId || previous.parentSessionId !== next.parentSessionId
    || next.items.some(item => seen.has(item.childId))) throw resourceFormat()
  const items = [...previous.items, ...next.items]
  return { ...next, items: items.slice(0, 512), limited: items.length > 512 || items.length === 512 && next.nextAfterChildId !== null }
}
function eventOf(value: unknown, through: number): DelegationEvent {
  const event = record(value)
  if (!event || !ordinal(event.seq) || event.seq > through || event.turn !== undefined && !ordinal(event.turn)) throw resourceFormat()
  const row: DelegationEvent = { seq: event.seq, type: String(event.type), turn: typeof event.turn === 'number' ? event.turn : null,
    text: null, truncated: false, callId: null, name: null, status: null }
  if (event.type === 'turn/start') return row
  if (event.type === 'turn/end') return { ...row, status: statusOf(event.status) }
  if (event.type === 'assistant/message') return { ...row, ...textOf(event, 1024) }
  if (!resourceId(event.callId)) throw resourceFormat()
  if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') return { ...row, callId: event.callId, name: event.name === null ? null : boundedText(event.name, 120) }
  if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
    if (!['completed', 'failed', 'unknown'].includes(String(event.status))) throw resourceFormat()
    return { ...row, callId: event.callId, status: statusOf(event.status) }
  }
  throw resourceFormat()
}
export function delegationPage(value: unknown, target: ResourceTarget, childPath: readonly string[], cursor?: DelegationCursor): DelegationPage {
  delegationRequest(target, childPath, true)
  const page = record(value); const parent = childPath.at(-2) ?? target.sessionId; const childId = childPath.at(-1)
  if (!page || page.schema !== 1 || page.rootSessionId !== target.sessionId || page.parentSessionId !== parent
    || typeof page.history !== 'string' || !['session', 'external'].includes(page.history) || !Array.isArray(page.events) || page.events.length > 32) throw resourceFormat()
  const child = childOf(page.child)
  if (child.childId !== childId) throw resourceFormat()
  let result: DelegationResult | null = null
  if (page.result !== null) {
    const item = record(page.result)
    if (!item || item.source !== 'lifecycle' && item.source !== 'settlement' || item.source === 'lifecycle' && !resourceId(item.runId)
      || item.source === 'settlement' && !ordinal(item.seq)) throw resourceFormat()
    result = { ...textOf(item, 8192), source: item.source, runId: typeof item.runId === 'string' ? item.runId : null, seq: typeof item.seq === 'number' ? item.seq : null }
  }
  const base = { rootSessionId: target.sessionId, parentSessionId: parent, child, result, limited: false }
  if (page.history === 'external') {
    if (child.mode !== 'external' || cursor || page.throughSeq !== null || page.cursor !== null || page.lastTurn !== null || page.events.length) throw resourceFormat()
    return { ...base, history: 'external', throughSeq: null, events: [], cursor: null, lastTurn: null }
  }
  if (child.mode === 'external' || !Number.isSafeInteger(page.throughSeq) || typeof page.throughSeq !== 'number' || page.throughSeq < -1
    || cursor && (cursor.childId !== childId || cursor.throughSeq !== page.throughSeq)) throw resourceFormat()
  const through = page.throughSeq; const events = page.events.map(item => eventOf(item, through))
  if (events.some((item, index) => index > 0 && item.seq <= events[index - 1].seq || cursor && item.seq >= cursor.beforeSeq)) throw resourceFormat()
  const next = record(page.cursor)
  if (page.cursor !== null && (!next || next.childId !== childId || next.throughSeq !== through || !ordinal(next.beforeSeq)
    || next.beforeSeq > through || cursor && next.beforeSeq >= cursor.beforeSeq || events.length > 0 && next.beforeSeq > events[0].seq)) throw resourceFormat()
  let lastTurn: DelegationPage['lastTurn'] = null
  if (page.lastTurn !== null) {
    const turn = record(page.lastTurn); const text = record(turn?.result)
    if (!turn || !ordinal(turn.turn) || !ordinal(turn.seq) || turn.seq > through || turn.result !== null && (!text || !ordinal(text.seq) || text.seq > through)) throw resourceFormat()
    lastTurn = { turn: turn.turn, seq: turn.seq, status: turn.status === 'open' ? 'open' : statusOf(turn.status), result: text ? { ...textOf(text, 8192), seq: text.seq as number } : null }
  }
  return { ...base, history: 'session', throughSeq: through, events, cursor: next ? { childId: child.childId, throughSeq: through, beforeSeq: next.beforeSeq as number } : null, lastTurn }
}
export function appendDelegationHistory(previous: DelegationPage | null, next: DelegationPage): DelegationPage {
  if (!previous) return next
  const seen = new Set(previous.events.map(item => item.seq))
  if (previous.rootSessionId !== next.rootSessionId || previous.parentSessionId !== next.parentSessionId || previous.child.childId !== next.child.childId
    || previous.throughSeq !== next.throughSeq || previous.history !== next.history || next.events.some(item => seen.has(item.seq))) throw resourceFormat()
  const events = [...next.events, ...previous.events]
  return { ...next, events: events.slice(-256), limited: events.length > 256 || events.length === 256 && next.cursor !== null }
}
