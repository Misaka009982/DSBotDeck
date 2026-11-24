// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { SavedServer } from '../src/shared/domain.ts'
import type { Peer, PeerEvent } from '../src/main/link-factory.ts'
import { reconnectDelay, ServerConnection } from '../src/main/server-connection.ts'
const config = (): SavedServer => ({ id: 'server-a', alias: '测试服务器', relayUrl: 'wss://relay.example/v1/link', hostDeviceId: 'fictional-host', hostKey: 'fictional-host-key', mode: 'phone', identity: { deviceId: 'fictional-client', publicKey: 'fictional-public', privateKey: 'fictional-private', accessToken: 'fictional-access' }, paired: false, autoConnect: false, unfollowed: [] })
class FixturePeer implements Peer {
  events = new Set<(event: PeerEvent) => void>()
  closes = new Set<() => void>()
  calls: string[] = []
  stateReply: unknown = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a', name: 'Chief' }], rooms: [] } }
  why: unknown = null
  async connect() {}
  async rpc<T>(_: string, params: unknown): Promise<T> {
    const endpoint = (params as { endpoint: string }).endpoint
    this.calls.push(endpoint)
    return (endpoint === 'hello' ? { ok: true, value: { api: 1, boot: 'boot-a', seq: 0 } } : endpoint === 'state' ? this.stateReply : { ok: true, value: { boot: 'boot-a', seq: 0, notices: [] } }) as T
  }
  onEvent(handler: (event: PeerEvent) => void) { this.events.add(handler); return () => { this.events.delete(handler) } }
  onClose(handler: () => void) { this.closes.add(handler); return () => { this.closes.delete(handler) } }
  probe() {}
  async close() { for (const handler of this.closes) handler() }
  reason() { return this.why }
  emit(event: PeerEvent) { for (const handler of this.events) handler(event) }
}
test('握手后立即保留配对，不因后续状态读取失败丢失身份', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: false, error: { code: 'RPC_TIMEOUT', message: 'fictional-timeout' } }
  let paired = 0
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => { paired += 1 } })
  try { await connection.connect('fictional-code'); assert.equal(paired, 1); assert.equal(connection.view().cached, true) }
  finally { await connection.disconnect() }
})
test('旧连接的迟到事件不污染新连接，断开保留真实缓存', async () => {
  const peers: FixturePeer[] = []
  const connection = new ServerConnection(config(), () => { const peer = new FixturePeer(); peers.push(peer); return peer }, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect(); const first = peers[0]; const oldToken = connection.token()
    await connection.connect(); first.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    assert.equal(oldToken && connection.valid(oldToken), false)
    assert.equal(connection.view().counts.blue, 0)
    await connection.disconnect()
    assert.equal(connection.view().team?.entities[0].name, 'Chief')
    assert.equal(connection.view().cached, true)
    assert.equal(connection.view().counts.red, 0)
  } finally { await connection.disconnect() }
})
test('同代次同 revision 的旧状态回包不能覆盖新运行状态', async () => {
  const peer = new FixturePeer()
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    let release = (_value: unknown): void => { throw new Error('未准备回包') }
    peer.stateReply = new Promise<unknown>(resolve => { release = resolve })
    const slow = connection.poll()
    peer.stateReply = { ok: true, value: { revision: 2, bots: [{ id: 'bot-a' }], rooms: [], work: { bots: { 'bot-a': { tool: 'read' } } } } }
    await connection.call('state', { since: -1, locale: 'zh-CN' })
    release({ ok: true, value: { revision: 2, bots: [{ id: 'bot-a' }], rooms: [], work: { bots: {} } } })
    await slow
    assert.equal(connection.view().counts.green, 1)
  } finally { await connection.disconnect() }
})
test('旧状态读取失败不能把更新的成功状态退回缓存', async () => {
  const peer = new FixturePeer()
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    let reject = (_error: Error): void => { throw new Error('未准备失败回包') }
    peer.stateReply = new Promise<unknown>((_resolve, fail) => { reject = fail })
    const slow = connection.poll()
    peer.stateReply = { ok: true, value: { revision: 2, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.call('state', { since: -1, locale: 'zh-CN' })
    reject(new Error('fictional-old-timeout')); await slow
    assert.equal(connection.view().cached, false)
  } finally { await connection.disconnect() }
})
test('退避有界，失败次数不冒充任务失败', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 20].map(reconnectDelay), [2000, 4000, 8000, 16000, 30000, 30000])
})
