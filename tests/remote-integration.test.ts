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
import { toolSummaries } from '../src/shared/tool-model.ts'
import type { StringCipher } from '../src/main/vault.ts'
class FixtureCipher implements StringCipher {
  private readonly key = randomBytes(32)
  isEncryptionAvailable(): boolean { return true }
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
  private readonly target: string
  constructor(target: string) { this.target = target }
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  reason(): unknown { return null }
  probe(): void {}
  onEvent(_listener: (entry: PeerEvent) => void): () => void { return () => {} }
  onClose(_listener: () => void): () => void { return () => {} }
  async rpc<T = unknown>(_method: string, params: unknown): Promise<T> {
    const body = params as { endpoint: string; payload: unknown }; this.sent.push(body)
    const value = body.endpoint === 'hello' ? { api: 1, boot: `boot-${this.target}`, seq: 0 }
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
async function withClient(body: (manager: ServerManager, peers: Map<string, FixturePeer>) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-integration-'))
  let manager: ServerManager | null = null
  try {
    const vault = new Vault(path.join(directory, 'client.vault.json'), new FixtureCipher()); await vault.load()
    await vault.update(value => ({ ...value, servers: [saved('server-a'), saved('server-b')] }))
    const peers = new Map<string, FixturePeer>()
    manager = new ServerManager(vault, server => { const peer = new FixturePeer(server.id); peers.set(server.id, peer); return peer })
    await manager.connect('server-a'); await manager.connect('server-b')
    await body(manager, peers)
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
test('本机外观和宠物配置经真实身份库保存，不改变配对身份或发送远程请求', async () => {
  await withClient(async (manager, peers) => {
    const before = manager.connection('server-a').settings()
    const requests = new Map([...peers].map(([id, peer]) => [id, peer.sent.length]))
    await manager.setAppearance({ iconPath: 'C:/fixtures/deck.png', backgroundPath: 'C:/fixtures/background.webp', backgroundCrop: { cx: 0.3, cy: 0.7, zoom: 2 }, opacity: 0.6, language: 'zh-TW' })
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
    assert.deepEqual(manager.connection('server-a').settings(), before)
    for (const [id, peer] of peers) assert.equal(peer.sent.length, requests.get(id))
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
