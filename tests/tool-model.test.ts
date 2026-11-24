// SPDX-License-Identifier: Apache-2.0
// 回归只作定义；不运行应用、工具或真实服务器。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { preferInputStatus, toolSummaries, workToolNote } from '../src/shared/tool-model.ts'

test('当前工具原名优先于泛化说辞，新输入不遮住服务器仍报告的工具', () => {
  const note = workToolNote({ tool: 'job_output', said: 'Weighing the options', since: 1 })
  assert.deepEqual(note, { tool: 'job_output', label: '正在调用 job_output', current: true })
  assert.equal(preferInputStatus(200, { ...note, at: 10 }), false)
  assert.equal(preferInputStatus(200, { label: '旧本地状态', at: 10 }), true)
  assert.equal(preferInputStatus(200, undefined), true)
  assert.equal(workToolNote({ since: 1 }), null)
  assert.equal(workToolNote({ tool: 'job_output', switching: true }), null)
})
test('群聊逐个标注正在用工具的成员，后台任务不冒充具体工具', () => {
  const note = workToolNote([{ botId: 'a', tool: 'read_file', target: 'hello.ts' }, { botId: 'b', tool: 'job_output' }, { botId: 'c', since: 1 }], { a: { name: '甲' }, b: { name: '乙' } })
  assert.equal(note?.label, '甲：正在调用 read_file · hello.ts；乙：正在调用 job_output')
  assert.equal(workToolNote({ tool: 'task', note: '整理资料' })?.label, '后台任务 · 整理资料')
  assert.equal(workToolNote([null, [], { tool: 1 }, { tool: '' }]), null)
})
test('工具名称与说明保留，仅真实布尔结果决定成功或失败', () => {
  assert.deepEqual(toolSummaries({ kind: 'steps', tools: [
    { name: 'read_file', label: 'Opening a file', ok: true },
    { name: 'run_command', label: 'Running a command', ok: false },
    { name: 'web_search' },
  ] }), [
    { name: 'read_file', label: 'Opening a file', outcome: 'success' },
    { name: 'run_command', label: 'Running a command', outcome: 'failure' },
    { name: 'web_search', label: null, outcome: 'unknown' },
  ])
})
test('缺结果、字符串和数字不冒充已成功或正在运行', () => {
  for (const ok of [undefined, null, 0, 1, 'true', 'false']) {
    assert.equal(toolSummaries({ kind: 'steps', tools: [{ name: 'probe', ok }] })[0]?.outcome, 'unknown')
  }
})
test('重复工具保持顺序，损坏行跳过，缺失名称明确保留为未知', () => {
  assert.deepEqual(toolSummaries({ kind: 'steps', tools: [
    { name: 'Read_File' }, null, false, [], { name: 'Read_File', ok: true }, {},
  ] }), [
    { name: 'Read_File', label: null, outcome: 'unknown' },
    { name: 'Read_File', label: null, outcome: 'success' },
    { name: null, label: null, outcome: 'unknown' },
  ])
  for (const value of [null, [], { kind: 'bot', tools: [{ name: 'read_file' }] }, { kind: 'steps', tools: 'invalid' }]) assert.deepEqual(toolSummaries(value), [])
})
test('思考时间、原始参数和输出不进入工具摘要，也不修改原记录', () => {
  const entry = { kind: 'steps', ms: 9999, time: 123, tools: [{ name: 'read_file', ok: true, arguments: 'fictional-private-args', content: 'fictional-private-output' }] }
  const before = structuredClone(entry)
  const result = toolSummaries(entry)
  assert.deepEqual(result, [{ name: 'read_file', label: null, outcome: 'success' }])
  assert.equal(JSON.stringify(result).includes('fictional-private'), false)
  assert.deepEqual(entry, before)
})
