// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { moduleAccess, resourceAccessFailure, resourcePermissions, resourceTarget, sessionResourceTarget, currentResourceSession, ScopedResourceRead } from '../src/shared/resource-model.ts'
import { appendDelegationHistory, appendDelegations, delegationList, delegationPage, delegationRequest } from '../src/shared/delegation-model.ts'
const target = { scope: { kind: 'bot' as const, botId: 'bot-a' }, sessionId: 'root-a' }
const child = (childId = 'child-a') => ({ childId, mode: 'continuable', createdAt: 1, label: '同名委派', status: 'running', statusSource: 'live-agent', runId: null, lastSettlement: { seq: 4, status: 'completed' } })
const list = () => ({ schema: 1, rootSessionId: 'root-a', parentSessionId: 'root-a', items: [child()], nextAfterChildId: null, depthLimit: 8 })
const page = () => ({ schema: 1, rootSessionId: 'root-a', parentSessionId: 'root-a', child: child(), history: 'session', throughSeq: 5,
  events: [{ seq: 4, type: 'assistant/message', turn: 2, text: '真实子回复', truncated: false }, { seq: 5, type: 'turn/end', turn: 2, status: 'completed' }],
  cursor: { childId: 'child-a', throughSeq: 5, beforeSeq: 4 }, lastTurn: { seq: 5, turn: 2, status: 'completed', result: { seq: 4, text: '真实子回复', truncated: false } },
  result: { source: 'settlement', seq: 4, text: '旧结算通知', truncated: false } })
