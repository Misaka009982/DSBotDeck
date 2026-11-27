// SPDX-License-Identifier: Apache-2.0
// 只定义回归：目标协议、归属和未确认操作；不调用真实服务器。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { GoalOperations, goalLive, goalReply, goalRequest, observedGoal, privateGoal, privateGoalCanRun, privateGoalChatTarget, privateGoalMode, privateGoalTarget } from '../src/shared/private-goal.ts'
const goal = () => ({ schema: 1 as const, id: 'goal-a', revision: 3, status: 'active' as const, objective: '完成接口改造', acceptance: '按要求核对所有接口', progress: '', evidence: '', reason: '', rounds: 2, emptyTurns: 0, updatedAt: 100 })
const target = { botId: 'bot-a', sessionId: 'part-a' }
const roster = () => {
  const bot = { id: 'bot-a', sessionId: 'part-a', parts: ['older-a'], tasks: [{ id: 'task-a', sessionId: 'task-part' }], extras: { goal: goal() } }
  return { extras: { schema: 1, privateGoal: { schema: 1 } }, byId: { 'bot-a': bot, 'part-a': bot, 'older-a': bot, 'task-part': bot }, roomsById: { room: { id: 'room' } } }
}
test('仅声明过的当前Bot私聊出现目标入口，旧段、后台、群与同名不匹配', () => {
  const value = roster()
  assert.equal(privateGoalMode(value), 'ready')
  assert.deepEqual(privateGoalTarget(value, 'bot-a'), target)
  assert.deepEqual(privateGoalChatTarget(value, 'part-a'), target)
  for (const session of ['bot-a', 'older-a', 'task-part', 'room', 'unknown', undefined]) assert.equal(privateGoalChatTarget(value, session), null)
  assert.equal(privateGoalTarget(value, 'part-a'), null)
  assert.equal(privateGoalMode({}), 'missing')
  assert.equal(privateGoalMode({ extras: { schema: 1, privateGoal: { schema: 2 } } }), 'incompatible')
  assert.equal(privateGoalChatTarget({ ...value, extras: {} }, 'part-a'), null)
  const inherited = Object.create(value.byId)
  assert.equal(privateGoalTarget({ ...value, byId: inherited }, 'bot-a'), null)
})
test('目标只在有效steer下可启动或恢复，独立方式优先且DSH默认不推定为steer', () => {
  for (const mode of [undefined, null, 'inherit', 'queue', 'steer']) {
    for (const defaultMode of [undefined, null, 'queue', 'steer']) {
      const value = roster()
      const current = { ...value.byId['bot-a'], extras: { goal: goal(), messageMode: mode } }
      const configured = { ...value, extras: { ...value.extras, defaults: { messageMode: defaultMode } }, byId: { ...value.byId, 'bot-a': current } }
      const expected = mode === 'steer' || mode !== 'queue' && defaultMode === 'steer'
      assert.equal(privateGoalCanRun(configured, 'bot-a'), expected, `Bot=${mode}, defaults=${defaultMode}`)
      assert.equal(privateGoalCanRun(configured, 'part-a'), false)
      assert.equal(privateGoalCanRun({ ...configured, extras: {} }, 'bot-a'), false)
      assert.equal(current.extras.goal.status, 'active')
    }
  }
  assert.equal(privateGoalCanRun(null, 'bot-a'), false)
})
test('目标DTO只取公开字段，坏状态和超预算不显示为已完成', () => {
  const value = goal()
  assert.deepEqual(privateGoal({ ...value, activation: 'internal', runId: 'internal' }), value)
  assert.equal(privateGoal(null), null)
  for (const patch of [{ schema: 2 }, { status: 'success' }, { revision: -1 }, { objective: '' }, { evidence: 'x'.repeat(4001) }, { rounds: '1' }, { updatedAt: undefined }]) assert.throws(() => privateGoal({ ...value, ...patch }))
  assert.equal(goalLive(value), true)
  assert.equal(goalLive({ ...value, status: 'complete' }), false)
})
test('目标操作携带原Bot、当前会话、目标编号和revision，不开启模型自建目标', () => {
  const current = goal()
  const body = goalRequest(target, current, 'revise', { objective: ' 新目标 ', acceptance: ' 新标准 ' })
  assert.deepEqual(body, { ...target, action: 'revise', goalId: 'goal-a', revision: 3, objective: '新目标', acceptance: '新标准' })
  assert.throws(() => goalRequest(target, current, 'start', { objective: '新目标', acceptance: '新标准' }))
  assert.throws(() => goalRequest(target, current, 'resume'))
  assert.throws(() => goalRequest(target, null, 'stop'))
  assert.deepEqual(goalRequest(target, null, 'start', { objective: '目标', acceptance: '标准' }), { ...target, action: 'start', objective: '目标', acceptance: '标准' })
  for (const objective of ['', 'x'.repeat(4001), '\ud800']) assert.throws(() => goalRequest(target, null, 'start', { objective, acceptance: '标准' }))
  assert.equal(goalRequest(target, { ...current, status: 'paused' }, 'resume').goalId, current.id)
})
test('操作回包必须匹配原目标与新revision，不能用错目标或原状态冒充成功', () => {
  const request = goalRequest(target, goal(), 'pause')
  assert.equal(goalReply({ ...goal(), revision: 4, status: 'paused' }, request).status, 'paused')
  for (const result of [null, goal(), { ...goal(), revision: 4, id: 'other' }]) assert.throws(() => goalReply(result, request))
  const start = goalRequest(target, { ...goal(), status: 'complete' }, 'start', { objective: '新目标', acceptance: '标准' })
  assert.throws(() => goalReply({ ...goal(), revision: 4 }, start))
  assert.equal(goalReply({ ...goal(), revision: 4, id: 'new-goal' }, start).id, 'new-goal')
})
test('完整状态核对不得早于写入回执，也不以其他目标替代本次结果', () => {
  const receipt = { ...goal(), revision: 4 }
  assert.equal(observedGoal({ ...receipt, revision: 5 }, receipt)?.revision, 5)
  for (const value of [null, goal(), { ...receipt, id: 'other-goal' }]) assert.throws(() => observedGoal(value, receipt))
  assert.equal(observedGoal(null), null)
})
test('重复打开设置共享同Bot写锁，未知结果保留到显式核对，旧回包不能解锁新操作', () => {
  const operations = new GoalOperations()
  const pending = operations.begin(target, 'write')
  assert.throws(() => operations.begin(target, 'write'))
  assert.throws(() => operations.begin(target, 'read'))
  operations.uncertain(pending, '等待核对')
  assert.equal(operations.get(target.botId)?.phase, 'unknown')
  assert.throws(() => operations.begin(target, 'write'))
  const read = operations.begin(target, 'read')
  operations.finish(pending)
  assert.equal(operations.get(target.botId), read)
  const other = operations.begin({ botId: 'bot-b', sessionId: 'part-b' }, 'write')
  operations.finish(read)
  assert.equal(operations.get(target.botId), undefined)
  assert.equal(operations.get('bot-b'), other)
})
