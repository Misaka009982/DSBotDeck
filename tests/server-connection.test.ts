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
  requests: { endpoint: string; payload: unknown }[] = []
  stateReply: unknown = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a', name: 'Chief' }], rooms: [] } }
  why: unknown = null
  async connect() {}
  async rpc<T>(_: string, params: unknown): Promise<T> {
    const request = params as { endpoint: string; payload: unknown }
    const endpoint = request.endpoint
    this.calls.push(endpoint); this.requests.push(request)
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
test('隧道地址只能断开后更新，原主机与客户端身份及配对权限不可替换', async () => {
  const initial = config(); const connection = new ServerConnection(initial, () => new FixturePeer(), { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    assert.throws(() => connection.update({ ...initial, relayUrl: 'wss://new.example/v1/link' }), /先断开/)
    await connection.disconnect()
    for (const patch of [{ hostKey: 'other-host-key' }, { hostDeviceId: 'other-host' }, { mode: 'browser' as const }]) {
      assert.throws(() => connection.update({ ...initial, ...patch }), /身份/)
    }
    for (const key of ['deviceId', 'publicKey', 'privateKey', 'accessToken'] as const) {
      assert.throws(() => connection.update({ ...initial, identity: { ...initial.identity, [key]: 'fictional-other' } }), /身份/)
    }
    connection.update({ ...initial, relayUrl: 'wss://new.example/v1/link' })
    assert.deepEqual(connection.settings(), { ...initial, relayUrl: 'wss://new.example/v1/link' })
  } finally { await connection.disconnect() }
})
test('更换隧道后旧读取、写入回执和事件均失效，不重放旧写入', async () => {
  const peers: FixturePeer[] = []; const addresses: string[] = []
  const connection = new ServerConnection(config(), server => { const peer = new FixturePeer(); peers.push(peer); addresses.push(server.relayUrl); return peer }, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect(); const first = peers[0]; const token = connection.token(); assert.ok(token)
    let releaseState = (_value: unknown): void => {}; let releaseWrite = (_value: unknown): void => {}
    const oldWrite = new Promise<unknown>(resolve => { releaseWrite = resolve })
    first.stateReply = new Promise<unknown>(resolve => { releaseState = resolve })
    const originalRpc = first.rpc.bind(first)
    first.rpc = async <T>(method: string, params: unknown): Promise<T> => {
      if ((params as { endpoint: string }).endpoint === 'send') { first.calls.push('send'); return await oldWrite as T }
      return originalRpc<T>(method, params)
    }
    const reading = connection.poll()
    const writing = assert.rejects(connection.call('send', { botId: 'bot-a', text: '虚构消息' }), /旧连接/)
    await connection.disconnect()
    connection.update({ ...connection.settings(), relayUrl: 'wss://new.example/v1/link' })
    await connection.connect()
    releaseState({ ok: true, value: { revision: 99, bots: [{ id: 'wrong-bot', name: '迟到旧内容' }], rooms: [] } })
    releaseWrite({ ok: true, value: { sent: true } })
    await reading; await writing
    first.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } }); await first.close()
    assert.deepEqual(addresses, ['wss://relay.example/v1/link', 'wss://new.example/v1/link'])
    assert.equal(connection.valid(token), false); assert.equal(connection.view().cached, false)
    assert.equal(connection.view().team?.entities[0].name, 'Chief'); assert.equal(connection.view().counts.blue, 0)
    assert.equal(first.calls.filter(endpoint => endpoint === 'send').length, 1)
    assert.equal(peers[1].calls.includes('send'), false)
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
const statePayload = (peer: FixturePeer) => peer.requests.filter(request => request.endpoint === 'state').at(-1)?.payload as Record<string, unknown>
const blockedState = () => ({ revision: 1, liveKey: 'live-a', bots: [{ id: 'bot-a', blocked: { code: 'ACCOUNT_QUOTA' } }], rooms: [], work: { bots: {}, rooms: {} } })
test('阻塞对象有新回复时核对完整快照，不从通知本身推断已成功', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect(); assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().counts.red, 1)
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    assert.equal(connection.view().counts.red, 1)
    await connection.poll(); assert.equal(statePayload(peer).since, -1)
    assert.equal(Object.hasOwn(statePayload(peer), 'live'), false)
    assert.equal(connection.view().counts.red, 1)
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 2 } })
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().counts.red, 0); assert.equal(connection.view().counts.blue, 1)
  } finally { await connection.disconnect() }
})
test('增量工作结束但仍携带旧阻塞时再核对完整快照，普通空闲读取不反复全量', async () => {
  const peer = new FixturePeer()
  peer.stateReply = { ok: true, value: { ...blockedState(), work: { bots: { 'bot-a': { tool: 'read' } }, rooms: {} } } }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect(); assert.equal(connection.view().counts.green, 1)
    connection.applyState({ revision: 1, unchanged: true, liveKey: 'live-b', work: { bots: {}, rooms: {} } })
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll(); assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().counts.red, 0)
    await connection.poll(); assert.equal(statePayload(peer).since, 1)
  } finally { await connection.disconnect() }
})
test('完整阻塞核对失败保留缓存，下一次读取仍核对完整快照', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    peer.stateReply = { ok: false, error: { code: 'RPC_TIMEOUT', message: 'fictional-timeout' } }
    await connection.poll(); assert.equal(connection.view().cached, true); assert.equal(connection.view().counts.red, 1)
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll(); assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().cached, false); assert.equal(connection.view().counts.red, 0)
  } finally { await connection.disconnect() }
})
test('新完整状态之后的同revision旧回包不能恢复旧阻塞', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    let release = (_value: unknown): void => { throw new Error('未准备回包') }
    peer.stateReply = new Promise(resolve => { release = resolve })
    const old = connection.poll()
    assert.equal(statePayload(peer).since, -1)
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.call('state', { since: -1 })
    release({ ok: true, value: blockedState() }); await old
    assert.equal(connection.view().counts.red, 0)
    peer.stateReply = { ok: true, value: { revision: 1, unchanged: true, liveKey: 'live-b' } }
    await connection.poll(); assert.equal(statePayload(peer).since, 1)
  } finally { await connection.disconnect() }
})
test('增量先到使旧完整回包失效时，下一次仍核对完整状态', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    let release = (_value: unknown): void => { throw new Error('未准备回包') }
    peer.stateReply = new Promise(resolve => { release = resolve })
    const old = connection.poll()
    assert.equal(statePayload(peer).since, -1)
    peer.stateReply = { ok: true, value: { revision: 1, unchanged: true, liveKey: 'live-b' } }
    await connection.call('state', { since: 1, locale: 'zh-CN' })
    const unblocked = { ok: true, value: { revision: 1, liveKey: 'live-b', bots: [{ id: 'bot-a' }], rooms: [] } }
    release(unblocked); await old
    assert.equal(connection.view().cached, false); assert.equal(connection.view().counts.red, 1)
    peer.stateReply = unblocked
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(Object.hasOwn(statePayload(peer), 'live'), false)
    assert.equal(connection.view().counts.red, 0); assert.equal(connection.view().counts.blue, 1)
  } finally { await connection.disconnect() }
})
test('增量先到后旧完整读取失败，仍保留全量核对且不把新状态退回缓存', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    let reject = (_error: Error): void => { throw new Error('未准备失败回包') }
    peer.stateReply = new Promise((_resolve, fail) => { reject = fail })
    const old = connection.poll()
    assert.equal(statePayload(peer).since, -1)
    peer.stateReply = { ok: true, value: { revision: 1, unchanged: true, liveKey: 'live-b', work: { bots: { 'bot-a': { tool: 'read' } }, rooms: {} } } }
    await connection.call('state', { since: 1, locale: 'zh-CN' })
    reject(new Error('fictional-old-timeout')); await old
    assert.equal(connection.view().cached, false); assert.equal(connection.view().error, null)
    assert.equal(connection.view().counts.green, 1)
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(Object.hasOwn(statePayload(peer), 'live'), false)
    assert.equal(connection.view().counts.red, 0); assert.equal(connection.view().counts.blue, 1)
  } finally { await connection.disconnect() }
})
test('完整回包版本落后时保留当前阻塞，下一次仍读取完整状态', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    peer.stateReply = { ok: true, value: { revision: 0, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().team?.revision, 1); assert.equal(connection.view().counts.red, 1)
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().counts.red, 0); assert.equal(connection.view().counts.blue, 1)
  } finally { await connection.disconnect() }
})
test('普通或其他对象通知不触发阻塞对象全量核对，重连仍从完整快照开始', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-b', seq: 1 } })
    await connection.poll(); assert.equal(statePayload(peer).since, 1)
    await connection.connect(); assert.equal(statePayload(peer).since, -1)
  } finally { await connection.disconnect() }
})
test('正常回复的完整快照撤销blocked后，另一后台失败不能被该回复清掉', async () => {
  const peer = new FixturePeer()
  const failedTask = { id: 'task-old', status: 'failed', error: '独立后台任务失败', endedAt: 8 }
  peer.stateReply = { ok: true, value: { ...blockedState(), bots: [{ id: 'bot-a', blocked: { code: 'ACCOUNT_QUOTA' }, tasks: [failedTask] }] } }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a', tasks: [failedTask] }], rooms: [], work: { bots: {}, rooms: {} } } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().cached, false)
    assert.equal(connection.view().team?.entities[0].detail, '独立后台任务失败')
    assert.equal(connection.view().counts.red, 1)
    assert.notEqual(connection.pendingToken('bot:bot-a'), null)
  } finally { await connection.disconnect() }
})
test('阻塞核对的损坏成功回包不能清故障，下一次有效完整快照才能恢复', async () => {
  const peer = new FixturePeer(); peer.stateReply = { ok: true, value: blockedState() }
  const connection = new ServerConnection(config(), () => peer, { changed: () => {}, paired: async () => {} })
  try {
    await connection.connect()
    peer.emit({ event: 'notice', data: { kind: 'message', botId: 'bot-a', seq: 1 } })
    peer.stateReply = { ok: true, value: { revision: 1, bots: 'invalid', rooms: [] } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().cached, true); assert.equal(connection.view().counts.red, 1)
    peer.stateReply = { ok: true, value: { revision: 1, unchanged: true, liveKey: 'live-b' } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().cached, true); assert.equal(connection.view().counts.red, 1)
    peer.stateReply = { ok: true, value: { revision: 1, bots: [{ id: 'bot-a' }], rooms: [] } }
    await connection.poll()
    assert.equal(statePayload(peer).since, -1)
    assert.equal(connection.view().cached, false)
    assert.equal(connection.view().counts.red, 0); assert.equal(connection.view().counts.blue, 1)
  } finally { await connection.disconnect() }
})
test('退避有界，失败次数不冒充任务失败', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 20].map(reconnectDelay), [2000, 4000, 8000, 16000, 30000, 30000])
})
