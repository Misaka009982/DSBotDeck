// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { terminalList, terminalPage, terminalInput, TerminalControl } from '../src/shared/terminal-model.ts'
const entry = () => ({ terminalId: 'pty-a', sessionId: 'part-a', owner: 'user', status: 'running', control: 'ready', cols: 80, rows: 24,
  exitCode: null, outputEnded: false, handleId: 'handle-a', expiresAt: 1000, cleanupOnly: false, nextSequence: 1, lastControl: null, writable: true })
const target = { scope: { kind: 'bot' as const, botId: 'bot-a' }, sessionId: 'part-a' }
const list = () => ({ schema: 1, sessionId: 'part-a', items: [entry()], maxInputBytes: 16384, maxOutputBytes: 524288 })
test('终端目录保持真实用户所有权和会话，清理目录不能当作输出句柄', () => {
  const page = terminalList(list(), target)
  assert.equal(page.items[0].terminalId, 'pty-a')
  assert.throws(() => terminalList({ ...list(), sessionId: 'outside' }, target))
  assert.throws(() => terminalList({ ...list(), items: [{ ...entry(), owner: 'agent' }] }, target))
  assert.throws(() => terminalList({ ...list(), items: [entry(), entry()] }, target))
  const cleanup = terminalList({ schema: 1, cleanupOnly: true, items: [{ ...entry(), cleanupOnly: true, writable: false }] }, null)
  assert.equal(cleanup.items[0].cleanupOnly, true)
  assert.throws(() => terminalList({ schema: 1, cleanupOnly: true, items: [entry()] }, null))
})
test('原始字节分页保持跨页UTF-8和ANSI，越界、缺口与错误身份拒绝', () => {
  const handle = terminalList(list(), target).items[0]
  const raw = { ...entry(), schema: 1, encoding: 'base64', from: 0, nextOffset: 2, throughOffset: 3, truncated: false, data: '5L0=' }
  assert.deepEqual([...terminalPage(raw, handle, 0).bytes], [0xe4, 0xbd])
  const next = terminalPage({ ...raw, from: 2, nextOffset: 3, data: 'oA==' }, handle, 2)
  assert.deepEqual([...next.bytes], [0xa0])
  for (const patch of [{ handleId: 'other' }, { terminalId: 'other' }, { nextOffset: 4 }, { from: 1 }, { data: '@@@@' }, { throughOffset: 1 }]) assert.throws(() => terminalPage({ ...raw, ...patch }, handle, 0))
  const lost = terminalPage({ ...raw, from: 1, nextOffset: 3, throughOffset: 524289, truncated: true }, handle, 0)
  assert.equal(lost.truncated, true)
})
test('输入与尺寸共用单次序号，未知输入不能重发，核对只接受对应回执', () => {
  const handle = terminalList(list(), target).items[0]
  const control = new TerminalControl(handle)
  assert.equal(control.begin(), 1)
  assert.throws(() => control.begin())
  control.uncertain()
  control.observe(handle)
  assert.equal(control.canSend, false)
  control.observe({ ...handle, nextSequence: 2, lastControl: { sequence: 1, status: 'accepted' } })
  assert.equal(control.canSend, true)
  assert.equal(control.begin(), 2)
  assert.equal(control.acceptsInput, true)
  control.observe({ ...handle, writable: false }); assert.equal(control.acceptsInput, false)
  control.finish({ schema: 1, sequence: 2, status: 'accepted' })
  assert.equal(control.nextSequence, 3)
  control.observe(handle)
  assert.equal(control.nextSequence, 3)
  control.observe({ ...handle, writable: false })
  assert.equal(control.canSend, false)
})
test('服务端控制未知、退出和损坏回执保持禁止输入，尺寸不占用其他终端序号', () => {
  const handle = terminalList(list(), target).items[0]
  const a = new TerminalControl(handle); const b = new TerminalControl({ ...handle, terminalId: 'pty-b', handleId: 'handle-b' })
  a.begin(); a.finish({ schema: 1, sequence: 1, status: 'unknown' })
  assert.equal(a.canSend, false); assert.equal(b.canSend, true)
  b.begin(); assert.throws(() => b.finish({ schema: 1, sequence: 99, status: 'accepted' }))
  b.uncertain(); b.observe({ ...handle, terminalId: 'pty-b', handleId: 'handle-b', status: 'exited', writable: false })
  assert.equal(b.canSend, false)
})
test('粘贴完整Unicode和UTF-8预算先核对，拒绝半个代理字符与超长输入', () => {
  assert.equal(terminalInput('中文\r\n\u001b[A'), '中文\r\n\u001b[A')
  assert.equal(terminalInput('😀'), '😀')
  assert.throws(() => terminalInput('\ud800'))
  assert.throws(() => terminalInput('中'.repeat(6000)))
})
