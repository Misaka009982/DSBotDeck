// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { changePage, changeReference } from '../src/shared/change-model.ts'
const reference = { sessionId: 'part-a', callId: 'call-a', callSeq: 2 }
const page = () => ({ schema: 1, source: 'tool-result', sessionId: 'part-a', callId: 'call-a', callSeq: 2, resultSeq: 4, index: 0,
  total: 2, nextIndex: 1, available: true, kind: 'hunk', digest: 'a'.repeat(64), path: '/work/readme.txt', oldText: '旧内容', newText: '新内容', oldAvailable: true, stopped: false, redacted: false, pathRedacted: false })
test('修改详情绑定会话、调用与调用序号，只接受实际结果来源', () => {
  assert.equal(changeReference(reference), true)
  assert.equal(changeReference({ sessionId: 'part-a', callId: 'call-a' }), false)
  assert.equal(changePage(page(), reference).oldText, '旧内容')
  for (const patch of [{ source: 'arguments' }, { sessionId: 'another' }, { callId: 'another' }, { callSeq: 3 }, { resultSeq: 2 }, { index: 1 }]) assert.throws(() => changePage({ ...page(), ...patch }, reference))
})
test('未完成、缺少元数据或超预算时保留不可用原因和下一片段', () => {
  const missing = { ...page(), available: false, reason: '元数据未保留' }
  const value = changePage(missing, reference)
  assert.equal(value.available, false); assert.equal(value.oldText, null); assert.equal(value.nextIndex, 1)
  assert.throws(() => changePage({ ...page(), newText: 'x'.repeat(64 * 1024 + 1) }, reference))
  assert.throws(() => changePage({ ...page(), nextIndex: 0 }, reference))
  assert.throws(() => changePage({ ok: true }, reference))
})
test('缺旧基线与部分应用保留原义，不推断新建或整批成功', () => {
  const value = changePage({ ...page(), oldText: null, oldAvailable: false, stopped: true, redacted: true }, reference)
  assert.equal(value.oldAvailable, false); assert.equal(value.oldText, null)
  assert.equal(value.stopped, true); assert.equal(value.redacted, true)
  assert.throws(() => changePage({ ...page(), oldText: null }, reference))
})
