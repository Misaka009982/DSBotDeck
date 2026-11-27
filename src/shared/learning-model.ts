// SPDX-License-Identifier: Apache-2.0
// 学习提案按服务器原编号和当前私聊归属呈现；批准只回传编号与明确选择。
import { DeckError, errorCode, record, validEntityId } from './validation.ts'
export interface LearningTarget { botId: string; sessionId: string }
export interface LearningProposal extends Record<string, unknown> { id: string; botId: string; outcome?: 'approved' | 'declined' }
export interface LearningOperation extends LearningTarget { id: string; phase: 'busy' | 'unknown' | 'approved' | 'declined' | 'stale'; message: string }
const own = (value: unknown, id: string): unknown => { const table = record(value); return table && Object.hasOwn(table, id) ? table[id] : undefined }
const formatError = () => new DeckError('bot/incompatible', '学习提案格式不兼容，请在服务器核对；未开放批准。')
const bodyText = (value: unknown): value is string => typeof value === 'string' && value.length <= 256 * 1024
export function learningLiveChanges(current: Record<string, unknown>, value: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const key of ['learning', 'learningSettled', 'readOnly']) {
    if (value[key] !== undefined && JSON.stringify(current[key]) !== JSON.stringify(value[key])) changed[key] = value[key]
  }
  return changed
}
export function learningTarget(value: unknown, sessionId: unknown): LearningTarget | null {
  const roster = record(value)
  if (!roster || !validEntityId(sessionId) || own(roster.roomsById, sessionId)) return null
  const bot = record(own(roster.byId, sessionId))
  if (!bot || !validEntityId(bot.id) || (bot.sessionId ?? bot.id) !== sessionId) return null
  return { botId: bot.id, sessionId }
}
export function learningProposals(value: unknown, target: LearningTarget | null): { pending: LearningProposal[]; settled: LearningProposal[] } {
  if (!target) return { pending: [], settled: [] }
  const roster = record(value)
  const read = (field: string, settled: boolean): LearningProposal[] => {
    const table = roster?.[field]
    if (table !== undefined && !record(table)) throw formatError()
    const items = own(table, target.botId)
    if (items === undefined) return []
    if (!Array.isArray(items) || items.length > 256) throw formatError()
    const seen = new Set<string>()
    return items.flatMap(value => {
      const item = record(value)
      if (!item || item.botId !== target.botId) throw formatError()
      if (settled && item.sessionId !== target.sessionId) return []
      if (!validEntityId(item.id) || seen.has(item.id) || (settled ? !['approved', 'declined'].includes(String(item.outcome)) : item.outcome !== undefined)) throw formatError()
      seen.add(item.id)
      if (item.kind === 'agents') {
        if (!bodyText(item.folder) || !item.folder || !Array.isArray(item.edits) || item.edits.length < 1 || item.edits.length > 3
          || item.edits.some(value => { const edit = record(value); return !edit || !['add', 'replace', 'remove'].includes(String(edit.op))
            || edit.op !== 'add' && !bodyText(edit.old) || edit.op !== 'remove' && !bodyText(edit.text) || edit.why !== undefined && !bodyText(edit.why) })) throw formatError()
      } else if (item.kind === 'skill' || item.kind === undefined) {
        const previous = record(item.previous)
        if (!bodyText(item.name) || !item.name || !bodyText(item.description) || !bodyText(item.content) || !['create', 'update'].includes(String(item.action))
          || item.why !== undefined && !bodyText(item.why) || item.action === 'update' && (!previous || !bodyText(previous.description) || !bodyText(previous.content))) throw formatError()
      } else throw formatError()
      return [item as LearningProposal]
    })
  }
  return { pending: read('learning', false), settled: read('learningSettled', true) }
}
export function learningRequest(value: unknown, target: LearningTarget, proposal: LearningProposal, approve: boolean): { id: string; approve: boolean } {
  const current = learningTarget(value, target.sessionId)
  if (!current || current.botId !== target.botId || typeof approve !== 'boolean' || record(value)?.readOnly) throw new DeckError('bot/read-only', '原私聊已变化或服务器只读，未发送学习审批。')
  const latest = learningProposals(value, target).pending.find(item => item.id === proposal.id)
  if (!latest || JSON.stringify(latest) !== JSON.stringify(proposal)) throw new DeckError('bot/stale', '提案已变化或处理，请核对当前内容后操作。')
  return { id: proposal.id, approve }
}
export function learningFailure(error: unknown): string {
  const code = errorCode(error)
  if (code === 'bot/stale') return '此提案已失效或已在其他窗口处理，请刷新学习提案。'
  if (['bot/refused', 'bot/read-only', 'bot/invalid'].includes(code)) return '服务器未接受学习审批，请核对配对权限、只读状态和当前提案。'
  return '学习审批结果待确认；不会自动重发，请刷新提案核对服务器结果。'
}
// 每个隔离服务器视图共用一份锁，换聊天再返回也不能重复提交待确认的提案。
export class LearningAnswers {
  private operations = new Map<string, LearningOperation>()
  private listeners = new Set<() => void>()
  revision = 0
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void { this.revision++; for (const listener of this.listeners) listener() }
  get(id: string): LearningOperation | undefined { return this.operations.get(id) }
  begin(target: LearningTarget, id: string): LearningOperation {
    if (this.operations.has(id)) throw new DeckError('bot/busy', '此提案正在处理或结果待确认，请先刷新提案。')
    if (this.operations.size >= 256) throw new DeckError('bot/busy', '待确认学习审批过多，请先在服务器核对。')
    const operation: LearningOperation = { ...target, id, phase: 'busy', message: '' }
    this.operations.set(id, operation); this.changed(); return operation
  }
  finish(operation: LearningOperation, value: unknown, approve: boolean): void {
    if (record(value)?.applied !== approve) throw formatError()
    if (this.operations.get(operation.id) !== operation) return
    operation.phase = approve ? 'approved' : 'declined'; operation.message = ''; this.changed()
  }
  fail(operation: LearningOperation, error: unknown): void {
    if (this.operations.get(operation.id) !== operation || ['approved', 'declined'].includes(operation.phase)) return
    if (['bot/refused', 'bot/read-only', 'bot/invalid'].includes(errorCode(error))) this.operations.delete(operation.id)
    else { operation.phase = errorCode(error) === 'bot/stale' ? 'stale' : 'unknown'; operation.message = learningFailure(error) }
    this.changed()
  }
  reconcile(target: LearningTarget, settled: readonly LearningProposal[]): void {
    let changed = false
    for (const proposal of settled) {
      const operation = this.operations.get(proposal.id)
      // 服务端在实际处理时记录当前私聊；提交途中正常换段仍以同Bot、同提案的结算为准。
      if (operation && operation.botId === target.botId && proposal.botId === target.botId && proposal.sessionId === target.sessionId
        && (proposal.outcome === 'approved' || proposal.outcome === 'declined')) { this.operations.delete(proposal.id); changed = true }
    }
    if (changed) this.changed()
  }
}
