// SPDX-License-Identifier: Apache-2.0
// 先定义气泡间分组契约；本机不运行回归。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { groupToolHistory, ToolHistoryModel, toolGroupKey, toolGroupRows } from '../src/shared/tool-history.ts'
const step = (turn: number, callId?: string, sessionId = 'part-a') => ({ kind: 'steps', sessionId, turn, time: turn, tools: [{ name: 'run_command', ...(callId ? { callId, sessionId } : {}) }] })

test('截图中的11条单次摘要只形成一个总数，调用、顺序与各自轮次全部保留', () => {
  const items = Array.from({ length: 11 }, (_, index) => step(index + 1, `call-${index}`))
  const before = structuredClone(items); const grouped = groupToolHistory(items)
  assert.equal(grouped.length, 1)
  const calls = toolGroupRows(grouped[0])
  assert.equal(calls.length, 11)
  assert.deepEqual(calls.map(call => call.turn), items.map(item => item.turn))
  assert.deepEqual(calls.map(call => call.reference?.callId), items.map(item => item.tools[0].callId))
  assert.deepEqual(items, before)
})
test('用户、Bot、群成员气泡与非工具事件分别终止连续分组', () => {
  for (const kind of ['user', 'bot', 'post', 'event', 'relay', 'divider', 'internal', 'diagnostic', 'task-brief']) {
    const middle = { kind, text: '原记录', time: 2 }
    const rows = groupToolHistory([step(1), middle, step(3)])
    assert.equal(rows.length, 3); assert.equal(rows[1], middle)
    assert.equal(toolGroupRows(rows[0]).length, 1); assert.equal(toolGroupRows(rows[2]).length, 1)
  }
})
test('同名不同调用分别计数，缺编号的旧记录不按名称或内容猜去重', () => {
  assert.equal(toolGroupRows(groupToolHistory([step(1, 'a'), step(1, 'b')])[0]).length, 2)
  assert.equal(toolGroupRows(groupToolHistory([step(1), step(1)])[0]).length, 2)
})
test('同一会话同一稳定调用的重复读取只更新最新状态，不增加调用总数', () => {
  const first = step(1, 'call-a'); const latest = { ...first, tools: [{ ...first.tools[0], ok: true }] }
  const rows = groupToolHistory([first, step(2, 'call-b'), latest])
  const calls = toolGroupRows(rows[0])
  assert.equal(calls.length, 2); assert.equal(calls[0].reference?.callId, 'call-a'); assert.equal(calls[0].outcome, 'success')
  assert.deepEqual(first, step(1, 'call-a'))
})
test('同编号不同调用序号分别计数，各自结果更新不串到另一轮', () => {
  const first = { ...step(1, 'reused'), tools: [{ name: 'edit', callId: 'reused', callSeq: 1, ok: false }] }
  const second = { ...step(2, 'reused'), tools: [{ name: 'edit', callId: 'reused', callSeq: 4, ok: true }] }
  const calls = toolGroupRows(groupToolHistory([first, second, { ...second }])[0])
  assert.deepEqual(calls.map(call => [call.reference?.callSeq, call.outcome]), [[1, 'failure'], [4, 'success']])
  const model = new ToolHistoryModel(); const scope = { sessionId: 'part-a' }
  const group = model.group([second], scope)
  assert.equal(toolGroupKey(model.group([first, second], scope)[0]), toolGroupKey(group[0]))
  assert.notEqual(toolGroupKey(groupToolHistory([first])[0]), toolGroupKey(groupToolHistory([second])[0]))
})
test('缺序号旧记录不能替代已知序号调用，各自仍按原身份合并', () => {
  const legacy = step(1, 'reused')
  const known = { ...step(2, 'reused'), tools: [{ name: 'edit', callId: 'reused', callSeq: 4 }] }
  const calls = toolGroupRows(groupToolHistory([legacy, known, legacy, known])[0])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(call => call.reference?.callSeq), [undefined, 4])
})
test('不同会话、服务器或目标不能跨边界合并，同编号在不同会话仍是两次调用', () => {
  assert.equal(groupToolHistory([step(1, 'same', 'part-a'), step(1, 'same', 'part-b')]).length, 2)
  for (const field of ['serverId', 'targetId']) assert.equal(groupToolHistory([{ ...step(1), [field]: 'a' }, { ...step(2), [field]: 'b' }]).length, 2)
})
test('分组不写入原历史，每个工具使用自己的关联编号、轮次及三态', () => {
  const entry = { kind: 'steps', sessionId: 'part-a', turn: 1, tools: [
    { name: 'read', callId: 'a', callSeq: 1, parentCallId: 'parent-a', turn: 2, ok: false },
    { name: 'read', callId: 'b', ok: true }, { name: 'read' },
  ] }
  const before = structuredClone(entry); const calls = toolGroupRows(groupToolHistory([entry])[0])
  assert.deepEqual(calls.map(call => call.outcome), ['failure', 'success', 'unknown'])
  assert.deepEqual(calls.map(call => call.turn), [2, 1, 1])
  assert.deepEqual(calls[0].reference, { sessionId: 'part-a', callId: 'a', callSeq: 1, parentCallId: 'parent-a' })
  assert.deepEqual(entry, before)
})
test('追加工具和补入旧页保持重叠分组的组件键，展开不会被换成新组件', () => {
  const model = new ToolHistoryModel(); const scope = { sessionId: 'part-a' }
  const first = model.group([step(2, 'b'), step(3, 'c')], scope)
  const key = toolGroupKey(first[0])
  assert.equal(toolGroupKey(model.group([step(1, 'a'), step(2, 'b'), step(3, 'c')], scope)[0]), key)
  assert.equal(toolGroupKey(model.group([step(1, 'a'), step(2, 'b'), step(3, 'c'), step(4, 'd')], scope)[0]), key)
  const split = model.group([step(1, 'a'), step(2, 'b'), { kind: 'bot', text: '中间气泡' }, step(3, 'c')], scope)
  assert.notEqual(toolGroupKey(split[0]), toolGroupKey(split[2]))
  assert.notEqual(toolGroupKey(model.group([step(1, 'a')], { sessionId: 'part-b' })[0]), key)
})
test('新结果更新不改变分组首记录键，空段与损坏记录不制造工具', () => {
  const first = step(1, 'call-a'); const grouped = groupToolHistory([first, step(2, 'call-b')])
  assert.equal(toolGroupKey(grouped[0], 'part-a'), toolGroupKey(groupToolHistory([first, step(2, 'call-b'), step(3, 'call-c')])[0], 'part-a'))
  assert.deepEqual(toolGroupRows({ kind: 'steps', tools: [] }), [])
  assert.deepEqual(toolGroupRows({ kind: 'steps', tools: [null, [], false] }), [])
  assert.deepEqual(groupToolHistory([]), [])
})
