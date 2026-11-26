// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { entityKey } from '../src/shared/domain.ts'
import { countEntities, TaskModel } from '../src/shared/task-model.ts'
const team = (extra: Record<string, unknown> = {}) => ({ revision: 1, bots: [{ id: 'bot-a', name: 'Chief', sessionId: 'part-a', tasks: [] }], rooms: [], work: { bots: {}, rooms: {}, approvals: [] }, ...extra })

test('冷启动旧完成不会全量生成蓝灯', () => {
  const model = new TaskModel()
  const view = model.project(team({ bots: [{ id: 'bot-a', tasks: [{ id: 'task-a', status: 'completed', endedAt: 1 }] }] }))
  assert.equal(view.entities[0].task, null)
})
test('新完成和真实回复生成蓝灯，只有对应版本的成功展示可以确认', () => {
  const model = new TaskModel(); model.project(team())
  model.notice({ kind: 'message', botId: 'bot-a', seq: 1 }, 'boot-a')
  const key = entityKey('bot', 'bot-a')
  const first = model.pendingToken(key)
  assert.equal(model.project(team()).entities[0].task, 'blue')
  model.notice({ kind: 'message', botId: 'bot-a', seq: 2 }, 'boot-a')
  assert.equal(model.acknowledge(key, first), false)
  assert.equal(model.acknowledge(key, model.pendingToken(key)), true)
  assert.equal(model.project(team()).entities[0].task, null)
})
test('审批覆盖运行，而组审批归属于群聊', () => {
  const model = new TaskModel()
  const value = team({ rooms: [{ id: 'room-a', name: '项目组', members: ['bot-a'] }], work: { bots: { 'bot-a': { tool: 'read' } }, rooms: {}, approvals: [{ botId: 'bot-a', roomId: 'room-a' }] } })
  const view = model.project(value)
  assert.equal(view.entities.find(entity => entity.kind === 'bot')?.task, 'green')
  assert.equal(view.entities.find(entity => entity.kind === 'room')?.task, 'yellow')
})
test('待请求、提问和明确凭据失败来自远程事实', () => {
  assert.equal(new TaskModel().project(team({ questions: { 'part-a': { id: 'question-a' } } })).entities[0].task, 'yellow')
  assert.equal(new TaskModel().project(team({ secretRequests: { 'bot-a': [{ status: 'pending' }] } })).entities[0].task, 'yellow')
  assert.equal(new TaskModel().project(team({ bots: [{ id: 'bot-a', blocked: { code: 'ACCOUNT_QUOTA' } }] })).entities[0].task, 'red')
})
test('同一对象多个后台结果分别确认，打开聊天不会冒充查看任务结果', () => {
  const model = new TaskModel(); model.project(team())
  const done = team({ bots: [{ id: 'bot-a', tasks: [{ id: 'task-a', status: 'completed', endedAt: 1 }, { id: 'task-b', status: 'completed', endedAt: 2 }] }] })
  model.project(done)
  const key = 'bot:bot-a'
  assert.equal(model.pendingToken(key), null)
  assert.equal(model.acknowledge(key, model.pendingToken(key, 'task-a'), 'task-a'), true)
  assert.equal(model.project(done).entities[0].task, 'blue')
  assert.equal(model.acknowledge(key, model.pendingToken(key, 'task-b'), 'task-b'), true)
  assert.equal(model.project(done).entities[0].task, null)
})
test('群聊后台任务归属群聊，不把失败或完成混进 Bot 私聊', () => {
  const model = new TaskModel()
  const state = team({ bots: [{ id: 'bot-a', tasks: [{ id: 'group-task', roomId: 'room-a', status: 'failed' }] }], rooms: [{ id: 'room-a', members: ['bot-a'] }] })
  const view = model.project(state)
  assert.equal(view.entities.find(entity => entity.kind === 'bot')?.task, null)
  assert.equal(view.entities.find(entity => entity.kind === 'room')?.task, 'red')
  assert.equal(model.taskKey('bot-a', 'group-task'), 'room:room-a')
})
test('当前运行覆盖旧阻塞，待交互仍优先，运行结束不会伪造成功清除阻塞', () => {
  const model = new TaskModel()
  const blocked = team({ bots: [{ id: 'bot-a', blocked: { code: 'ACCOUNT_QUOTA' } }] })
  assert.equal(model.project(blocked).entities[0].task, 'red')
  const working = { ...blocked, work: { bots: { 'bot-a': { tool: 'read', since: 2 } }, rooms: {}, approvals: [] } }
  const active = model.project(working).entities[0]
  assert.equal(active.task, 'green'); assert.equal(active.detail, '远程工作进行中')
  assert.equal(model.project({ ...working, questions: { 'bot-a': { id: 'question-a' } } }).entities[0].task, 'yellow')
  assert.equal(model.project(blocked).entities[0].task, 'red')
  model.notice({ kind: 'message', botId: 'bot-a', seq: 1 }, 'boot-a')
  assert.equal(model.project(team()).entities[0].task, 'blue')
})
test('新工作不会永久确认旧失败，群聊活动和失败仍按原归属计算', () => {
  const model = new TaskModel()
  const failed = team({ bots: [{ id: 'bot-a', tasks: [{ id: 'failed-a', status: 'failed', error: '旧任务失败' }] }] })
  assert.equal(model.project({ ...failed, work: { bots: { 'bot-a': { tool: 'read' } }, rooms: {} } }).entities[0].task, 'green')
  assert.equal(model.project(failed).entities[0].task, 'red')
  const group = { ...failed, rooms: [{ id: 'room-a' }], bots: [{ id: 'bot-a', tasks: [{ id: 'failed-group', roomId: 'room-a', status: 'failed' }] }], work: { bots: {}, rooms: { 'room-a': [{ botId: 'bot-a', tool: 'read' }] } } }
  const view = model.project(group)
  assert.equal(view.entities.find(entity => entity.kind === 'room')?.task, 'green')
  assert.equal(view.entities.find(entity => entity.kind === 'bot')?.task, 'green')
  assert.equal(model.project({ ...group, work: { bots: {}, rooms: {} } }).entities.find(entity => entity.kind === 'room')?.task, 'red')
})
test('私聊已正常回复且阻塞撤销，独立后台失败和另一Bot故障仍保留各自事实', () => {
  const model = new TaskModel()
  const failedTask = { id: 'task-old', status: 'failed', error: '独立后台任务失败', endedAt: 8 }
  const initial = team({ bots: [
    { id: 'bot-a', blocked: { code: 'ACCOUNT_QUOTA' }, tasks: [failedTask] },
    { id: 'bot-b', blocked: { code: 'AUTH' }, tasks: [] },
  ] })
  model.project(initial)
  model.notice({ kind: 'message', botId: 'bot-a', seq: 9 }, 'boot-a')
  const completed = team({ bots: [
    { id: 'bot-a', tasks: [failedTask] },
    { id: 'bot-b', blocked: { code: 'AUTH' }, tasks: [] },
  ] })
  const before = structuredClone(completed)
  const view = model.project(completed)
  const own = view.entities.find(entity => entity.id === 'bot-a')
  assert.equal(own?.task, 'red'); assert.equal(own?.detail, '独立后台任务失败')
  assert.equal(view.entities.find(entity => entity.id === 'bot-b')?.task, 'red')
  assert.notEqual(model.pendingToken('bot:bot-a'), null)
  assert.deepEqual(countEntities(view.entities), { green: 0, yellow: 0, red: 2, blue: 0 })
  assert.deepEqual(completed, before)
})
test('部分回复、取消和普通结果通知不代替完成快照或清除真实阻塞', () => {
  const model = new TaskModel()
  const blocked = team({ bots: [{ id: 'bot-a', blocked: { code: 'ACCOUNT_QUOTA' } }] })
  model.project(blocked)
  assert.equal(model.notice({ kind: 'stream', botId: 'bot-a', seq: 1 }, 'boot-a'), false)
  assert.equal(model.notice({ kind: 'stopped', botId: 'bot-a', seq: 2 }, 'boot-a'), false)
  assert.equal(model.project(blocked).entities[0].task, 'red')
  model.notice({ kind: 'done', botId: 'bot-a', seq: 3 }, 'boot-a')
  assert.equal(model.project(blocked).entities[0].task, 'red')
  assert.equal(model.project({ ...blocked, work: { bots: { 'bot-a': { tool: 'read' } }, rooms: {} } }).entities[0].task, 'green')
  assert.equal(model.project(blocked).entities[0].task, 'red')
  assert.equal(model.project(team()).entities[0].task, 'blue')
})
test('新建会话或暂停回执不代替故障恢复，换Session仍保留服务器blocked', () => {
  const model = new TaskModel()
  const before = team({ bots: [{ id: 'bot-a', sessionId: 'part-a', blocked: { code: 'ACCOUNT_QUOTA' } }] })
  model.project(before)
  assert.equal(model.notice({ kind: 'tool-result', botId: 'bot-a', seq: 1, result: { paused: true, session_changed: true, recovery_verified: false } }, 'boot-a'), false)
  const after = team({ bots: [{ id: 'bot-a', sessionId: 'part-b', blocked: { code: 'ACCOUNT_QUOTA' } }] })
  const copy = structuredClone(after)
  assert.equal(model.project(after).entities[0].task, 'red')
  assert.equal(model.pendingToken('bot:bot-a'), null)
  assert.deepEqual(after, copy)
})
test('停止和中断不冒充明确失败，取消关注不计数', () => {
  const model = new TaskModel()
  const view = model.project(team({ bots: [{ id: 'bot-a', tasks: [{ id: 'task-a', status: 'interrupted' }, { id: 'task-b', status: 'stopped' }] }] }))
  assert.equal(view.entities[0].task, null)
  const failed = model.project(team({ bots: [{ id: 'bot-a', tasks: [{ id: 'task-c', status: 'failed' }] }] }), ['bot:bot-a'])
  assert.equal(failed.entities[0].task, 'red')
  assert.deepEqual(countEntities(failed.entities), { green: 0, yellow: 0, red: 0, blue: 0 })
})
