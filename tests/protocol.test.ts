// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assetPath, clientHandler, feedResponse, staticResponse } from '../src/main/protocol.ts'
import type { PeerEvent } from '../src/main/link-factory.ts'
import type { ServerConnection } from '../src/main/server-connection.ts'
import type { ReadReceipt } from '../src/main/protocol.ts'
import { RequestGate } from '../src/main/request-gate.ts'

test('增补最新聊天与后台页只记录原目标读取回执，历史、工具和坏页不记为结果已读', async () => {
  const reads: ReadReceipt[] = []
  let value: unknown = { items: [], cursor: null }
  const connection = { view: () => ({ alias: '虚构服务器', mode: 'phone' }), token: () => ({ generation: 1, peer: {} }), valid: () => true, call: async () => value,
    pendingToken: () => 'pending-a', taskKey: () => 'bot:bot-a' } as unknown as ServerConnection
  const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), connection: () => connection, gate: new RequestGate(), active: () => true, instance: () => 'view-a', context: () => () => true, renderedTarget: () => ({ kind: 'bot', id: 'bot-a' }), read: receipt => { reads.push(receipt) } })
  const read = async (endpoint: string, payload: unknown) => (await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) }))).json() as Promise<{ ok: boolean }>
  await read('extra-messages', { botId: 'bot-a' }); await read('extra-messages', { roomId: 'room-a' }); await read('extra-task-read', { botId: 'bot-a', taskId: 'task-a' })
  assert.deepEqual(reads.map(receipt => [receipt.kind, receipt.id, receipt.taskId]), [['bot', 'bot-a', undefined], ['room', 'room-a', undefined], ['bot', 'bot-a', 'task-a']])
  assert.equal(reads[0].pending, 'pending-a')
  await read('extra-messages', { botId: 'bot-a', cursor: { beforeSeq: 8 } }); await read('extra-task-read', { botId: 'bot-a', taskId: 'task-a', cursor: { beforeSeq: 8 } })
  await read('extra-tool-detail', { sessionId: 'part-a', callId: 'call-a', field: 'output' })
  assert.equal(reads.length, 3)
  value = {}; assert.equal((await read('extra-messages', { botId: 'bot-a' })).ok, false); assert.equal(reads.length, 3)
})

test('静态路径拒绝越界和反斜线，不读取其他服务器或任意磁盘文件', () => {
  const root = path.resolve('fixture-dist')
  assert.equal(assetPath(root, '/%2e%2e/secret.txt'), null)
  assert.equal(assetPath(root, '/a%5cb.txt'), null)
  assert.equal(assetPath(root, '/'), path.join(root, 'index.html'))
})
test('真实文件响应携带本地 CSP，不允许远程脚本或 Frame', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-protocol-'))
  try {
    await mkdir(path.join(directory, 'assets')); await writeFile(path.join(directory, 'index.html'), '<p>fixture</p>', 'utf8')
    const response = await staticResponse(directory, '/')
    assert.equal(response.status, 200); assert.equal(await response.text(), '<p>fixture</p>')
    assert.ok(response.headers.get('content-security-policy')?.includes("frame-src 'none'"))
    assert.equal((await staticResponse(directory, '/missing.js')).status, 404)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('协议来源固定，错服务器不进入门禁或链路', async () => {
  const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), connection: () => { throw new Error('不应调用') }, gate: new RequestGate({ verify: async () => false }), active: () => true, instance: () => 'view-a', context: () => () => true, renderedTarget: () => null, read: () => {} })
  assert.equal((await handler(new Request('dsbotdeck://server-a/api/bot', { method: 'POST' }))).status, 403)
  assert.equal((await handler(new Request('dsbotdeck://server-a/old-view/api/bot', { method: 'POST' }))).status, 403)
  assert.equal((await handler(new Request('dsbotdeck://server-b/view-a/api/bot', { method: 'POST' }))).status, 403)
  assert.equal((await handler(new Request('dsbotdeck://server-a/api/bot', { method: 'POST', headers: { origin: 'dsbotdeck://server-b' } }))).status, 403)
})
test('feed 取消释放订阅和 keepalive，原事件格式保留', async () => {
  let disposed = 0
  const listeners = new Set<(event: PeerEvent) => void>()
  const connection = {
    view: () => ({ cached: false }),
    subscribe: (listener: (event: PeerEvent) => void) => { listeners.add(listener); return () => { disposed += 1; listeners.delete(listener) } },
  } as unknown as ServerConnection
  const controller = new AbortController()
  const response = feedResponse(connection, controller.signal, () => true, () => null)
  const reader = response.body!.getReader()
  assert.ok(new TextDecoder().decode((await reader.read()).value).includes('event: hello'))
  for (const listener of listeners) listener({ event: 'stream', data: { text: 'fixture' } })
  assert.ok(new TextDecoder().decode((await reader.read()).value).includes('event: stream'))
  await reader.cancel(); assert.equal(disposed, 1); assert.equal(listeners.size, 0)
})
