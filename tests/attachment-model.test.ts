// SPDX-License-Identifier: Apache-2.0
// 只定义虚构文件和端点回包的回归，不访问用户文件或网络。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { AttachmentBatch, ATTACHMENT_LIMITS, attachmentBase64, attachmentCapability, attachmentMetadata, attachmentTarget } from '../src/shared/attachment-model.ts'
import type { AttachmentCall } from '../src/shared/attachment-model.ts'
const target = { scope: { kind: 'bot' as const, botId: 'bot-a' }, sessionId: 'part-a' }
const reply = (batch: AttachmentBatch, received: number[], status = 'uploading') => ({ schema: 1, requestId: batch.requestId, sessionId: batch.target.sessionId, received, status })
const file = () => new File(['abc'], '文档.pdf', { type: 'application/pdf' })
test('附件能力、目标及文件限制拒绝未知协议和跨会话，普通文件不当图片执行', () => {
  assert.equal(attachmentCapability({ schema: 1, attachments: { schema: 1, ...ATTACHMENT_LIMITS } }), true)
  assert.equal(attachmentCapability({ schema: 1, attachments: { schema: 2, ...ATTACHMENT_LIMITS } }), false)
  assert.equal(attachmentCapability({ schema: 1 }), false)
  assert.deepEqual(attachmentTarget({ byId: { 'part-a': { id: 'bot-a', sessionId: 'part-a' } } }, 'part-a'), target)
  assert.equal(attachmentTarget({ byId: { 'part-a': { id: 'bot-a', sessionId: 'part-b' } } }, 'part-a'), null)
  assert.deepEqual(attachmentTarget({ roomsById: { 'room-part': { id: 'room-a', sessionId: 'room-part' } } }, 'room-part'), { scope: { kind: 'room', roomId: 'room-a' }, sessionId: 'room-part' })
  assert.equal(attachmentMetadata(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })).kind, 'file')
  assert.equal(attachmentMetadata(new File(['png'], 'a.png', { type: 'image/png' })).kind, 'image')
  assert.throws(() => attachmentMetadata(new File(['x'], '../outside.txt')), /文件名/)
  const batch = new AttachmentBatch(target)
  assert.throws(() => batch.add(Array(9).fill(file())), /8 个附件/)
  assert.equal(batch.files.length, 0)
})
test('文件分片保留准确字节，只在全部分片确认后提交一次，纯附件可发送', async () => {
  const batch = new AttachmentBatch(target); batch.add([new File(['x'.repeat(ATTACHMENT_LIMITS.chunkBytes + 4)], 'large.txt', { type: 'text/plain' }), new File([], 'empty.txt')])
  const requests: { endpoint: string; payload: Record<string, unknown> }[] = []; const received = [0, 0]; const bytes: Buffer[] = []
  const call: AttachmentCall = async (endpoint, raw) => {
    const payload = raw as Record<string, unknown>; requests.push({ endpoint, payload })
    if (endpoint === 'extra-attachment-chunk') { const data = Buffer.from(String(payload.data), 'base64'); bytes.push(data); received[Number(payload.index)] += data.length }
    return reply(batch, [...received], endpoint === 'extra-attachment-send' ? 'sent' : 'uploading')
  }
  await batch.send(call, '', 'once', () => true, new AbortController().signal, () => {})
  assert.equal(batch.phase, 'sent'); assert.equal(batch.sentBytes, ATTACHMENT_LIMITS.chunkBytes + 4)
  assert.deepEqual(requests.map(item => item.endpoint), ['extra-attachment-open', 'extra-attachment-chunk', 'extra-attachment-chunk', 'extra-attachment-send'])
  assert.equal(Buffer.concat(bytes).toString(), 'x'.repeat(ATTACHMENT_LIMITS.chunkBytes + 4))
  assert.deepEqual(requests[0].payload.scope, target.scope); assert.equal(requests[0].payload.sessionId, target.sessionId)
  assert.deepEqual(requests.at(-1)?.payload, { requestId: 'once', text: '' })
  assert.equal(attachmentBase64(new Uint8Array([0, 255, 128, 1])), 'AP+AAQ==')
  await assert.rejects(batch.send(call, '', 'again', () => true, new AbortController().signal, () => {}), /不能重复/)
})
test('上传期间切换目标、取消或坏分片回执不提交消息，原文件保留', async () => {
  for (const boundary of ['selection', 'abort', 'reply']) {
    const batch = new AttachmentBatch(target); const original = file(); batch.add([original])
    let active = true; const controller = new AbortController(); const endpoints: string[] = []
    const call: AttachmentCall = async endpoint => {
      endpoints.push(endpoint)
      if (endpoint === 'extra-attachment-chunk') {
        if (boundary === 'selection') active = false
        if (boundary === 'abort') controller.abort()
        return reply(batch, [boundary === 'reply' ? 2 : 3])
      }
      return reply(batch, [0])
    }
    await assert.rejects(batch.send(call, 'hello', 'once', () => active, controller.signal, () => {}))
    assert.equal(endpoints.includes('extra-attachment-send'), false); assert.equal(batch.phase, 'draft'); assert.equal(batch.files[0], original)
  }
})
test('发送回执未知锁住同一消息，只查询原编号，确认成功后迟到状态不降级', async () => {
  const batch = new AttachmentBatch(target); batch.add([file()]); const endpoints: string[] = []
  const call: AttachmentCall = async endpoint => {
    endpoints.push(endpoint)
    if (endpoint === 'extra-attachment-send') throw new Error('虚构断线')
    return reply(batch, [endpoint === 'extra-attachment-open' ? 0 : 3])
  }
  await assert.rejects(batch.send(call, 'hello', 'once', () => true, new AbortController().signal, () => {}))
  assert.equal(batch.phase, 'unknown'); assert.equal(batch.locked, true)
  await assert.rejects(batch.send(call, 'hello', 'again', () => true, new AbortController().signal, () => {}), /不能重复/)
  assert.throws(() => batch.add([file()]), /待确认/)
  const query: AttachmentCall = async (endpoint, payload) => { assert.equal(endpoint, 'extra-attachment-status'); assert.deepEqual(payload, { requestId: 'once' }); return reply(batch, [3], 'sent') }
  await batch.query(query, new AbortController().signal, () => {})
  assert.equal(batch.phase, 'sent'); batch.accept(reply(batch, [3], 'sending')); assert.equal(batch.phase, 'sent')
  assert.equal(endpoints.filter(endpoint => endpoint === 'extra-attachment-send').length, 1)
})
test('未提交上传的用户重试先释放旧暂存，不能把未知消息当可重试上传', async () => {
  const batch = new AttachmentBatch(target); batch.add([file()])
  await assert.rejects(batch.send(async endpoint => { if (endpoint === 'extra-attachment-open') return reply(batch, [0]); throw new Error('虚构上传中断') }, '', 'first', () => true, new AbortController().signal, () => {}))
  assert.equal(batch.phase, 'draft'); const endpoints: string[] = []
  await batch.send(async (endpoint, payload) => {
    endpoints.push(endpoint)
    if (endpoint === 'extra-attachment-discard') { assert.deepEqual(payload, { requestId: 'first' }); return { schema: 1, requestId: 'first', sessionId: target.sessionId, status: 'discarded' } }
    return reply(batch, [endpoint === 'extra-attachment-open' ? 0 : 3], endpoint === 'extra-attachment-send' ? 'sent' : 'uploading')
  }, '', 'second', () => true, new AbortController().signal, () => {})
  assert.equal(endpoints[0], 'extra-attachment-discard'); assert.equal(batch.phase, 'sent')
})
test('服务器仍在上传或处理中不能证明前次未提交，明确失败才允许用户重试', async () => {
  const batch = new AttachmentBatch(target); batch.add([file()]); batch.requestId = 'once'; batch.phase = 'unknown'
  batch.accept(reply(batch, [3], 'uploading')); assert.equal(batch.phase, 'unknown')
  batch.accept(reply(batch, [3], 'sending')); assert.equal(batch.phase, 'unknown')
  batch.accept(reply(batch, [3], 'failed')); assert.equal(batch.phase, 'failed'); assert.equal(batch.locked, false)
  assert.equal(batch.files.length, 1)
  assert.throws(() => batch.accept({ ...reply(batch, [3], 'sent'), sessionId: 'other-part' }), /回执无效/)
})
