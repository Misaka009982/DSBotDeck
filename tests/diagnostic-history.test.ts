// SPDX-License-Identifier: Apache-2.0
// 连续失败只合并呈现，原事件、权限边界与正常消息保持可区分。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DiagnosticHistoryModel, diagnosticEntries } from '../src/shared/diagnostic-history.ts'
import { ToolHistoryModel, toolGroupRows } from '../src/shared/tool-history.ts'
import { record } from '../src/shared/validation.ts'
const retry = (seq: number, sessionId = 'part-a') => ({ kind: 'diagnostic', title: '模型请求正在重试', sessionId, seq, time: seq * 1000, text: `重试记录 ${seq}`, code: 'RATE_LIMIT' })
const scope = { sessionId: 'part-a', fullMessages: true }
const groupKey = (value: unknown) => record(value)?.deckDiagnosticGroupKey

test('截图中的八条连续重试只占一组，保留每次详情及顺序，不修改原历史', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ ...retry(index + 1), detail: `详情 ${index + 1}` }))
  const before = structuredClone(items)
  const grouped = new DiagnosticHistoryModel().group(items, scope)
  assert.equal(grouped.length, 1)
  assert.deepEqual(diagnosticEntries(grouped[0]), items)
  assert.equal(record(grouped[0])?.time, 1000)
  assert.equal(record(grouped[0])?.end, 8000)
  assert.deepEqual(items, before)
})
test('失败与重试可以连续合并，消息、工具、取消和未知诊断分别结束分组', () => {
  const failed = { ...retry(2), title: '模型请求失败' }
  const attempt = { ...retry(3), title: '模型尝试失败' }
  assert.equal(diagnosticEntries(new DiagnosticHistoryModel().group([retry(1), failed, attempt], scope)[0]).length, 3)
  const boundaries: unknown[] = ['user', 'bot', 'post', 'steps', 'event', 'internal', 'divider', 'task-brief'].map(kind => ({ kind, text: '中间记录' }))
  boundaries.push({ ...retry(2), title: '本轮工作已取消或中断' }, { ...retry(2), title: '未知模型状态' }, null)
  for (const middle of boundaries) {
    const rows = new DiagnosticHistoryModel().group([retry(1), middle, retry(3)], scope)
    assert.equal(rows.length, 3); assert.equal(rows[1], middle)
    assert.equal(diagnosticEntries(rows[0]).length, 1); assert.equal(diagnosticEntries(rows[2]).length, 1)
  }
})
test('同编号重复事件只保留当前正文，不把多种错误事件数说成失败尝试次数', () => {
  const earlier = { ...retry(1), detail: '旧授权下的正文' }
  const latest = { ...retry(1), text: '当前可见的错误码' }
  const second = { ...retry(2), title: '模型请求失败' }
  const rows = new DiagnosticHistoryModel().group([earlier, second, latest], scope)
  assert.deepEqual(diagnosticEntries(rows[0]), [latest, second])
  assert.equal(JSON.stringify(rows).includes('旧授权下的正文'), false)
  const legacy = { kind: 'diagnostic', title: '模型请求正在重试', time: 1000 }
  assert.equal(diagnosticEntries(new DiagnosticHistoryModel().group([legacy, { ...legacy }], scope)[0]).length, 2)
})
test('不同会话、服务器、目标或群成员的失败不会混成同一组', () => {
  assert.equal(new DiagnosticHistoryModel().group([retry(1), retry(2, 'part-b')], scope).length, 2)
  for (const field of ['serverId', 'targetId', 'botId']) {
    const rows = new DiagnosticHistoryModel().group([{ ...retry(1), [field]: 'a' }, { ...retry(2), [field]: 'b' }], scope)
    assert.equal(rows.length, 2)
  }
})
test('单条变多条、实时追加及前翻重叠页保持组件身份，不自动展开或关闭', () => {
  const model = new DiagnosticHistoryModel()
  const key = groupKey(model.group([retry(2)], scope)[0])
  assert.equal(typeof key, 'string')
  for (const rows of [[retry(2), retry(3)], [retry(1), retry(2), retry(3)], [retry(2), retry(3), retry(4)]]) {
    assert.equal(groupKey(model.group(rows, scope)[0]), key)
  }
  const split = model.group([retry(2), { kind: 'bot', text: '模型已回复' }, retry(3), retry(4)], scope)
  assert.notEqual(groupKey(split[0]), groupKey(split[2]))
  assert.equal(diagnosticEntries(split[0]).length, 1)
  assert.equal(diagnosticEntries(split[2]).length, 2)
})
test('授权、会话与目标变化释放旧分组身份，清空后不会恢复原展开状态', () => {
  const model = new DiagnosticHistoryModel()
  let key = groupKey(model.group([retry(1), retry(2)], scope)[0])
  for (const next of [{ ...scope, fullMessages: false }, { ...scope, targetId: 'task-b' }, { ...scope, sessionId: 'part-b' }]) {
    const updated = model.group([retry(1)], next)
    assert.notEqual(groupKey(updated[0]), key); key = groupKey(updated[0])
    assert.equal(diagnosticEntries(updated[0]).length, 1)
  }
  model.group([], scope)
  assert.notEqual(groupKey(model.group([retry(1)], scope)[0]), key)
})
test('与真实工具分组串联后仍保留边界，已分组记录再次经过模型不会嵌套', () => {
  const tools = new ToolHistoryModel(); const failures = new DiagnosticHistoryModel()
  const step = { kind: 'steps', sessionId: 'part-a', tools: [{ name: 'read', callId: 'a', callSeq: 3 }] }
  const rows = failures.group(tools.group([retry(1), retry(2), step, retry(4), retry(5)], scope), scope)
  assert.equal(rows.length, 3); assert.equal(toolGroupRows(rows[1]).length, 1)
  assert.equal(diagnosticEntries(rows[0]).length, 2); assert.equal(diagnosticEntries(rows[2]).length, 2)
  assert.deepEqual(failures.group(rows, scope), rows)
})
