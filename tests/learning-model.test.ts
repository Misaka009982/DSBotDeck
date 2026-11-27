// SPDX-License-Identifier: Apache-2.0
// 学习提案只按当前私聊与原提案编号操作，不从按钮状态推断远程保存。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { LearningAnswers, learningLiveChanges, learningProposals, learningRequest, learningTarget } from '../src/shared/learning-model.ts'
const target = { botId: 'bot-a', sessionId: 'part-a' }
const skill = () => ({ id: 'skill-a', kind: 'skill', botId: 'bot-a', action: 'update', name: 'review', description: '新说明', content: '新内容', previous: { description: '旧说明', content: '旧内容' }, why: '改善核对流程' })
const agents = () => ({ id: 'agents-a', kind: 'agents', botId: 'bot-a', folder: '/tmp/project', edits: [{ op: 'replace', old: '旧规则', text: '新规则', why: '补充核对条件' }] })
const roster = () => {
  const bot = { id: 'bot-a', sessionId: 'part-a', parts: ['old-a'], tasks: [{ id: 'task-a', sessionId: 'background-a' }] }
  return { byId: { 'bot-a': bot, 'part-a': bot, 'old-a': bot, 'background-a': bot }, roomsById: {}, learning: { 'bot-a': [skill(), agents()] }, learningSettled: {}, readOnly: null }
}
test('学习提案在revision不变的增量里新增、结算和清空；缺省字段不误清旧状态', () => {
  const current = { ...roster(), revision: 1 }
  const live = { revision: 1, unchanged: true, learning: {}, learningSettled: { 'bot-a': [{ ...skill(), sessionId: 'part-a', outcome: 'approved' }] }, readOnly: '服务器只读' }
  const changed = learningLiveChanges(current, live)
  assert.deepEqual(changed, { learning: {}, learningSettled: live.learningSettled, readOnly: '服务器只读' })
  assert.deepEqual(learningLiveChanges(current, { revision: 1, unchanged: true }), {})
  assert.deepEqual(learningLiveChanges(live, { readOnly: null }), { readOnly: null })
  assert.equal(current.learning['bot-a'].length, 2)
})
test('当前私聊保留技能与AGENTS.md提案；同名、旧段、后台和群聊均不借用', () => {
  const value = roster()
  assert.deepEqual(learningTarget(value, 'part-a'), target)
  for (const id of ['bot-a', 'old-a', 'background-a', 'unknown', null]) assert.equal(learningTarget(value, id), null)
  assert.equal(learningTarget({ ...value, roomsById: { 'part-a': { id: 'room-a' } } }, 'part-a'), null)
  const selected = learningProposals(value, target)
  assert.deepEqual(selected.pending, [skill(), agents()]); assert.equal(selected.pending[0], value.learning['bot-a'][0])
  assert.deepEqual(learningProposals(value, null), { pending: [], settled: [] })
})
test('缺旧正文的更新、损坏编辑、重复编号和错误Bot拒绝批准，结算只留当前会话', () => {
  const value = roster()
  const broken = [{ ...skill(), previous: undefined }, { ...skill(), content: {} }, { ...skill(), botId: 'bot-b' }, { ...agents(), edits: [{ op: 'replace', text: '没有旧内容' }] }]
  for (const item of broken) assert.throws(() => learningProposals({ ...value, learning: { 'bot-a': [item] } }, target), { code: 'bot/incompatible' })
  for (const table of [null, true, []]) assert.throws(() => learningProposals({ ...value, learning: table }, target), { code: 'bot/incompatible' })
  assert.throws(() => learningProposals({ ...value, learning: { 'bot-a': [skill(), skill()] } }, target), { code: 'bot/incompatible' })
  const settled = { ...skill(), sessionId: 'part-a', outcome: 'approved' }
  assert.deepEqual(learningProposals({ ...value, learningSettled: { 'bot-a': [settled, { ...agents(), sessionId: 'old-a', outcome: 'declined' }] } }, target).settled, [settled])
})
test('批准与拒绝只回传原编号及布尔选择，提案内容或当前会话变化不提交', () => {
  const value = roster(); const proposal = learningProposals(value, target).pending[0]
  assert.deepEqual(learningRequest(value, target, proposal, true), { id: 'skill-a', approve: true })
  assert.deepEqual(learningRequest(value, target, proposal, false), { id: 'skill-a', approve: false })
  assert.throws(() => learningRequest({ ...value, learning: {} }, target, proposal, true), { code: 'bot/stale' })
  assert.throws(() => learningRequest({ ...value, learning: { 'bot-a': [{ ...skill(), content: '已改变' }] } }, target, proposal, true), { code: 'bot/stale' })
  assert.throws(() => learningRequest({ ...value, readOnly: '只读' }, target, proposal, true), { code: 'bot/read-only' })
  value.byId['part-a'].sessionId = 'next-a'
  assert.throws(() => learningRequest(value, target, proposal, true), { code: 'bot/read-only' })
})
test('同一提案提交中或回执未知时换聊天也不重复提交；查询未结算不能解锁', () => {
  const answers = new LearningAnswers(); const operation = answers.begin(target, 'skill-a')
  assert.throws(() => answers.begin(target, 'skill-a'), { code: 'bot/busy' })
  answers.fail(operation, { code: 'RPC_ABORTED' })
  assert.equal(answers.get('skill-a')?.phase, 'unknown')
  answers.reconcile(target, [])
  assert.throws(() => answers.begin({ ...target, sessionId: 'next-a' }, 'skill-a'), { code: 'bot/busy' })
  answers.reconcile(target, [{ ...skill(), sessionId: 'wrong-part', outcome: 'approved' }])
  assert.equal(answers.get('skill-a')?.phase, 'unknown')
  answers.reconcile(target, [{ ...skill(), sessionId: 'part-a', outcome: 'approved' }])
  assert.equal(answers.get('skill-a'), undefined)
})
test('审批途中换段后，以当前私聊中同Bot同提案的真实结算解除待确认', () => {
  const answers = new LearningAnswers(); const operation = answers.begin(target, 'skill-a')
  answers.fail(operation, { code: 'RPC_ABORTED' })
  const current = { ...target, sessionId: 'next-a' }
  answers.reconcile(current, [{ ...skill(), sessionId: 'next-a' }])
  assert.equal(answers.get('skill-a')?.phase, 'unknown')
  answers.reconcile({ botId: 'bot-b', sessionId: 'next-b' }, [{ ...skill(), botId: 'bot-b', sessionId: 'next-b', outcome: 'approved' }])
  assert.equal(answers.get('skill-a')?.phase, 'unknown')
  answers.reconcile(current, [{ ...skill(), sessionId: 'next-a', outcome: 'approved' }])
  assert.equal(answers.get('skill-a'), undefined)
})
test('成功回执立即显示实际结算，迟到取消不能降级；错误回执不能假称批准', () => {
  const answers = new LearningAnswers()
  for (const approve of [true, false]) {
    const id = `proposal-${approve}`; const operation = answers.begin(target, id)
    answers.finish(operation, { applied: approve }, approve)
    answers.fail(operation, { code: 'bot/outcome-unknown' })
    assert.equal(answers.get(id)?.phase, approve ? 'approved' : 'declined')
    assert.throws(() => answers.begin(target, id), { code: 'bot/busy' })
  }
  const invalid = answers.begin(target, 'invalid')
  assert.throws(() => answers.finish(invalid, { applied: false }, true), { code: 'bot/incompatible' })
  answers.fail(invalid, { code: 'bot/incompatible' })
  assert.equal(answers.get('invalid')?.phase, 'unknown')
})
test('明确拒绝允许用户核对后再操作，stale保留失效事实且不重发', () => {
  const answers = new LearningAnswers(); let updates = 0
  const dispose = answers.subscribe(() => { updates++ })
  const refused = answers.begin(target, 'refused')
  answers.fail(refused, { code: 'bot/refused' }); assert.equal(answers.get('refused'), undefined)
  const stale = answers.begin(target, 'stale')
  answers.fail(stale, { code: 'bot/stale' }); assert.equal(answers.get('stale')?.phase, 'stale')
  assert.equal(updates, 4); dispose()
})
