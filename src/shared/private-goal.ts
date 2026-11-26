// SPDX-License-Identifier: Apache-2.0
// 私聊目标使用服务器公开状态；目标开启不等于模型正在运行。
import { DeckError, errorCode, record } from './validation.ts'
import { ordinal, resourceId } from './resource-model.ts'
export const GOAL_LABELS = { active: '自动推进已开启', paused: '已暂停', blocked: '等待处理', complete: '已完成', stopped: '已终止' } as const
export type GoalStatus = keyof typeof GOAL_LABELS
export type GoalAction = 'start' | 'revise' | 'pause' | 'resume' | 'stop'
export interface GoalTarget { botId: string; sessionId: string }
export interface PrivateGoal {
  schema: 1; id: string; revision: number; status: GoalStatus; objective: string; acceptance: string
  progress: string; evidence: string; reason: string; rounds: number; emptyTurns: number; updatedAt: number
}
export interface GoalRequest extends GoalTarget { action: GoalAction; goalId?: string; revision?: number; objective?: string; acceptance?: string }
const invalid = () => new DeckError('bot/incompatible', '服务器私聊目标格式不兼容，请核对版本；没有修改目标。')
const field = (value: unknown, limit: number, required = false): string => {
  if (typeof value !== 'string' || value.length > limit || required && !value.trim()) throw invalid()
  return value
}
export function privateGoalMode(value: unknown): 'missing' | 'incompatible' | 'ready' {
  const extras = record(record(value)?.extras)
  if (extras?.privateGoal === undefined) return 'missing'
  return extras.schema === 1 && record(extras.privateGoal)?.schema === 1 ? 'ready' : 'incompatible'
}
export function privateGoal(value: unknown): PrivateGoal | null {
  if (value === null || value === undefined) return null
  const goal = record(value)
  if (!goal || goal.schema !== 1 || !resourceId(goal.id) || !ordinal(goal.revision) || goal.revision < 1
    || typeof goal.status !== 'string' || !Object.hasOwn(GOAL_LABELS, goal.status)
    || !ordinal(goal.rounds) || !ordinal(goal.emptyTurns) || !ordinal(goal.updatedAt)) throw invalid()
  return { schema: 1, id: goal.id, revision: goal.revision, status: goal.status as GoalStatus,
    objective: field(goal.objective, 4000, true), acceptance: field(goal.acceptance, 4000, true), progress: field(goal.progress, 2000),
    evidence: field(goal.evidence, 4000), reason: field(goal.reason, 1000), rounds: goal.rounds, emptyTurns: goal.emptyTurns, updatedAt: goal.updatedAt }
}
export function privateGoalTarget(value: unknown, botId: unknown, sessionId?: unknown): GoalTarget | null {
  const roster = record(value); const bots = record(roster?.byId)
  if (privateGoalMode(value) !== 'ready' || !resourceId(botId) || !bots || !Object.hasOwn(bots, botId)) return null
  const bot = record(bots[botId]); const current = bot?.sessionId ?? bot?.id
  if (bot?.id !== botId || !resourceId(current) || sessionId !== undefined && sessionId !== current) return null
  const rooms = record(roster?.roomsById)
  if (rooms && Object.hasOwn(rooms, current) || (Array.isArray(bot.tasks) ? bot.tasks : []).some(item => {
    const task = record(item); return task?.sessionId === current || Array.isArray(task?.parts) && task.parts.includes(current)
  })) return null
  return { botId, sessionId: current }
}
export function privateGoalChatTarget(value: unknown, sessionId: unknown): GoalTarget | null {
  const bots = record(record(value)?.byId)
  const bot = typeof sessionId === 'string' && bots && Object.hasOwn(bots, sessionId) ? record(bots[sessionId]) : null
  return privateGoalTarget(value, bot?.id, sessionId)
}
export function privateGoalCanRun(value: unknown, botId: unknown): boolean {
  const target = privateGoalTarget(value, botId)
  if (!target) return false
  const roster = record(value); const bot = record(record(roster?.byId)?.[target.botId])
  const mode = record(bot?.extras)?.messageMode
  const defaults = record(record(roster?.extras)?.defaults)
  return (mode === 'queue' || mode === 'steer' ? mode : defaults?.messageMode) === 'steer'
}
export const goalLive = (goal: PrivateGoal | null): boolean => goal !== null && !['complete', 'stopped'].includes(goal.status)
export const goalStamp = (goal: PrivateGoal | null): string => JSON.stringify([goal?.id ?? null, goal?.revision ?? null])
export function goalRequest(target: GoalTarget, goal: PrivateGoal | null, action: GoalAction, patch?: { objective: string; acceptance: string }): GoalRequest {
  if (!resourceId(target.botId) || !resourceId(target.sessionId)) throw invalid()
  if (!['start', 'revise', 'pause', 'resume', 'stop'].includes(action)) throw new DeckError('bot/invalid', '未知的目标操作。')
  if (action === 'start' ? goalLive(goal) : !goalLive(goal)) throw new DeckError('bot/stale', '目标已变化，请先核对当前目标。')
  if (action === 'resume' && !['paused', 'blocked'].includes(goal?.status ?? '') || action === 'pause' && goal?.status !== 'active') throw new DeckError('bot/stale', '目标状态已变化，请重新核对。')
  const request: GoalRequest = { ...target, action, ...(goal ? { goalId: goal.id, revision: goal.revision } : {}) }
  if (action === 'start' || action === 'revise') {
    for (const value of [patch?.objective, patch?.acceptance]) if (typeof value !== 'string' || !value.trim() || value.length > 4000 || /[\uD800-\uDFFF]/u.test(value)) throw new DeckError('bot/invalid', '目标与验收标准不能为空，且各不超过 4000 个字符。')
    request.objective = patch!.objective.trim(); request.acceptance = patch!.acceptance.trim()
  }
  return request
}
export function goalReply(value: unknown, request: GoalRequest): PrivateGoal {
  const goal = privateGoal(value)
  if (!goal || goal.revision <= (request.revision ?? 0) || (request.action === 'start' ? goal.id === request.goalId : goal.id !== request.goalId)) throw invalid()
  return goal
}
export function observedGoal(value: unknown, receipt: PrivateGoal | null = null): PrivateGoal | null {
  const current = privateGoal(value)
  if (receipt && (!current || current.id !== receipt.id || current.revision < receipt.revision)) throw new DeckError('bot/stale', '当前状态尚未包含已返回的目标操作，请重新核对。')
  return current
}
export function goalFailure(value: unknown): string {
  switch (errorCode(value)) {
    case 'bot/stale': return '目标或当前私聊已变化；输入已保留，请重新读取后核对。'
    case 'bot/busy': return '已有未结束目标或服务器正在处理其他操作，请重新核对。'
    case 'bot/invalid': return '目标参数不符合要求，请检查目标和验收标准。'
    case 'bot/refused': case 'HTTP_401': case 'HTTP_403': return '服务器拒绝目标操作，请核对设备授权与消息发送方式；启动或恢复目标需要 steer。'
    case 'bot/read-only': return '连接或服务器当前只读，目标操作暂不可用。'
    case 'bot/not-found': return '目标 Bot 或接口已不存在，请核对服务器版本。'
    case 'bot/incompatible': return '服务器目标状态格式不兼容，未使用该回包。'
    default: return '目标操作结果待确认；没有重发，请查询服务器状态。'
  }
}
export interface GoalOperation { readonly target: GoalTarget; readonly kind: 'write' | 'read'; phase: 'busy' | 'unknown'; message: string | null }
// 同一服务器视图的状态条和设置共用锁；关闭面板仍记住未确认请求。
export class GoalOperations {
  private readonly items = new Map<string, GoalOperation>()
  private readonly listeners = new Set<() => void>()
  revision = 0
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void { this.revision += 1; for (const listener of this.listeners) listener() }
  get(botId: string): GoalOperation | undefined { return this.items.get(botId) }
  begin(target: GoalTarget, kind: 'write' | 'read'): GoalOperation {
    const current = this.get(target.botId)
    if (current?.phase === 'busy' || kind === 'write' && current) throw new DeckError('bot/busy', '请先核对上次目标操作。')
    if (!current && this.items.size >= 128) throw new DeckError('bot/busy', '待确认目标数量达到上限，请先处理已有目标。')
    const operation: GoalOperation = { target: { ...target }, kind, phase: 'busy', message: null }
    this.items.set(target.botId, operation); this.changed(); return operation
  }
  uncertain(operation: GoalOperation, message: string): void {
    if (this.get(operation.target.botId) !== operation) return
    if (operation.phase === 'unknown' && operation.message === message) return
    operation.phase = 'unknown'; operation.message = message; this.changed()
  }
  finish(operation: GoalOperation): void {
    if (this.get(operation.target.botId) !== operation) return
    this.items.delete(operation.target.botId); this.changed()
  }
}
