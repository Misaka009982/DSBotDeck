// SPDX-License-Identifier: Apache-2.0
// 真实详情的结构与读取预算；不运行工具、Electron 或真实服务器。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { appendDetailPage, DETAIL_PREVIEW_CHARS, detailPage, detailPurpose, keepDetailOnFailure, toolDetailFailure, type ToolDetailPreview } from '../src/shared/tool-detail.ts'
const reference = { sessionId: 'part-a', callId: 'call-a', callSeq: 1 }
const page = (extra: Record<string, unknown> = {}) => ({ available: true, redacted: true, ...reference, name: 'run_command', status: 'unconfirmed', field: 'arguments', text: '{}', offset: 0, totalChars: 2, nextOffset: null, digest: 'a'.repeat(64), ...extra })

test('已脱敏详情绑定原会话、调用与字段，未知结果不冒充成功', () => {
  const value = detailPage(page(), reference, 'arguments')
  assert.equal(value.available, true)
  if (!value.available) throw new Error('虚构回包应可读')
  assert.equal(value.text, '{}'); assert.equal(value.outcome, 'unknown')
  assert.equal(detailPage(page({ status: 'success' }), reference, 'arguments').outcome, 'success')
  assert.equal(detailPage(page({ status: 'failed' }), reference, 'arguments').outcome, 'failure')
})
test('跨会话、跨调用、跨字段或未声明脱敏的正文拒绝展示', () => {
  for (const extra of [{ sessionId: 'part-b' }, { callId: 'call-b' }, { field: 'output' }, { redacted: false }, { redacted: undefined }]) assert.throws(() => detailPage(page(extra), reference, 'arguments'), /详情/)
})
test('分页按精确offset、长度和digest校验，不补换行、不接受越界和坏游标', () => {
  const digest = 'b'.repeat(64)
  const next = detailPage(page({ offset: 2, text: 'cd', totalChars: 4, digest }), reference, 'arguments', 2, digest)
  assert.equal(next.available && next.text, 'cd')
  for (const extra of [{ offset: 1 }, { text: 'abc' }, { digest: 'c'.repeat(64) }, { nextOffset: 3 }]) assert.throws(() => detailPage(page({ offset: 2, text: 'cd', totalChars: 4, digest, ...extra }), reference, 'arguments', 2, digest), /详情/)
  assert.throws(() => detailPage(page({ text: 'x'.repeat(32769), totalChars: 32769 }), reference, 'arguments'), /详情/)
  assert.throws(() => detailPage(page({ totalChars: 2 * 1024 * 1024 + 1, nextOffset: 2 }), reference, 'arguments'), /详情/)
})
test('非末段符合32Ki字符预算，避免坏游标形成无界小段读取且不切开代理对', () => {
  const first = 'x'.repeat(32767)
  const value = detailPage(page({ text: first, totalChars: 32769, nextOffset: 32767 }), reference, 'arguments')
  assert.equal(value.available && value.nextOffset, 32767)
  assert.throws(() => detailPage(page({ text: 'x', totalChars: 100, nextOffset: 1 }), reference, 'arguments'), /详情/)
  assert.throws(() => detailPage(page({ text: 'x'.repeat(32767) + '\uD83D', totalChars: 32769, nextOffset: 32768 }), reference, 'arguments'), /详情/)
})
test('输出缺失保留未提供原因和三态，格式损坏不转换为正常空输出', () => {
  const missing = detailPage({ available: false, status: 'unconfirmed', reason: '日志尚未提供输出' }, reference, 'output')
  assert.equal(missing.available, false); assert.equal(missing.outcome, 'unknown')
  if (missing.available) throw new Error('虚构输出应缺失')
  assert.equal(missing.reason, '日志尚未提供输出')
  for (const value of [null, [], {}, { available: true }, { available: false, reason: {} }]) assert.throws(() => detailPage(value, reference, 'output'), /详情/)
})
test('可理解说明只取实际description或justification，命令只从实际参数提取', () => {
  assert.deepEqual(detailPurpose('{"description":"查找 ProposalSchema 定义位置","command":"rg ProposalSchema src/"}'), { description: '查找 ProposalSchema 定义位置', command: 'rg ProposalSchema src/' })
  assert.deepEqual(detailPurpose('{"justification":"核对引用","cmd":"git status"}'), { description: '核对引用', command: 'git status' })
  assert.deepEqual(detailPurpose('{"file":"src/schema.ts"}'), { description: null, command: null })
  assert.deepEqual(detailPurpose('{"input":{"description":"不得猜测嵌套字段"}}'), { description: null, command: null })
  assert.deepEqual(detailPurpose('{broken'), { description: null, command: null })
})
test('拒绝、缺接口、繁忙、版本变化与网络失败分别提示且不复述错误正文', () => {
  assert.match(toolDetailFailure({ code: 'bot/refused', message: 'fictional-secret' }), /授权/)
  for (const code of ['HTTP_401', 'HTTP_403']) assert.match(toolDetailFailure({ code }), /授权/)
  assert.match(toolDetailFailure({ code: 'bot/not-found' }), /不存在/)
  assert.match(toolDetailFailure({ code: 'bot/unavailable' }), /暂不可用/)
  assert.match(toolDetailFailure({ code: 'bot/stale' }), /首段/)
  assert.match(toolDetailFailure({ code: 'RPC_TIMEOUT' }), /读取失败/)
  assert.equal(toolDetailFailure(new Error('fictional-secret')).includes('fictional-secret'), false)
})
test('继续读取原样保留已读开头，不插换行、不修改上一份预览', () => {
  const head = 'x'.repeat(32768); const tail = 'tail\r\nlast'; const total = head.length + tail.length
  const first = appendDetailPage(null, detailPage(page({ text: head, totalChars: total, nextOffset: head.length }), reference, 'arguments'))
  const before = structuredClone(first)
  const next = detailPage(page({ text: tail, offset: head.length, totalChars: total }), reference, 'arguments', head.length, 'a'.repeat(64))
  const joined = appendDetailPage(first, next)
  if (!joined.available) throw new Error('虚构拼接应可读')
  assert.equal(joined.text, head + tail); assert.equal(joined.offset, 0)
  assert.equal(joined.nextOffset, null); assert.equal(joined.previewLimited, false)
  assert.deepEqual(first, before)
})
test('累积读取拒绝重复、跳页和版本变化，锁定或缺失回包不保留旧正文', () => {
  const head = 'x'.repeat(32768); const total = head.length + 2
  const first = appendDetailPage(null, detailPage(page({ text: head, totalChars: total, nextOffset: head.length }), reference, 'arguments'))
  const next = detailPage(page({ text: '{}', offset: head.length, totalChars: total }), reference, 'arguments', head.length, 'a'.repeat(64))
  if (!next.available) throw new Error('虚构末段应可读')
  for (const change of [{ offset: head.length + 1 }, { digest: 'b'.repeat(64) }, { totalChars: total + 1 }]) assert.throws(() => appendDetailPage(first, { ...next, ...change }), /关联|版本|格式/)
  assert.throws(() => appendDetailPage(null, next), /首段/)
  const completed = appendDetailPage(first, next)
  assert.throws(() => appendDetailPage(completed, next), /关联|版本|格式/)
  const unavailable = detailPage({ available: false, reason: '密钥保护暂不可用', status: 'unconfirmed' }, reference, 'arguments')
  assert.deepEqual(appendDetailPage(first, unavailable), unavailable)
})
test('128Ki显示预算保留前缀并区分完整末尾和仍有内容，不提高2Mi协议上限', () => {
  for (const total of [DETAIL_PREVIEW_CHARS, DETAIL_PREVIEW_CHARS + 2]) {
    let preview: ToolDetailPreview | null = null
    for (let offset = 0; offset < DETAIL_PREVIEW_CHARS; offset += 32768) {
      const end = offset + 32768
      const chunk = detailPage(page({ text: 'x'.repeat(32768), offset, totalChars: total, nextOffset: end < total ? end : null }), reference, 'arguments', offset, offset ? 'a'.repeat(64) : undefined)
      preview = appendDetailPage(preview, chunk)
    }
    if (!preview?.available) throw new Error('虚构预览应可读')
    assert.equal(preview.text, 'x'.repeat(DETAIL_PREVIEW_CHARS))
    assert.equal(preview.previewLimited, total > DETAIL_PREVIEW_CHARS)
    if (preview.previewLimited) {
      const next = detailPage(page({ text: '{}', offset: DETAIL_PREVIEW_CHARS, totalChars: total }), reference, 'arguments', DETAIL_PREVIEW_CHARS, 'a'.repeat(64))
      assert.throws(() => appendDetailPage(preview, next), /上限/)
    }
  }
  assert.throws(() => detailPage(page({ text: 'x'.repeat(32768), totalChars: 2 * 1024 * 1024 + 1, nextOffset: 32768 }), reference, 'arguments'), /详情/)
})
test('显示预算落在代理对中间时不留下半个字符，也不能继续追加绕过预算', () => {
  let preview: ToolDetailPreview | null = null; let offset = 0
  const total = DETAIL_PREVIEW_CHARS + 2
  for (const length of [32767, 32768, 32768, 32768]) {
    const end = offset + length
    preview = appendDetailPage(preview, detailPage(page({ text: 'x'.repeat(length), offset, totalChars: total, nextOffset: end }), reference, 'arguments', offset, offset ? 'a'.repeat(64) : undefined))
    offset = end
  }
  const last = detailPage(page({ text: '💡!', offset, totalChars: total }), reference, 'arguments', offset, 'a'.repeat(64))
  const limited = appendDetailPage(preview, last)
  if (!limited.available) throw new Error('虚构预览应可读')
  assert.equal(limited.text.length, DETAIL_PREVIEW_CHARS - 1); assert.equal(limited.previewLimited, true)
  assert.equal(/[\uD800-\uDBFF]$/.test(limited.text), false)
  assert.throws(() => appendDetailPage(limited, last), /上限/)
})
test('客户端原样显示普通容器与已保护的敏感值，不二次遮盖业务参数', () => {
  const text = JSON.stringify({ description: '查找 ProposalSchema 定义位置', command: 'rg ProposalSchema src/schema.ts', headers: { 'X-Feature': 'on', Authorization: '[REDACTED]' }, env: { MODE: 'development', API_KEY: '[REDACTED]' }, data: { file: 'src/schema.ts' } })
  const value = appendDetailPage(null, detailPage(page({ text, totalChars: text.length }), reference, 'arguments'))
  if (!value.available) throw new Error('虚构参数应可读')
  assert.equal(value.text, text)
  assert.deepEqual(detailPurpose(value.text), { description: '查找 ProposalSchema 定义位置', command: 'rg ProposalSchema src/schema.ts' })
})
test('只在明确超时且原目标仍有效时保留已读前缀，拒绝和锁定不保留', () => {
  assert.equal(keepDetailOnFailure({ code: 'RPC_TIMEOUT' }), true)
  for (const code of ['HTTP_401', 'HTTP_403', 'bot/refused', 'bot/unavailable', 'bot/read-only', 'bot/stale', 'bot/incompatible', 'bot/not-found', 'RPC_ABORTED']) assert.equal(keepDetailOnFailure({ code }), false)
  assert.equal(keepDetailOnFailure(new Error('fictional-secret')), false)
})
