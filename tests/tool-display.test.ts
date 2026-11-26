// SPDX-License-Identifier: Apache-2.0
// 只验证纯展示模型，不运行被展示的命令。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { argumentPresentation, displayToolPath, toolPresentation } from '../src/shared/tool-display.ts'
import { toolCalls } from '../src/shared/tool-model.ts'
const tool = () => ({ name: 'read', label: null, description: null, filePath: null })
test('真实路径进入摘要，坏路径丢弃，参数正文不因列表展开而提前提取', () => {
  const call = toolCalls({ kind: 'steps', sessionId: 'part-a', tools: [{ name: 'read', callId: 'call-a', filePath: '/repo/src/main.ts', arguments: '{"path":"/other"}' }] })[0]
  assert.equal(call.filePath, '/repo/src/main.ts')
  assert.equal(toolPresentation(call, null, '/repo').title, '读取 · repo/src/main.ts')
  for (const filePath of ['x'.repeat(1025), 'bad\npath', 1]) assert.equal(toolCalls({ kind: 'steps', tools: [{ name: 'read', filePath }] })[0].filePath, null)
  assert.equal(toolPresentation(tool(), null).title, '读取 · read')
  assert.equal(toolPresentation(tool(), '{broken').title, '读取 · read')
})
test('路径只按明确工作目录缩短，目录外、相似前缀和遍历路径保留原样', () => {
  assert.equal(displayToolPath('/repo/src/main.ts', '/repo'), 'repo/src/main.ts')
  assert.equal(displayToolPath('D:\\Repo\\src\\main.ts', 'd:/repo'), 'repo/src/main.ts')
  for (const value of ['/repo-other/a', '/outside/a', '/repo/../outside/a']) assert.equal(displayToolPath(value, '/repo'), value)
  assert.equal(displayToolPath('/repo/a', undefined), '/repo/a')
  assert.equal(displayToolPath('src/a', 'src'), 'src/a')
})
test('命令标题只取真实说明，完整命令原样显示并保留其他参数', () => {
  const command = 'pwsh -Command "中文"\r\nexit 0'
  const text = JSON.stringify({ description: '核对配置', script: command, timeout: 30 })
  assert.equal(toolPresentation({ ...tool(), name: 'powershell' }, text).title, '运行命令 · 核对配置')
  const display = argumentPresentation('powershell', text, true)
  assert.equal(display.title, '命令'); assert.equal(display.text, command)
  assert.deepEqual(JSON.parse(display.extra!), { description: '核对配置', timeout: 30 })
  assert.equal(argumentPresentation('powershell', text, false).text, text)
  assert.equal(argumentPresentation('powershell', text, false).title, '参数')
  assert.equal(toolPresentation({ ...tool(), name: 'bash' }, '{"command":"猜测用途"}').title, '运行命令 · bash')
})
test('读取常规参数紧凑显示，额外业务字段与不完整JSON保留完整原文', () => {
  const text = '{"path":"/repo/a","offset":0,"limit":50}'
  const view = argumentPresentation('read', text, true)
  assert.equal(view.compact, true); assert.equal(view.text, 'path: /repo/a · offset: 0 · limit: 50')
  for (const source of ['{"path":"a","custom":{"value":1}}', '{broken', '{"path":"a","limit":null}']) {
    assert.equal(argumentPresentation('read', source, true).text, source)
    assert.equal(argumentPresentation('read', source, true).compact, false)
  }
  assert.equal(toolPresentation({ ...tool(), name: 'edit' }, '{"file_path":"/repo/a"}', '/repo').title, '编辑 · repo/a')
})
