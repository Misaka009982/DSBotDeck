// SPDX-License-Identifier: Apache-2.0
// 只给当前普通私聊显示服务器仍允许作答的工具审批；群聊和后台走原组件。
import { record, validEntityId } from './validation.ts'
export function foregroundApprovals(work: unknown, botId: unknown, sessionId: unknown): Record<string, unknown>[] {
  if (!validEntityId(botId) || !validEntityId(sessionId)) return []
  const items = record(work)?.approvals
  if (!Array.isArray(items)) return []
  return items.flatMap(value => {
    const entry = record(value)
    if (!entry || !validEntityId(entry.id) || entry.botId !== botId || entry.sessionId !== sessionId
      || entry.roomId !== undefined || entry.taskId !== undefined || entry.answerable !== true
      || typeof entry.tool !== 'string' || typeof entry.reason !== 'string') return []
    const detail = entry.detail === undefined ? {} : record(entry.detail)
    if (!detail || (detail.text !== undefined && typeof detail.text !== 'string')
      || (detail.code !== undefined && typeof detail.code !== 'string')) return []
    return [entry]
  })
}
