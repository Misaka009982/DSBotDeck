// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Entity, TeamView } from '../src/shared/domain.ts'
import { groupEntities, settingsCommand } from '../src/shared/navigation.ts'
const bot = (id: string, patch: Partial<Entity> = {}): Entity => ({ key: `bot:${id}`, id, kind: 'bot', name: id, sessionId: `${id}-latest-part`, sectionId: null, main: false, private: false, hidden: false, members: [], task: null, detail: '', followed: true, ...patch })
test('保留上游分组、主 Bot 与群聊身份，不展开分段会话', () => {
  const team: TeamView = { revision: 1, version: 'fixture', prefs: {}, truncated: false, sections: [{ id: 'project-a', name: '项目 A' }], entities: [bot('chief', { main: true }), bot('worker', { sectionId: 'project-a' }), bot('group', { kind: 'room', key: 'room:group' }), bot('hidden', { hidden: true })] }
  assert.deepEqual(groupEntities(team).map(group => group.label), ['主 Bot', '项目 A', '群聊'])
  assert.deepEqual(groupEntities(team, 'work').flatMap(group => group.entities).map(entity => entity.id), ['worker'])
  assert.equal(groupEntities(team).flatMap(group => group.entities).some(entity => entity.id.endsWith('-latest-part')), false)
})
test('参数入口绑定原 Bot 或群聊的稳定编号，不用当前分段替代', () => {
  assert.deepEqual(settingsCommand(bot('worker')), { action: 'settings', page: 'bots', id: 'worker' })
  assert.deepEqual(settingsCommand(bot('group', { kind: 'room' })), { action: 'settings', page: 'groups', id: 'group' })
})
