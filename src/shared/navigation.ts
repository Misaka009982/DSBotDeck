// SPDX-License-Identifier: Apache-2.0
// 导航使用公开目录，不把 Bot 分段会话显示成独立手动列表。
import type { ContentCommand, Entity, ServerView, TeamView } from './domain.ts'
export const settingsCommand = (entity: Pick<Entity, 'kind' | 'id'>): ContentCommand => ({ action: 'settings', page: entity.kind === 'room' ? 'groups' : 'bots', id: entity.id })
export interface EntityGroup { id: string; label: string; entities: Entity[] }
export function groupEntities(team: TeamView | null, search = ''): EntityGroup[] {
  if (!team) return []
  const query = search.trim().toLocaleLowerCase()
  const visible = team.entities.filter(entity => !entity.hidden || entity.main).filter(entity => !query || entity.name.toLocaleLowerCase().includes(query))
  const grouped: EntityGroup[] = [{ id: 'main', label: '主 Bot', entities: visible.filter(entity => entity.main) }]
  const sections = new Map(team.sections.map(section => [section.id, section.name]))
  for (const entity of visible.filter(item => !item.main)) {
    const id = entity.sectionId ?? (entity.kind === 'room' ? 'rooms' : entity.private ? 'private' : 'bots')
    let group = grouped.find(item => item.id === id)
    if (!group) { group = { id, label: sections.get(id) ?? (id === 'rooms' ? '群聊' : id === 'private' ? '私密 Bot' : 'Bot'), entities: [] }; grouped.push(group) }
    group.entities.push(entity)
  }
  return grouped.filter(group => group.entities.length > 0)
}
export const serverLabel = (state: ServerView['state']): string => ({ unpaired: '待配对', connecting: '连接中', ready: '已连接', reconnecting: '恢复中', disconnected: '已断开', 'needs-pairing': '需要重新配对', incompatible: '版本不兼容' })[state]
export function visibleServers(servers: readonly ServerView[], search: string): ServerView[] {
  const query = search.trim().toLocaleLowerCase()
  return query ? servers.filter(server => server.alias.toLocaleLowerCase().includes(query) || groupEntities(server.team, query).length > 0) : [...servers]
}
