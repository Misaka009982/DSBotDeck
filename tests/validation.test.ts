// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { command, frozenRequest, pairingText, relayUrl, savedClient, selection, validServerId } from '../src/shared/validation.ts'
import { defaultAppearance, defaultClient } from '../src/shared/domain.ts'

test('服务器保留字和无效目标被拒绝', () => {
  assert.equal(validServerId('shell'), false)
  assert.equal(validServerId('../other'), false)
  assert.equal(selection({ serverId: 'server-a', kind: 'bot', id: 'bot-a' })?.id, 'bot-a')
  assert.equal(command({ action: 'execute', code: 'anything' }), null)
})
test('中转地址不接受账号、查询令牌或错误协议', () => {
  assert.equal(relayUrl('wss://relay.example/v1/link'), 'wss://relay.example/v1/link')
  assert.throws(() => relayUrl('wss://user:password@relay.example/v1/link'))
  assert.throws(() => relayUrl('wss://relay.example/v1/link?token=fictional'))
  assert.throws(() => relayUrl('https://relay.example/v1/link'))
})
test('浏览器配对只取片段里的原 URI，不把片段带进网络路径', () => {
  const uri = 'dsbot://pair?v=1&device=browser'
  assert.equal(pairingText(`https://relay.example/web/#pair=${encodeURIComponent(uri)}`), uri)
  assert.throws(() => pairingText('https://relay.example/web/?pair=fictional'))
})
test('等待系统验证前冻结原请求', () => {
  const payload = { provider: 'fixture', value: 'fictional-original' }
  const request = frozenRequest('provider-key', payload)
  payload.value = 'fictional-changed'
  assert.deepEqual(request.payload, { provider: 'fixture', value: 'fictional-original' })
  assert.throws(() => frozenRequest('../other', {}))
})
test('保存格式无效时不默默重建身份', () => {
  assert.deepEqual(savedClient(defaultClient()), defaultClient())
  assert.throws(() => savedClient({ version: 1, servers: [{ id: 'server-a' }], pet: {} }), /未重建|未覆盖/)
})
test('旧版本本机配置补默认外观但不重置宠物或身份', () => {
  const old = { version: 1, servers: [], selected: null, pet: { enabled: true, locked: true, alwaysOnTop: false, position: { x: 20, y: 30 } }, window: null }
  const loaded = savedClient(old)
  assert.deepEqual(loaded.appearance, defaultAppearance())
  assert.equal(loaded.pet.enabled, true); assert.equal(loaded.pet.locked, true)
  assert.equal(loaded.pet.skin, null); assert.equal(loaded.pet.size, 112)
  assert.deepEqual(loaded.pet.position, { x: 20, y: 30 })
})
test('本机素材设置拒绝 URL、越界编号和无效数值', () => {
  const client = defaultClient()
  assert.throws(() => savedClient({ ...client, appearance: { ...client.appearance, iconPath: 'https://example/icon.png' } }))
  assert.throws(() => savedClient({ ...client, pet: { ...client.pet, skin: '../outside' } }))
  assert.throws(() => savedClient({ ...client, pet: { ...client.pet, size: 1000 } }))
  assert.throws(() => savedClient({ ...client, appearance: { ...client.appearance, opacity: NaN } }))
  assert.throws(() => savedClient({ ...client, appearance: { ...client.appearance, language: 'unsupported' } }))
  assert.equal(savedClient({ ...client, appearance: { ...client.appearance, language: 'en' } }).appearance.language, 'en')
})
