// SPDX-License-Identifier: Apache-2.0
// 资源读取只绑定已核对的模块、真实目标和本次读取代次，不回退到任意会话接口。
import { DeckError, errorCode, record } from './validation.ts'
import { DetailReadQueue } from './extra-read-model.ts'

export type ResourceModule = 'delegations' | 'workspace' | 'toolChanges' | 'terminals'
export type ResourceScope = { kind: 'bot'; botId: string } | { kind: 'room'; roomId: string } | { kind: 'task'; botId: string; taskId: string }
export interface ResourceTarget { scope: ResourceScope; sessionId: string }
export interface ModuleAccess { state: 'missing' | 'incompatible' | 'denied' | 'ready'; write: boolean }
export const resourceId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s\p{Cc}]/u.test(value)
export const ordinal = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const resourceFormat = (): DeckError => new DeckError('bot/incompatible', '服务器资源数据格式不兼容，未显示未经核对的内容。')
export function boundedText(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw resourceFormat()
  return value
}
export function moduleAccess(value: unknown, name: ResourceModule): ModuleAccess {
  const extras = record(value); const module = record(extras?.[name])
  if (!extras || extras.schema === undefined || extras[name] === undefined) return { state: 'missing', write: false }
  if (extras.schema !== 1 || !module || module.schema !== 1 || typeof module.read !== 'boolean') return { state: 'incompatible', write: false }
  const allowed = module.read === true && (name === 'workspace' || name === 'terminals' || extras.fullMessages === true)
  return { state: allowed ? 'ready' : 'denied', write: allowed && module.write === true }
}
// 任一资源授权变化都会轮换服务端资源代次；不能只观察本面板的 read 布尔值。
export function resourcePermissions(value: unknown): string {
  const extras = record(value)
  const modules = ['delegations', 'workspace', 'terminals', 'toolChanges'].map(name => {
    const module = record(extras?.[name]); return [module?.schema ?? null, module?.read ?? null, module?.write ?? null]
  })
  return JSON.stringify([extras?.schema ?? null, extras?.remotePermissions ?? null, extras?.fullMessages ?? null, ...modules])
}
export function moduleAccessText(access: ModuleAccess): string | null {
  if (access.state === 'missing') return '服务器尚未提供该模块。'
  if (access.state === 'incompatible') return '服务器模块版本不兼容，请核对服务器和客户端版本。'
  if (access.state === 'denied') return '当前设备未获读取授权，请在服务器「连接 → 手机」检查对应权限。'
  return null
}
export function resourceAccessFailure(value: unknown): boolean { return ['bot/refused', 'HTTP_401', 'HTTP_403'].includes(errorCode(value)) }
export function resourceFailure(value: unknown): string {
  switch (errorCode(value)) {
    case 'bot/refused': case 'HTTP_401': case 'HTTP_403': return '读取被拒绝或授权已变化，旧内容已清空，请在服务器核对设备授权。'
    case 'bot/stale': return '原会话、资源句柄或分页已失效，请重新打开；没有切换到其他目标。'
    case 'bot/conflict': return '读取期间内容已变化，请重新读取；没有使用旧分页拼接新内容。'
    case 'bot/not-found': return '服务器找不到此资源或记录，没有把错误当作空列表。'
    case 'bot/too-large': return '内容超过完整读取预算，请在服务器查看。'
    case 'bot/encoding': return '该文件不是可完整读取的 UTF-8 文本，不能在这里预览。'
    case 'bot/incompatible': return '服务器数据格式不兼容，旧内容已清空。'
    case 'bot/busy': return '服务器正在处理其他读取，请稍后手动重试。'
    case 'bot/unavailable': return '资源服务、历史记录或密钥保护暂不可用，请在服务器核对后重试。'
    case 'bot/read-only': case 'RPC_ABORTED': return '读取已取消或当前为缓存，请恢复连接后重新打开。'
    default: return '资源读取失败，请稍后手动重试；没有降级到其他接口。'
  }
}
export function resourceTarget(value: unknown): ResourceTarget {
  const target = record(value); const scope = record(target?.scope)
  if (!target || !resourceId(target.sessionId) || !scope) throw resourceFormat()
  if (scope.kind === 'bot' && resourceId(scope.botId)) return { scope: { kind: 'bot', botId: scope.botId }, sessionId: target.sessionId }
  if (scope.kind === 'room' && resourceId(scope.roomId)) return { scope: { kind: 'room', roomId: scope.roomId }, sessionId: target.sessionId }
  if (scope.kind === 'task' && resourceId(scope.botId) && resourceId(scope.taskId)) return { scope: { kind: 'task', botId: scope.botId, taskId: scope.taskId }, sessionId: target.sessionId }
  throw resourceFormat()
}
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter(resourceId) : []
const own = (table: unknown, key: string): Record<string, unknown> | null => {
  const entries = record(table)
  return entries && Object.hasOwn(entries, key) ? record(entries[key]) : null
}
// 后台会话在原目录中也映射到 Bot；必须先匹配后台任务，不能当作前台私聊。
export function sessionResourceTarget(value: unknown, sessionId: unknown): ResourceTarget | null {
  const roster = record(value)
  if (!roster || !resourceId(sessionId)) return null
  const room = own(roster.roomsById, sessionId)
  if (room && resourceId(room.id) && [room.id, room.sessionId, ...ids(room.ownParts)].includes(sessionId)) return { scope: { kind: 'room', roomId: room.id }, sessionId }
  const bot = own(roster.byId, sessionId)
  if (!bot || !resourceId(bot.id)) return null
  for (const item of Array.isArray(bot.tasks) ? bot.tasks : []) {
    const task = record(item)
    if (task && resourceId(task.id) && [task.sessionId, ...ids(task.parts)].includes(sessionId)) return { scope: { kind: 'task', botId: bot.id, taskId: task.id }, sessionId }
  }
  return [bot.id, bot.sessionId, ...ids(bot.parts)].includes(sessionId) ? { scope: { kind: 'bot', botId: bot.id }, sessionId } : null
}
export function resourceSessions(value: unknown, target: ResourceTarget): string[] {
  const roster = record(value); const scope = target.scope
  let parts: unknown[] = []
  if (scope.kind === 'room') {
    const room = own(roster?.roomsById, scope.roomId)
    parts = [room?.sessionId ?? room?.id, ...ids(room?.ownParts), ...ids(room?.parts)]
  } else {
    const bot = own(roster?.byId, scope.botId)
    if (scope.kind === 'bot') parts = [bot?.sessionId ?? bot?.id, ...ids(bot?.parts)]
    else {
      const task = (Array.isArray(bot?.tasks) ? bot.tasks : []).map(record).find(item => item?.id === scope.taskId)
      parts = [task?.sessionId, ...ids(task?.parts)]
    }
  }
  return [...new Set([target.sessionId, ...parts.filter(resourceId)])].slice(0, 256)
}
export function currentResourceSession(value: unknown, target: ResourceTarget): boolean {
  const roster = record(value); const scope = target.scope
  if (scope.kind === 'room') { const room = own(roster?.roomsById, scope.roomId); return (room?.sessionId ?? room?.id) === target.sessionId }
  const bot = own(roster?.byId, scope.botId)
  if (scope.kind === 'bot') return (bot?.sessionId ?? bot?.id) === target.sessionId
  return (Array.isArray(bot?.tasks) ? bot.tasks : []).some(item => { const task = record(item); return task?.id === scope.taskId && task.sessionId === target.sessionId })
}
const resourceQueue = new DetailReadQueue(3)
export class ScopedResourceRead {
  private generation = 0
  private controller: AbortController | null = null
  get busy(): boolean { return this.controller !== null }
  cancel(): void { this.generation += 1; this.controller?.abort(); this.controller = null }
  async read<T>(load: (signal: AbortSignal) => Promise<T>, available: () => boolean): Promise<T> {
    if (this.busy) throw new DeckError('bot/busy', '当前资源正在读取。')
    const generation = this.generation; const controller = new AbortController(); this.controller = controller
    const current = () => this.generation === generation && this.controller === controller && !controller.signal.aborted && available()
    try { return await resourceQueue.read(() => load(controller.signal), controller.signal, current) }
    finally { if (this.controller === controller) this.controller = null }
  }
}
