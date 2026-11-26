// SPDX-License-Identifier: Apache-2.0
// 光标与菜单键纯模型；只定义回归，不启动客户端或发送真实消息。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { commandName, composerTrigger, menuKeyAction, replaceComposerTrigger } from '../src/shared/composer-model.ts'
import { mentionRows } from '../../DS-Bot/ds-bot/src/client/at-menu.js'
import { commandEntries } from '../../DS-Bot/ds-bot/src/client/command-actions.js'

test('提及在光标处解析，包含空格的Bot名称和后续草稿保留', () => {
  const text = '前文 @新 Bot 后文'; const caret = text.indexOf(' 后文')
  assert.deepEqual(composerTrigger(text, caret), { kind: 'mention', start: 3, end: caret, query: '新 Bot' })
  const trigger = composerTrigger(text, caret)!
  assert.deepEqual(replaceComposerTrigger(text, trigger, '@新 Bot 2 '), { text: '前文 @新 Bot 2 后文', caret: 12 })
})
test('光标在已有词中时替换整个候选词，不留下重复后缀', () => {
  const text = '前文 @Alice 后文'; const trigger = composerTrigger(text, 7)!
  assert.equal(trigger.query, 'Ali'); assert.equal(trigger.end, 9)
  assert.deepEqual(replaceComposerTrigger(text, trigger, '@Alfred '), { text: '前文 @Alfred 后文', caret: 11 })
})
test('选择范围、邮箱、路径和代码里的@不会开启提及', () => {
  for (const text of ['dev@Bot', 'https://x/@Bot', 'docs/@Bot', '`@Bot', '```js\n@Bot', '~~~\n@Bot']) assert.equal(composerTrigger(text, text.length), null)
  assert.equal(composerTrigger('@Bot', 2, 4), null)
  assert.equal(composerTrigger('@Bot', -1), null)
  assert.equal(composerTrigger('@Bot', 20), null)
  const closed = '`示例` @Bot'; assert.equal(composerTrigger(closed, closed.length)?.kind, 'mention')
})
test('斜杠菜单只从当前行开头解析，不误读网址或消息中的路径', () => {
  assert.deepEqual(composerTrigger('  /scheduled-', 13), { kind: 'command', start: 2, end: 13, query: 'scheduled-' })
  const text = '草稿\n/goal'; assert.equal(composerTrigger(text, text.length)?.start, 3)
  for (const text of ['参考 /goal', 'https://x/goal', '/goal 参数']) assert.equal(composerTrigger(text, text.length), null)
})
test('只有整段裸命令可作为动作，带参数或混合消息不被吞掉', () => {
  assert.equal(commandName(' /scheduled-task \n'), 'scheduled-task')
  assert.equal(commandName('/goal'), 'goal')
  for (const text of ['/goal 说明', '/goal\n继续', '请 /goal', '普通消息', '/']) assert.equal(commandName(text), null)
})
test('候选导航、Enter和Escape只消费菜单按键，IME和换行保持原行为', () => {
  assert.deepEqual(menuKeyAction({ key: 'ArrowDown' }, 3, 2), { kind: 'move', index: 0 })
  assert.deepEqual(menuKeyAction({ key: 'ArrowUp' }, 3, 0), { kind: 'move', index: 2 })
  assert.deepEqual(menuKeyAction({ key: 'Enter' }, 3, 1), { kind: 'pick', index: 1 })
  assert.deepEqual(menuKeyAction({ key: 'Escape' }, 0, 0), { kind: 'close' })
  for (const event of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', shiftKey: true }, { key: 'Enter', ctrlKey: true }, { key: 'ArrowUp', altKey: true }]) assert.equal(menuKeyAction(event, 3, 0), null)
  assert.equal(menuKeyAction({ key: 'Enter' }, 0, 0), null)
})
const self = { id: 'bot-a', name: '甲' }; const other = { id: 'bot-b', name: '新 Bot 2' }; const outside = { id: 'bot-c', name: '群外' }
const room = { id: 'room-a', members: [self.id, other.id, 'removed'] }
const roster = { ready: true, bots: [self, other, outside], rooms: [room], byId: { [self.id]: self, [other.id]: other, [outside.id]: outside }, roomsById: { [room.id]: room } }
test('真实上游提及规则：私聊排除自身，群聊仅列当前成员和全体', () => {
  assert.deepEqual(mentionRows(roster, self.id, '新')?.map(row => row.text), ['@新 Bot 2 '])
  assert.deepEqual(mentionRows(roster, self.id, '甲'), [])
  const members: { bot?: { id: string }; room?: { id: string }; text: string }[] = mentionRows(roster, room.id, '') ?? []
  assert.deepEqual(members.flatMap(row => row.bot ? [row.bot.id] : []), [self.id, other.id])
  assert.equal(members.filter(row => row.room).length, 1)
  assert.equal(mentionRows({ ...roster, ready: false }, self.id), null)
  assert.equal(mentionRows(roster, 'missing'), null)
})
test('真实上游命令仅复用现有定时任务和群目标动作，不伪造DSH命令', () => {
  const calls: unknown[][] = []
  const entries = commandEntries({ roster: { getSnapshot: () => roster }, actions: { openSettings: (...args: unknown[]) => calls.push(args), composeGoal: (id: string) => calls.push(['goal', id]) } })
  assert.deepEqual(entries.contributions.map(entry => entry.name), ['scheduled-task'])
  assert.deepEqual(entries.decorations.map(entry => entry.name), ['goal'])
  assert.equal(entries.contributions[0].available({ sessionId: self.id }), true)
  assert.equal(entries.contributions[0].available({ sessionId: 'missing' }), false)
  assert.equal(entries.decorations[0].available({ sessionId: self.id }), false)
  assert.equal(entries.decorations[0].available({ sessionId: room.id }), true)
  entries.contributions[0].ui.run({ sessionId: self.id }); entries.contributions[0].ui.run({ sessionId: room.id }); entries.decorations[0].ui.run({ sessionId: room.id })
  assert.deepEqual(calls, [['schedules', 'bot:bot-a'], ['schedules', 'room:room-a'], ['goal', 'room-a']])
})
