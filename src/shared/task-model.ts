// SPDX-License-Identifier: Apache-2.0
// 四色依据任务和待交互事实；网络状态由 ServerView 单独标记。
import type { Avatar, Counts, Entity, EntityKind, TeamView } from './domain.ts'
import { emptyCounts, entityKey } from './domain.ts'
import { DeckError, finite, record, text, validEntityId } from './validation.ts'

const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record).filter((entry): entry is Record<string, unknown> => entry !== null) : []
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(validEntityId) : []
const pendingRequests = (value: unknown): boolean => list(value).some(entry => entry.status === 'pending')
const stamp = (task: Record<string, unknown>): string => `${text(task.id, 256)}:${text(task.status, 40)}:${finite(task.endedAt) ? task.endedAt : finite(task.updatedAt) ? task.updatedAt : 0}`
function avatarOf(value: unknown): Avatar | undefined {
  const avatar = record(value)
  if (!avatar) return undefined
  const shape = text(avatar.shape, 80)
  const image = typeof avatar.image === 'string' && avatar.image.length <= 4 * 1024 * 1024 && /^data:image\//.test(avatar.image) ? avatar.image : undefined
  return { ...(shape ? { shape } : {}), ...(image ? { image } : {}) }
}
export function countEntities(entities: readonly Entity[]): Counts {
  const counts = emptyCounts()
  for (const entity of entities) if (entity.followed && entity.task !== null) counts[entity.task] += 1
  return counts
}
export class TaskModel {
  private initialized = false
  private readonly completed = new Set<string>()
  private readonly pending = new Map<string, Map<string, string>>()
  private readonly taskScopes = new Map<string, string>()
  private readonly acknowledgedFailures = new Set<string>()
  private serial = 0
  pendingToken(key: string, taskId: string | null = null): string | null { return this.pending.get(key)?.get(taskId === null ? 'chat' : `task:${taskId}`) ?? null }
  taskKey(botId: string, taskId: string): string | null { return this.taskScopes.get(`${botId}\0${taskId}`) ?? null }
  private notePending(key: string, token: string, taskId: string | null = null): void {
    const pending = this.pending.get(key) ?? new Map<string, string>()
    pending.set(taskId === null ? 'chat' : `task:${taskId}`, token); this.pending.set(key, pending)
  }
  acknowledge(key: string, token: string | null, taskId: string | null = null): boolean {
    if (token === null || this.pendingToken(key, taskId) !== token) return false
    const pending = this.pending.get(key)
    pending?.delete(taskId === null ? 'chat' : `task:${taskId}`)
    if (pending?.size === 0) this.pending.delete(key)
    return true
  }
  acknowledgeFailure(taskId: string): void { this.acknowledgedFailures.add(taskId) }
  notice(value: unknown, boot: string): boolean {
    const notice = record(value)
    if (!notice || !['message', 'group', 'done'].includes(text(notice.kind))) return false
    const kind: EntityKind = validEntityId(notice.roomId) ? 'room' : 'bot'
    const id = kind === 'room' ? notice.roomId : notice.botId
    if (!validEntityId(id)) return false
    this.serial += 1
    this.notePending(entityKey(kind, id), `${boot}:${finite(notice.seq) ? notice.seq : this.serial}`, validEntityId(notice.taskId) ? notice.taskId : null)
    return true
  }
  project(value: unknown, unfollowed: readonly string[] = []): TeamView {
    const raw = record(value)
    if (!raw || !Array.isArray(raw.bots) || (raw.rooms !== undefined && !Array.isArray(raw.rooms))) throw new DeckError('bot/incompatible', '远程团队状态格式不兼容；保留上次有效缓存。')
    const work = record(raw.work) ?? {}
    const doing = record(work.bots) ?? {}
    const groups = record(work.rooms) ?? {}
    const approvals = list(work.approvals)
    const questions = record(raw.questions) ?? {}
    const views = record(raw.views) ?? {}
    const learning = record(raw.learning) ?? {}
    const secrets = record(raw.secretRequests) ?? {}
    const connectors = record(raw.connectorRequests) ?? {}
    const mail = record(raw.mailRequests) ?? {}
    const excluded = new Set(unfollowed)
    const entities: Entity[] = []
    const made = new Set<string>()
    const bots = list(raw.bots)
    const rooms = list(raw.rooms)
    const allTasks = bots.flatMap(bot => list(bot.tasks).map(task => ({ task, botId: text(bot.id, 256) })))
    this.taskScopes.clear()
    for (const [kind, items] of [['bot', bots], ['room', rooms]] as const) {
      for (const item of items) {
        if (!validEntityId(item.id)) continue
        const id = item.id
        const key = entityKey(kind, id)
        if (made.has(key)) continue
        made.add(key)
        const part = validEntityId(item.sessionId) ? item.sessionId : strings(item.parts).at(-1) ?? id
        const scopedTasks = kind === 'bot' ? allTasks.filter(entry => entry.botId === id && !entry.task.roomId) : allTasks.filter(entry => entry.task.roomId === id)
        const tasks = scopedTasks.map(entry => entry.task)
        for (const { task, botId } of scopedTasks) {
          if (!validEntityId(task.id)) continue
          this.taskScopes.set(`${botId}\0${task.id}`, key)
          if (task.status !== 'completed') continue
          const fingerprint = `${key}:${stamp(task)}`
          if (!this.completed.has(fingerprint)) {
            if (this.initialized) this.notePending(key, fingerprint, task.id)
            this.completed.add(fingerprint)
          }
        }
        const pendingApproval = approvals.some(entry => entry.answerable !== false && (kind === 'room' ? entry.roomId === id : entry.botId === id && entry.roomId === undefined))
        const ask = questions[part] !== undefined || views[part] !== undefined
        const card = kind === 'bot' && (pendingRequests(secrets[id]) || pendingRequests(connectors[id]) || pendingRequests(mail[id]) || list(learning[id]).length > 0)
        const blocked = kind === 'bot' && record(item.blocked) !== null
        const failed = tasks.find(task => task.status === 'failed' && !this.acknowledgedFailures.has(text(task.id, 256)))
        const taskApproval = tasks.some(task => task.status === 'waiting_approval')
        const botDoing = record(doing[id])
        const busy = kind === 'room' ? list(groups[id]).length > 0
          : botDoing !== null || Object.values(groups).some(group => list(group).some(entry => entry.botId === id)) || tasks.some(task => task.running === true || task.status === 'running' || task.status === 'waiting_work')
        const wait = pendingApproval || ask || card || taskApproval || item.waiting === true
        const color = wait ? 'yellow' : blocked || failed ? 'red' : busy ? 'green' : this.pending.has(key) ? 'blue' : null
        const detail = wait ? '等待你的交互' : blocked ? '模型或凭据明确阻塞' : failed ? text(failed.error || failed.summary, 160) || '后台任务明确失败'
          : busy ? '远程工作进行中' : color === 'blue' ? '新结果待查看' : '没有待关注任务'
        entities.push({
          key, id, kind, name: text(item.name, 160) || (kind === 'bot' ? 'Bot' : '群聊'), sessionId: part,
          sectionId: validEntityId(item.sectionId) ? item.sectionId : null,
          main: kind === 'bot' && (item.main === true || raw.mainBotId === id || strings(raw.mainBotIds).includes(id)),
          private: item.private === true, hidden: item.hidden === true,
          ...(typeof item.color === 'string' ? { color: text(item.color, 80) } : {}),
          ...(avatarOf(item.avatar) ? { avatar: avatarOf(item.avatar) } : {}),
          members: strings(item.members), task: color, detail, followed: (item.hidden !== true || item.main === true || raw.mainBotId === id || strings(raw.mainBotIds).includes(id)) && !excluded.has(key),
        })
      }
    }
    for (const key of this.pending.keys()) if (!made.has(key)) this.pending.delete(key)
    while (this.completed.size > 20000) {
      const oldest = this.completed.values().next().value
      if (oldest === undefined) break
      this.completed.delete(oldest)
    }
    this.initialized = true
    return {
      revision: finite(raw.revision) ? raw.revision : -1,
      version: text(raw.version, 80) || null,
      entities,
      sections: list(raw.sections).filter(section => validEntityId(section.id)).map(section => ({ id: String(section.id), name: text(section.name, 160) || '分组' })),
      prefs: record(raw.prefs) ?? {}, truncated: false,
    }
  }
}
