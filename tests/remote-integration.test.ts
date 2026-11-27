// SPDX-License-Identifier: Apache-2.0
// 集成定义使用真实 Vault、ServerManager、ServerConnection、RequestGate 与 scheme 适配。
// 仅边界用虚构 Peer 和测试加密器替代，不连接服务器、不弹出系统验证。
import { strict as assert } from 'node:assert'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { SavedServer } from '../src/shared/domain.ts'
import { newIdentity } from '../src/main/link-factory.ts'
import type { Peer, PeerEvent } from '../src/main/link-factory.ts'
import { clientHandler } from '../src/main/protocol.ts'
import { RequestGate } from '../src/main/request-gate.ts'
import { ServerManager } from '../src/main/server-manager.ts'
import { Vault } from '../src/main/vault.ts'
import { goalReply, goalRequest } from '../src/shared/private-goal.ts'
import { toolSummaries } from '../src/shared/tool-model.ts'
import { delegationList, delegationPage } from '../src/shared/delegation-model.ts'
import { changePage } from '../src/shared/change-model.ts'
import { workspaceDirectory, workspaceFile, workspaceRoot } from '../src/shared/workspace-model.ts'
import type { StringCipher } from '../src/main/vault.ts'
class FixtureCipher implements StringCipher {
  available = true
  private readonly key = randomBytes(32)
  isEncryptionAvailable(): boolean { return this.available }
  encryptString(value: string): Buffer {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), bytes])
  }
  decryptString(value: Buffer): string {
    const cipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
  }
}
class FixturePeer implements Peer {
  readonly sent: { endpoint: string; payload: unknown }[] = []
  approvalError: string | null = null
  resourceError: string | null = null
  connectError: Error | null = null
  closed = false
  readonly resourceReplies = new Map<string, unknown>()
  private readonly target: string
  constructor(target: string) { this.target = target }
  async connect(): Promise<void> { if (this.connectError) throw this.connectError }
  async close(): Promise<void> { this.closed = true }
  reason(): unknown { return null }
  probe(): void {}
  onEvent(_listener: (entry: PeerEvent) => void): () => void { return () => {} }
  onClose(_listener: () => void): () => void { return () => {} }
  async rpc<T = unknown>(_method: string, params: unknown): Promise<T> {
    const body = params as { endpoint: string; payload: unknown }; this.sent.push(body)
    if (body.endpoint === 'approval-answer' && this.approvalError) return { ok: false, error: { code: this.approvalError, message: '此审批已失效。' } } as T
    if (body.endpoint.startsWith('extra-') && this.resourceError) return { ok: false, error: { code: this.resourceError, message: '资源读取已拒绝。' } } as T
    const value = this.resourceReplies.has(body.endpoint) ? this.resourceReplies.get(body.endpoint)
      : body.endpoint === 'hello' ? { api: 1, boot: `boot-${this.target}`, seq: 0 }
      : body.endpoint === 'state' ? { revision: 1, bots: [{ id: `${this.target}-bot`, name: this.target }], rooms: [] }
      : body.endpoint === 'notices' ? { boot: `boot-${this.target}`, seq: 0, notices: [] }
      : body.endpoint === 'chat' ? { items: [{ kind: 'steps', turn: 1, tools: [{ name: 'read_file', ok: true }, { name: 'run_command', ok: false }, { name: 'web_search' }] }], cursor: null }
      : { target: this.target, payload: body.payload }
    return { ok: true, value } as T
  }
}
const saved = (id: string): SavedServer => {
  const host = newIdentity()
  return { id, alias: id, relayUrl: 'wss://relay.example/v1/link', hostDeviceId: host.deviceId, hostKey: host.publicKey, mode: 'phone', identity: newIdentity(), paired: true, autoConnect: false, unfollowed: [] }
}
async function withClient(body: (manager: ServerManager, peers: Map<string, FixturePeer>, storage: { vault: Vault; cipher: FixtureCipher; file: string }) => Promise<void>, options: { servers?: SavedServer[]; configure?: (server: SavedServer, peer: FixturePeer, pairingCode?: string) => void } = {}): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-integration-'))
  let manager: ServerManager | null = null
  try {
    const file = path.join(directory, 'client.vault.json'); const cipher = new FixtureCipher()
    const vault = new Vault(file, cipher); await vault.load()
    await vault.update(value => ({ ...value, servers: options.servers ?? [saved('server-a'), saved('server-b')] }))
    const peers = new Map<string, FixturePeer>()
    manager = new ServerManager(vault, (server, pairingCode) => { const peer = new FixturePeer(server.id); options.configure?.(server, peer, pairingCode); peers.set(server.id, peer); return peer })
    await manager.connect('server-a'); await manager.connect('server-b')
    await body(manager, peers, { vault, cipher, file })
  } finally { await manager?.stop(); await rm(directory, { recursive: true, force: true }) }
}
test('两个真实连接对象使用隔离身份，公开快照没有链路私钥或令牌', async () => {
  await withClient(async manager => {
    const a = manager.connection('server-a').settings(); const b = manager.connection('server-b').settings()
    assert.notEqual(a.identity.deviceId, b.identity.deviceId)
    const snapshot = JSON.stringify(manager.snapshot())
    for (const secret of [a.identity.privateKey, b.identity.privateKey, a.identity.accessToken, b.identity.accessToken]) assert.equal(snapshot.includes(secret), false)
  })
})
test('更换隧道持久化原设备身份、权限及选择，只重连目标服务器', async () => {
  for (const mode of ['phone', 'browser'] as const) {
    const first = { ...saved('server-a'), mode }
    const opened: { server: SavedServer; pairingCode?: string }[] = []
    await withClient(async (manager, peers, { file, cipher }) => {
      await manager.rename('server-a', '我的服务器'); await manager.follow('server-a', 'bot:server-a-bot', false)
      await manager.select({ serverId: 'server-a', kind: 'bot', id: 'server-a-bot' })
      const connection = manager.connection('server-a'); const before = connection.settings()
      const oldPeer = peers.get('server-a'); const otherPeer = peers.get('server-b'); const otherRequests = otherPeer?.sent.length
      const oldToken = connection.token(); assert.ok(oldToken)
      const selection = manager.currentSelection(); const other = manager.connection('server-b').settings()
      const changed = await manager.changeRelay('server-a', 'new.example', before.relayUrl)
      assert.deepEqual(changed, { relay: 'wss://new.example/v1/link', connected: true, message: null })
      assert.equal(manager.connection('server-a'), connection); assert.equal(connection.valid(oldToken), false)
      assert.equal(oldPeer?.closed, true); assert.notEqual(peers.get('server-a'), oldPeer)
      assert.equal(peers.get('server-b'), otherPeer); assert.equal(otherPeer?.closed, false); assert.equal(otherPeer?.sent.length, otherRequests)
      const expected = { ...before, relayUrl: changed.relay, autoConnect: true }
      assert.deepEqual(connection.settings(), expected); assert.deepEqual(manager.connection('server-b').settings(), other)
      assert.deepEqual(manager.currentSelection(), selection); assert.equal(manager.activeServer(), 'server-a')
      assert.equal(connection.view().team?.entities[0].followed, false)
      assert.deepEqual(opened.at(-1), { server: expected, pairingCode: undefined })
      const restored = await new Vault(file, cipher).load()
      assert.deepEqual(restored.servers.find(server => server.id === 'server-a'), expected); assert.deepEqual(restored.selected, selection)
      for (const secret of [before.identity.privateKey, before.identity.accessToken, before.hostKey]) assert.equal(JSON.stringify(changed).includes(secret), false)
    }, { servers: [first, saved('server-b')], configure: (server, _peer, pairingCode) => { opened.push({ server: structuredClone(server), pairingCode }) } })
  }
})
test('非法地址、过期表单及重复主机地址在断开前拒绝，不改原配置', async () => {
  const first = saved('server-a'); const second = { ...saved('server-b'), hostKey: first.hostKey, hostDeviceId: first.hostDeviceId, relayUrl: 'wss://duplicate.example/v1/link' }
  await withClient(async (manager, peers, { vault }) => {
    const before = vault.snapshot(); const connection = manager.connection('server-a'); const token = connection.token(); assert.ok(token)
    const peer = peers.get('server-a')
    await assert.rejects(manager.changeRelay('server-a', 'https://new.example/?token=fictional', first.relayUrl), /查询参数/)
    await assert.rejects(manager.changeRelay('server-a', 'new.example', 'wss://outdated.example/v1/link'), /地址已变化/)
    await assert.rejects(manager.changeRelay('server-a', 'duplicate.example', first.relayUrl), /已有连接/)
    assert.equal(connection.valid(token), true); assert.equal(peers.get('server-a'), peer); assert.equal(peer?.closed, false)
    assert.deepEqual(vault.snapshot(), before)
  }, { servers: [first, second] })
})
test('隧道变更加密保存失败保留旧地址和身份，不创建新连接', async () => {
  await withClient(async (manager, peers, { vault, cipher, file }) => {
    const before = vault.snapshot(); const connection = manager.connection('server-a'); const settings = connection.settings(); const oldPeer = peers.get('server-a')
    cipher.available = false
    await assert.rejects(manager.changeRelay('server-a', 'new.example', settings.relayUrl), /加密不可用/)
    assert.deepEqual(vault.snapshot(), before); assert.deepEqual(connection.settings(), settings)
    assert.equal(peers.get('server-a'), oldPeer); assert.equal(connection.view().cached, true)
    cipher.available = true
    assert.deepEqual(await new Vault(file, cipher).load(), before)
    await manager.connect('server-a'); assert.equal(connection.view().cached, false); assert.equal(connection.view().relay, settings.relayUrl)
  })
})
test('新隧道不可达明确返回已保存，保留缓存且可再次修改，无需消费配对码', async () => {
  await withClient(async (manager, _peers, { file, cipher }) => {
    const connection = manager.connection('server-a'); const before = connection.settings(); const entities = connection.view().team?.entities
    const changed = await manager.changeRelay('server-a', 'offline.example', before.relayUrl)
    assert.equal(changed.connected, false); assert.match(changed.message ?? '', /地址已保存/)
    assert.equal(connection.view().cached, true); assert.deepEqual(connection.view().team?.entities, entities)
    assert.deepEqual(connection.settings().identity, before.identity); assert.equal(connection.settings().paired, true)
    const loaded = await new Vault(file, cipher).load()
    assert.equal(loaded.servers.find(server => server.id === 'server-a')?.relayUrl, changed.relay)
    await assert.rejects(manager.changeRelay('server-a', 'next.example', before.relayUrl), /地址已变化/)
    const recovered = await manager.changeRelay('server-a', 'next.example', changed.relay)
    assert.equal(recovered.connected, true); assert.equal(connection.view().relay, 'wss://next.example/v1/link')
  }, { configure: (server, peer, pairingCode) => {
    assert.equal(pairingCode, undefined)
    if (server.relayUrl === 'wss://offline.example/v1/link') peer.connectError = Object.assign(new Error('虚构链路故障'), { code: 'SERVER_UNREACHABLE' })
  } })
})
test('隧道切换中同服务器连接操作互斥，别名与另一服务器仍可更新', async () => {
  await withClient(async (manager, peers) => {
    const connection = manager.connection('server-a'); const before = connection.settings(); const peer = peers.get('server-a'); assert.ok(peer)
    let release = (): void => {}; let entered = (): void => {}
    const blocked = new Promise<void>(resolve => { release = resolve })
    const closing = new Promise<void>(resolve => { entered = resolve })
    peer.close = async () => { entered(); await blocked }
    const changing = manager.changeRelay('server-a', 'new.example', before.relayUrl)
    try {
      await closing
      await assert.rejects(manager.changeRelay('server-a', 'another.example', before.relayUrl), /连接操作尚未完成/)
      await assert.rejects(manager.connect('server-a'), /连接操作尚未完成/)
      await assert.rejects(manager.disconnect('server-a'), /连接操作尚未完成/)
      await assert.rejects(manager.forget('server-a'), /连接操作尚未完成/)
      await assert.rejects(manager.pair('fictional-pairing', '', 'server-a'), /连接操作尚未完成/)
      await manager.rename('server-a', '保留的新别名')
      await manager.disconnect('server-b'); assert.equal(manager.connection('server-b').view().state, 'disconnected')
    } finally { release() }
    assert.equal((await changing).connected, true)
    assert.deepEqual(connection.settings(), { ...before, alias: '保留的新别名', relayUrl: 'wss://new.example/v1/link', autoConnect: true })
  })
})
test('隧道切换等待关闭期间退出，不保存新地址或重新建立连接', async () => {
  await withClient(async (manager, peers, { vault }) => {
    const before = vault.snapshot(); const settings = manager.connection('server-a').settings(); const peer = peers.get('server-a'); assert.ok(peer)
    let release = (): void => {}; let entered = (): void => {}
    const blocked = new Promise<void>(resolve => { release = resolve }); const closing = new Promise<void>(resolve => { entered = resolve })
    peer.close = async () => { entered(); await blocked }
    const changing = assert.rejects(manager.changeRelay('server-a', 'new.example', settings.relayUrl), /正在退出/)
    try { await closing; await manager.stop() } finally { release() }
    await changing
    assert.deepEqual(vault.snapshot(), before); assert.equal(peers.get('server-a'), peer)
    assert.equal(manager.connection('server-a').view().state, 'disconnected')
  })
})
test('本机外观和宠物配置经真实身份库保存，不改变配对身份或发送远程请求', async () => {
  await withClient(async (manager, peers) => {
    const before = manager.connection('server-a').settings()
    const requests = new Map([...peers].map(([id, peer]) => [id, peer.sent.length]))
    await manager.setAppearance({ theme: 'paper', themeMode: 'light', iconPath: 'C:/fixtures/deck.png', backgroundPath: 'C:/fixtures/background.webp', backgroundCrop: { cx: 0.3, cy: 0.7, zoom: 2 }, opacity: 0.6, language: 'zh-TW' })
    const icon = { look: { shape: 'whale', color: 'blue' }, png: Buffer.from('fictional-png').toString('base64') }
    await manager.setAppearance({ iconPath: null, builtinIcon: icon })
    await manager.setPet({ skin: 'fixture-pet', size: 128, locked: true, mark: { shape: 'kitty', color: 'aurora' } })
    const snapshot = manager.snapshot()
    assert.deepEqual(snapshot.appearance.backgroundCrop, { cx: 0.3, cy: 0.7, zoom: 2 })
    assert.deepEqual(snapshot.appearance.builtinIcon, { look: icon.look })
    assert.equal(JSON.stringify(snapshot).includes(icon.png), false)
    assert.deepEqual(snapshot.pet.mark, { shape: 'kitty', color: 'aurora' })
    assert.equal(snapshot.appearance.opacity, 0.6); assert.equal(snapshot.appearance.language, 'zh-TW'); assert.equal(snapshot.pet.skin, 'fixture-pet')
    assert.equal(snapshot.pet.size, 128); assert.equal(snapshot.pet.locked, true)
    assert.equal(snapshot.appearance.theme, 'paper'); assert.equal(snapshot.appearance.themeMode, 'light')
    await manager.select({ serverId: 'server-b', kind: 'bot', id: 'server-b-bot' })
    assert.equal(manager.snapshot().appearance.theme, 'paper'); assert.equal(manager.snapshot().appearance.themeMode, 'light')
    assert.deepEqual(manager.connection('server-a').settings(), before)
    for (const [id, peer] of peers) assert.equal(peer.sent.length, requests.get(id))
  })
})
test('默认无额外本机验证的真实链路仍绑定原服务器并拒绝导航 ABA', async () => {
  await withClient(async (manager, peers) => {
    let epoch = 1
    manager.navigate('server-a', { action: 'settings', page: 'models' })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate: new RequestGate(), connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => { const opening = epoch; return () => opening === epoch && manager.activeServer() === 'server-a' }, renderedTarget: () => null, read: () => {} })
    const payload = { provider: 'fictional-provider', value: 'fictional-provider-value' }
    const request = () => new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'provider-key', payload }) })
    const response = await handler(request())
    const result = await response.json() as { ok: boolean; value: { target: string } }
    assert.equal(result.ok, true); assert.equal(result.value.target, 'server-a')
    const pending = handler(request())
    manager.navigate('server-b', { action: 'settings' }); epoch += 1
    manager.navigate('server-a', { action: 'settings', page: 'models' }); epoch += 1
    const changed = await (await pending).json() as { ok: boolean; error: { code: string } }
    assert.equal(changed.ok, false); assert.equal(changed.error.code, 'bot/refused')
    assert.deepEqual(peers.get('server-a')?.sent.filter(entry => entry.endpoint === 'provider-key'), [{ endpoint: 'provider-key', payload }])
    assert.equal(peers.get('server-b')?.sent.some(entry => entry.endpoint === 'provider-key'), false)
  })
})
test('原 UI 的 JSON 请求通过真实适配和门禁，只发送到固定目标', async () => {
  await withClient(async (manager, peers) => {
    manager.navigate('server-a', { action: 'settings', page: 'models' })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate: new RequestGate({ verify: async () => true }), connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => null, read: () => {} })
    const response = await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'provider-key', payload: { value: 'fictional-provider-value' } }) }))
    const result = await response.json() as { ok: boolean; value: { target: string } }
    assert.equal(result.ok, true); assert.equal(result.value.target, 'server-a')
    assert.equal(peers.get('server-a')?.sent.filter(entry => entry.endpoint === 'provider-key').length, 1)
    assert.equal(peers.get('server-b')?.sent.filter(entry => entry.endpoint === 'provider-key').length, 0)
  })
})
test('工具步骤通过真实只读 scheme 链路进入摘要，不请求电脑控制或系统验证', async () => {
  await withClient(async (manager, peers) => {
    let verifications = 0
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const gate = new RequestGate({ verify: async () => { verifications += 1; return true } })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate, connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => ({ kind: 'bot', id: 'server-a-bot' }), read: () => {} })
    const payload = { botId: 'server-a-bot', steps: true }
    const response = await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'chat', payload }) }))
    const result = await response.json() as { ok: boolean; value: { items: unknown[] } }
    assert.equal(result.ok, true)
    assert.deepEqual(toolSummaries(result.value.items[0]).map(tool => tool.outcome), ['success', 'failure', 'unknown'])
    assert.deepEqual(peers.get('server-a')?.sent.find(entry => entry.endpoint === 'chat')?.payload, payload)
    assert.equal(peers.get('server-b')?.sent.some(entry => entry.endpoint === 'chat'), false)
    for (const peer of peers.values()) assert.equal(peer.sent.some(entry => entry.endpoint.startsWith('computer-') || entry.endpoint.startsWith('browser-')), false)
    assert.equal(verifications, 0)
  })
})
test('委派、工作区与修改读取经真实scheme和门禁返回原DTO，不串服务器或确认聊天已读', async () => {
  await withClient(async (manager, peers) => {
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const peer = peers.get('server-a'); assert.ok(peer)
    let viewed = 0
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate: new RequestGate({ verify: async () => { throw new Error('读取不增加本机验证') } }),
      connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a',
      context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => ({ kind: 'bot', id: 'server-a-bot' }), read: () => { viewed += 1 } })
    const read = async (endpoint: string, payload: unknown) => {
      const response = await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) }))
      return await response.json() as { ok: boolean; value?: unknown; error?: { code: string } }
    }
    const target = { scope: { kind: 'bot' as const, botId: 'server-a-bot' }, sessionId: 'server-a-bot' }
    peer.resourceReplies.set('extra-delegation-list', { schema: 1, rootSessionId: target.sessionId, parentSessionId: target.sessionId, items: [], nextAfterChildId: null, depthLimit: 8 })
    const list = await read('extra-delegation-list', { scope: target.scope, rootSessionId: target.sessionId, childPath: [], limit: 32 })
    assert.equal(list.ok, true); assert.deepEqual(delegationList(list.value, target, []).items, [])
    peer.resourceReplies.set('extra-delegation-read', { schema: 1, rootSessionId: target.sessionId, parentSessionId: target.sessionId,
      child: { childId: 'child-a', mode: 'external', createdAt: 0, label: null, status: 'unknown', statusSource: null, runId: null, lastSettlement: null },
      history: 'external', throughSeq: null, events: [], cursor: null, result: null, lastTurn: null })
    const child = await read('extra-delegation-read', { scope: target.scope, rootSessionId: target.sessionId, childPath: ['child-a'] })
    assert.equal(child.ok, true); assert.equal(delegationPage(child.value, target, ['child-a']).history, 'external')
    peer.resourceReplies.set('extra-workspace-open', { schema: 1, rootId: 'root-a', sessionId: target.sessionId, expiresAt: 1000, maxFileBytes: 256 * 1024, pageSize: 64, writable: false })
    const opened = await read('extra-workspace-open', target); assert.equal(opened.ok, true)
    const root = workspaceRoot(opened.value, target)
    peer.resourceReplies.set('extra-workspace-list', { schema: 1, rootId: root.rootId, path: '', entries: [{ name: 'readme.txt', type: 'file' }], filtered: false, cursor: null })
    const listed = await read('extra-workspace-list', { rootId: root.rootId, path: '' }); assert.equal(listed.ok, true)
    assert.equal(workspaceDirectory(listed.value, root, '').entries[0].name, 'readme.txt')
    peer.resourceReplies.set('extra-workspace-read', { schema: 1, rootId: root.rootId, path: 'readme.txt', text: '完整原文', version: 'opaque-version', encoding: 'utf-8', complete: true, editable: false, redacted: false, receiptId: null })
    const file = await read('extra-workspace-read', { rootId: root.rootId, path: 'readme.txt' }); assert.equal(file.ok, true)
    assert.equal(workspaceFile(file.value, root, 'readme.txt').text, '完整原文')
    const reference = { sessionId: target.sessionId, callId: 'call-a', callSeq: 1 }
    peer.resourceReplies.set('extra-tool-change', { schema: 1, source: 'tool-result', ...reference, resultSeq: null, index: 0, available: false, reason: '没有结果记录' })
    const changed = await read('extra-tool-change', { ...reference, index: 0 }); assert.equal(changed.ok, true)
    assert.equal(changePage(changed.value, reference).available, false)
    peer.resourceError = 'bot/refused'
    const denied = await read('extra-workspace-read', { rootId: root.rootId, path: 'readme.txt' })
    assert.equal(denied.ok, false); assert.equal(denied.error?.code, 'bot/refused')
    const before = peer.sent.length
    const save = await read('extra-workspace-save', { rootId: root.rootId })
    assert.equal(save.ok, false); assert.equal(save.error?.code, 'bot/refused'); assert.equal(peer.sent.length, before + 1)
    const unknown = await read('extra-workspace-force-save', { rootId: root.rootId })
    assert.equal(unknown.ok, false); assert.equal(peer.sent.length, before + 1)
    peer.resourceError = null
    for (const endpoint of ['extra-terminal-list', 'extra-terminal-read', 'extra-terminal-create', 'extra-terminal-input', 'extra-terminal-resize', 'extra-terminal-close', 'extra-workspace-save-status', 'extra-workspace-change']) {
      const payload = { fixture: endpoint }
      peer.resourceReplies.set(endpoint, { schema: 1, fixture: endpoint })
      const response = await read(endpoint, payload)
      assert.equal(response.ok, true); assert.deepEqual(response.value, { schema: 1, fixture: endpoint })
      assert.deepEqual(peer.sent.at(-1), { endpoint, payload })
    }
    assert.equal(viewed, 0)
    assert.equal(peers.get('server-b')?.sent.some(item => item.endpoint.startsWith('extra-')), false)
  })
})
test('私聊目标控制通过真实scheme固定发送到原服务器，拒绝保留且未知端点不发送', async () => {
  await withClient(async (manager, peers) => {
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const peer = peers.get('server-a'); assert.ok(peer)
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate: new RequestGate(),
      connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a',
      context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => null, read: () => {} })
    const payload = goalRequest({ botId: 'server-a-bot', sessionId: 'server-a-bot' }, null, 'start', { objective: '完成测试任务', acceptance: '核对实际结果' })
    const response = { schema: 1, id: 'goal-a', revision: 1, status: 'active', objective: payload.objective, acceptance: payload.acceptance, progress: '', evidence: '', reason: '', rounds: 0, emptyTurns: 0, updatedAt: 1 }
    peer.resourceReplies.set('extra-goal-control', response)
    const request = (endpoint = 'extra-goal-control') => new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })
    const result = await (await handler(request())).json() as { ok: boolean; value: unknown }
    assert.equal(result.ok, true); assert.equal(goalReply(result.value, payload).id, 'goal-a')
    assert.deepEqual(peer.sent.at(-1), { endpoint: 'extra-goal-control', payload })
    peer.resourceError = 'bot/stale'
    const stale = await (await handler(request())).json() as { ok: boolean; error: { code: string } }
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'bot/stale')
    const count = peer.sent.length
    assert.equal((await (await handler(request('extra-goal-reset'))).json() as { ok: boolean }).ok, false)
    manager.navigate('server-b', { action: 'chat', kind: 'bot', id: 'server-b-bot' })
    assert.equal((await (await handler(request())).json() as { ok: boolean }).ok, false)
    assert.equal(peer.sent.length, count)
    assert.equal(peers.get('server-b')?.sent.some(item => item.endpoint.startsWith('extra-goal-')), false)
  })
})
test('普通私聊审批通过真实门禁回传原编号与选择，只发送到原服务器', async () => {
  await withClient(async (manager, peers) => {
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const gate = new RequestGate({ verify: async () => { throw new Error('原审批不应增加其他授权流程') } })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate, connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => ({ kind: 'bot', id: 'server-a-bot' }), read: () => {} })
    for (const choice of ['allow', 'reject']) {
      const payload = { id: `approval-${choice}`, choice }
      const response = await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'approval-answer', payload }) }))
      const result = await response.json() as { ok: boolean; value: { target: string; payload: unknown } }
      assert.equal(result.ok, true); assert.equal(result.value.target, 'server-a'); assert.deepEqual(result.value.payload, payload)
    }
    assert.deepEqual(peers.get('server-a')?.sent.filter(entry => entry.endpoint === 'approval-answer'), [
      { endpoint: 'approval-answer', payload: { id: 'approval-allow', choice: 'allow' } },
      { endpoint: 'approval-answer', payload: { id: 'approval-reject', choice: 'reject' } },
    ])
    assert.equal(peers.get('server-b')?.sent.some(entry => entry.endpoint === 'approval-answer'), false)
  })
})
test('学习审批通过真实scheme和原配对链路回传选择，切服及旧界面不投递', async () => {
  await withClient(async (manager, peers) => {
    const peer = peers.get('server-a'); assert.ok(peer)
    let epoch = 1
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate: new RequestGate(), connection: () => manager.connection('server-a'),
      active: () => manager.activeServer() === 'server-a', instance: () => 'view-a',
      context: () => { const opening = epoch; return () => epoch === opening && manager.activeServer() === 'server-a' }, renderedTarget: () => ({ kind: 'bot', id: 'server-a-bot' }), read: () => {} })
    const request = (approve: boolean) => new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'learning-answer', payload: { id: 'proposal-a', approve } }) })
    for (const approve of [true, false]) {
      peer.resourceReplies.set('learning-answer', { applied: approve })
      const result = await (await handler(request(approve))).json() as { ok: boolean; value: unknown }
      assert.equal(result.ok, true); assert.deepEqual(result.value, { applied: approve })
    }
    const rpc = peer.rpc.bind(peer)
    peer.rpc = async <T>(method: string, payload: unknown) => { const value = await rpc<T>(method, payload); epoch++; return value }
    const stale = await (await handler(request(true))).json() as { ok: boolean; error: { code: string } }
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'bot/outcome-unknown')
    manager.navigate('server-b', { action: 'chat', kind: 'bot', id: 'server-b-bot' })
    const switched = await (await handler(request(true))).json() as { ok: boolean }
    assert.equal(switched.ok, false)
    assert.equal(peer.sent.filter(entry => entry.endpoint === 'learning-answer').length, 3)
    assert.equal(peers.get('server-b')?.sent.some(entry => entry.endpoint === 'learning-answer'), false)
  })
})
test('设备学习授权穿过真实状态投影与scheme，完整消息开关不能代替且撤销立即拒绝', async () => {
  for (const mode of ['phone', 'browser'] as const) {
    await withClient(async (manager, peers) => {
      const peer = peers.get('server-a'); assert.ok(peer)
      const connection = manager.connection('server-a')
      manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
      const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate: new RequestGate(), connection: () => connection,
        active: () => true, instance: () => 'view-a', context: () => () => true, renderedTarget: () => ({ kind: 'bot', id: 'server-a-bot' }), read: () => {} })
      const request = () => new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'learning-answer', payload: { id: 'proposal-a', approve: false } }) })
      const state = (allowed: boolean) => ({ unchanged: true, revision: 1, extras: { schema: 1, fullMessages: !allowed, learningApproval: { schema: 1, allowed } } })
      connection.applyState(state(false))
      assert.equal((await (await handler(request())).json() as { ok: boolean }).ok, false)
      assert.equal(peer.sent.some(entry => entry.endpoint === 'learning-answer'), false)
      connection.applyState(state(true)); peer.resourceReplies.set('learning-answer', { applied: false })
      assert.equal((await (await handler(request())).json() as { ok: boolean }).ok, true)
      connection.applyState(state(false))
      assert.equal((await (await handler(request())).json() as { ok: boolean }).ok, false)
      assert.equal(peer.sent.filter(entry => entry.endpoint === 'learning-answer').length, 1)
    }, { servers: [{ ...saved('server-a'), mode }, saved('server-b')] })
  }
})
test('过期审批不自动重发，切服或断线时不会发送旧授权', async () => {
  await withClient(async (manager, peers) => {
    const peer = peers.get('server-a'); assert.ok(peer)
    peer.approvalError = 'bot/stale'
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const gate = new RequestGate({ verify: async () => { throw new Error('不应额外系统验证') } })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate, connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => ({ kind: 'bot', id: 'server-a-bot' }), read: () => {} })
    const request = () => new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'approval-answer', payload: { id: 'approval-old', choice: 'allow' } }) })
    const stale = await (await handler(request())).json() as { ok: boolean; error: { code: string } }
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'bot/stale')
    peer.approvalError = null
    manager.navigate('server-b', { action: 'chat', kind: 'bot', id: 'server-b-bot' })
    const switched = await (await handler(request())).json() as { ok: boolean; error: { code: string } }
    assert.equal(switched.ok, false); assert.equal(switched.error.code, 'bot/refused')
    await manager.disconnect('server-a')
    manager.navigate('server-a', { action: 'chat', kind: 'bot', id: 'server-a-bot' })
    const disconnected = await (await handler(request())).json() as { ok: boolean; error: { code: string } }
    assert.equal(disconnected.ok, false); assert.equal(disconnected.error.code, 'bot/read-only')
    assert.equal(peer.sent.filter(entry => entry.endpoint === 'approval-answer').length, 1)
    assert.equal(peers.get('server-b')?.sent.some(entry => entry.endpoint === 'approval-answer'), false)
  })
})
test('原 UI 的接管请求在真实 scheme 门禁中直接拒绝，不验证或发送', async () => {
  await withClient(async (manager, peers) => {
    let verifications = 0
    manager.navigate('server-a', { action: 'settings' })
    const gate = new RequestGate({ verify: async () => { verifications += 1; return true } })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate, connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => () => manager.activeServer() === 'server-a', renderedTarget: () => null, read: () => {} })
    for (const endpoint of ['computer-takeover', 'browser-takeover', 'browser-frame']) {
      const response = await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload: {} }) }))
      const result = await response.json() as { ok: boolean; error: { code: string; message: string } }
      assert.equal(result.ok, false); assert.equal(result.error.code, 'bot/refused')
      assert.match(result.error.message, /不提供远程电脑控制或浏览器接管/)
      for (const peer of peers.values()) assert.equal(peer.sent.some(entry => entry.endpoint === endpoint), false)
    }
    assert.equal(verifications, 0)
  })
})
test('验证期间换出再换回原服务器，真实 scheme 链路仍拒绝旧请求', async () => {
  await withClient(async (manager, peers) => {
    let epoch = 1
    manager.navigate('server-a', { action: 'settings', page: 'models' })
    const gate = new RequestGate({ verify: async () => {
      manager.navigate('server-b', { action: 'settings' }); epoch += 1
      manager.navigate('server-a', { action: 'settings' }); epoch += 1
      return true
    } })
    const handler = clientHandler({ host: 'server-a', root: path.resolve('fixture'), gate, connection: () => manager.connection('server-a'), active: () => manager.activeServer() === 'server-a', instance: () => 'view-a', context: () => { const opening = epoch; return () => opening === epoch && manager.activeServer() === 'server-a' }, renderedTarget: () => null, read: () => {} })
    const response = await handler(new Request('dsbotdeck://server-a/view-a/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'provider-key', payload: { value: 'fictional-provider-value' } }) }))
    assert.equal((await response.json() as { ok: boolean }).ok, false)
    assert.equal(peers.get('server-a')?.sent.filter(entry => entry.endpoint === 'provider-key').length, 0)
    assert.equal(peers.get('server-b')?.sent.filter(entry => entry.endpoint === 'provider-key').length, 0)
  })
})