test('模块版本与消息授权分别核对，资源权限不被完整消息替代', () => {
  assert.equal(moduleAccess(null, 'delegations').state, 'missing')
  assert.equal(moduleAccess({ schema: 1, fullMessages: true, delegations: { schema: 2, read: true } }, 'delegations').state, 'incompatible')
  assert.equal(moduleAccess({ schema: 1, fullMessages: false, delegations: { schema: 1, read: true } }, 'delegations').state, 'denied')
  assert.equal(moduleAccess({ schema: 1, fullMessages: true, workspace: { schema: 1, read: false } }, 'workspace').state, 'denied')
  assert.equal(moduleAccess({ schema: 1, fullMessages: true, delegations: { schema: 1, read: true } }, 'delegations').state, 'ready')
  for (const code of ['bot/refused', 'HTTP_401', 'HTTP_403']) assert.equal(resourceAccessFailure({ code }), true)
  assert.equal(resourceAccessFailure({ code: 'bot/not-found' }), false)
  assert.throws(() => resourceTarget({ ...target, scope: { kind: 'agent', agentId: 'outside' } }))
})
test('后台目录别名不能当作前台，群与历史仍绑定服务器原会话', () => {
  const bot = { id: 'bot-a', sessionId: 'root-a', parts: ['old-a'], tasks: [{ id: 'task-a', sessionId: 'task-session' }] }
  const roster = { byId: { 'bot-a': bot, 'root-a': bot, 'old-a': bot, 'task-session': bot }, roomsById: { 'room-session': { id: 'room-a', sessionId: 'room-session' } } }
  assert.deepEqual(sessionResourceTarget(roster, 'task-session'), { scope: { kind: 'task', botId: 'bot-a', taskId: 'task-a' }, sessionId: 'task-session' })
  assert.deepEqual(sessionResourceTarget(roster, 'room-session'), { scope: { kind: 'room', roomId: 'room-a' }, sessionId: 'room-session' })
  assert.equal(currentResourceSession(roster, { ...target, sessionId: 'old-a' }), false)
  assert.equal(sessionResourceTarget(roster, 'outside'), null)
  assert.throws(() => delegationRequest(target, ['root-a']))
  assert.throws(() => delegationRequest(target, Array.from({ length: 9 }, (_, at) => `child-${at}`), true))
})
test('父级或旧结算结束不覆盖子级真实运行，同名委派各保留自己的编号', () => {
  const value = list(); value.items.push(child('child-b'))
  const result = delegationList(value, target, [])
  assert.deepEqual(result.items.map(item => item.childId), ['child-a', 'child-b'])
  assert.equal(result.items[0].status, 'running')
  assert.equal(result.items[0].lastSettlement?.status, 'completed')
  assert.throws(() => delegationList({ ...value, rootSessionId: 'another-root' }, target, []))
  assert.throws(() => delegationList({ ...value, parentSessionId: 'another-parent' }, target, []))
  assert.throws(() => delegationList({ ...value, items: [child(), child()] }, target, []))
  assert.throws(() => delegationList({ ...value, items: [{ ...child(), mode: ['continuable'] }] }, target, []))
  assert.throws(() => delegationList({ ...value, items: [{ ...child(), statusSource: ['live-agent'] }] }, target, []))
  assert.throws(() => appendDelegations(result, result))
})
test('过程切面固定，分页不能换子级、回跳、重叠或混入新的事件', () => {
  const first = delegationPage(page(), target, ['child-a'])
  assert.equal(first.child.status, 'running'); assert.equal(first.lastTurn?.status, 'completed')
  assert.equal(first.result?.source, 'settlement')
  assert.ok(first.cursor)
  const older = { ...page(), events: [{ seq: 1, type: 'turn/start', turn: 2 }], cursor: null }
  const second = delegationPage(older, target, ['child-a'], first.cursor)
  assert.deepEqual(appendDelegationHistory(first, second).events.map(event => event.seq), [1, 4, 5])
  assert.throws(() => delegationPage({ ...older, throughSeq: 6 }, target, ['child-a'], first.cursor!))
  assert.throws(() => delegationPage(page(), target, ['child-b']))
  assert.throws(() => delegationPage({ ...older, events: [{ seq: 4, type: 'turn/start' }] }, target, ['child-a'], first.cursor!))
  assert.throws(() => appendDelegationHistory(first, first))
})
test('外部委派无本地日志，缺失结果和未知状态不伪造成功', () => {
  const raw = { ...page(), child: { ...child(), mode: 'external', status: 'unknown', statusSource: null }, history: 'external', events: [], throughSeq: null, cursor: null, lastTurn: null, result: null }
  const value = delegationPage(raw, target, ['child-a'])
  assert.equal(value.history, 'external'); assert.equal(value.result, null); assert.equal(value.child.status, 'unknown')
  assert.throws(() => delegationPage({ ...raw, events: page().events }, target, ['child-a']))
  assert.throws(() => delegationPage({ ...raw, history: ['external'] }, target, ['child-a']))
  assert.throws(() => delegationPage({ ...page(), events: [{ seq: 1, type: 'user/message', text: '不支持的正文' }] }, target, ['child-a']))
})
test('任一资源授权变化使读取边界更新，普通归档状态变化不重开资源', () => {
  const extras = { schema: 1, fullMessages: true, workspace: { schema: 1, read: true, write: false }, terminals: { schema: 1, read: true, write: true } }
  assert.notEqual(resourcePermissions(extras), resourcePermissions({ ...extras, terminals: { ...extras.terminals, write: false } }))
  assert.notEqual(resourcePermissions(extras), resourcePermissions({ ...extras, workspace: { ...extras.workspace, write: true } }))
  assert.equal(resourcePermissions(extras), resourcePermissions({ ...extras, archive: { lastRun: 1 } }))
})
test('委派目录与过程累积有界，达到上限明确保留部分标记', () => {
  let directory = delegationList(list(), target, [])
  for (let at = 1; at <= 512; at += 1) directory = appendDelegations(directory, delegationList({ ...list(), items: [child(`child-${at}`)] }, target, []))
  assert.equal(directory.items.length, 512); assert.equal(directory.limited, true)
  const initial = delegationPage(page(), target, ['child-a'])
  let history: typeof initial = { ...initial, throughSeq: 1000, events: [] }
  for (let at = 999; at >= 743; at -= 1) history = appendDelegationHistory(history, { ...history, events: [{ seq: at, type: 'turn/start', turn: 1, text: null, truncated: false, callId: null, name: null, status: null }] })
  assert.equal(history.events.length, 256); assert.equal(history.limited, true)
})
test('关闭或撤销后的迟到正文不能交付，取消后可开始独立新读取', async () => {
  const reader = new ScopedResourceRead()
  let release = (_value: string): void => { throw new Error('未准备回包') }
  const pending = reader.read(() => new Promise<string>(resolve => { release = resolve }), () => true)
  const rejected = assert.rejects(pending, { code: 'RPC_ABORTED' })
  reader.cancel(); release('旧正文'); await rejected
  assert.equal(await reader.read(async () => '新正文', () => true), '新正文')
  let allowed = true
  await assert.rejects(reader.read(async () => { allowed = false; return '被撤销的正文' }, () => allowed), { code: 'RPC_ABORTED' })
})
