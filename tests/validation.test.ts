// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PICKER_SHAPES, CHARACTER_COLORS } from '@dsbot/characters'
import { allThemes } from '@dsbot/themes'
import { backgroundCrop, command, frozenRequest, localMark, pairingText, relayUrl, replacementRelayUrl, savedAppearance, savedBuiltinIcon, savedClient, selection, validServerId } from '../src/shared/validation.ts'
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
test('更换域名保留原协议端口和路径，填写来源或完整地址可明确覆盖', () => {
  const original = 'wss://old.example:8443/v1/link'
  assert.equal(replacementRelayUrl(original, ' new.example '), 'wss://new.example:8443/v1/link')
  assert.equal(replacementRelayUrl(original, 'new.example:443'), 'wss://new.example/v1/link')
  assert.equal(replacementRelayUrl(original, 'https://new.example/'), 'wss://new.example/v1/link')
  assert.equal(replacementRelayUrl(original, 'https://new.example/proxy/link'), 'wss://new.example/proxy/link')
  assert.equal(replacementRelayUrl(original, 'ws://localhost:8787/custom/link'), 'ws://localhost:8787/custom/link')
  assert.equal(replacementRelayUrl(original, 'wss://new.example/'), 'wss://new.example/')
  assert.equal(replacementRelayUrl('ws://old.example:8787/v1/link', '[::1]'), 'ws://[::1]:8787/v1/link')
  assert.equal(replacementRelayUrl(original, 'http://localhost:8787'), 'ws://localhost:8787/v1/link')
})
test('新隧道拒绝配对码、账号、查询片段及含混输入，不静默删掉敏感字段', () => {
  for (const address of [null, true, '', ' ', 'a'.repeat(2049), '\u0000new.example', 'new.example\u007f', 'new.example:70000', '//new.example', '/relative', 'new.example/path', 'new.example\\\\path', 'new.\nexample', 'https://user:password@new.example', 'https://new.example/?token=fictional', 'https://new.example/#pair=fictional', 'https://new.example/?', 'https://new.example/#', 'file:///C:/fixture', 'ftp://new.example', 'dsbot://pair?v=1']) {
    assert.throws(() => replacementRelayUrl('wss://old.example/v1/link', address))
  }
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
  assert.equal(loaded.pet.mark, null); assert.equal(loaded.appearance.builtinIcon, null)
  assert.deepEqual(loaded.pet.position, { x: 20, y: 30 })
})
test('窗口旧矩形继续兼容，新配置保留最大化且无效坐标不传给系统', () => {
  const client = defaultClient(); const rectangle = { x: -1800, y: 80, width: 1200, height: 800 }
  assert.deepEqual(savedClient({ ...client, window: rectangle }).window, { ...rectangle, maximized: false })
  assert.deepEqual(savedClient({ ...client, window: { ...rectangle, maximized: true } }).window, { ...rectangle, maximized: true })
  assert.equal(savedClient({ ...client, window: { ...rectangle, maximized: 'true' } }).window?.maximized, false)
  assert.equal(savedClient({ ...client, window: { ...rectangle, x: NaN } }).window, null)
})
test('本机内置外观复用上游全部形状与配色，拒绝未知标识和超大图片', () => {
  for (const shape of PICKER_SHAPES) for (const color of CHARACTER_COLORS) assert.deepEqual(localMark({ shape, color }), { shape, color })
  assert.throws(() => localMark({ shape: '../custom.svg', color: 'blue' }))
  assert.throws(() => localMark({ shape: 'whale', color: 'url(https://example/x)' }))
  assert.throws(() => savedBuiltinIcon({ look: { shape: 'whale', color: 'blue' }, png: 'data:image/svg+xml,<svg/>' }))
  assert.throws(() => savedBuiltinIcon({ look: { shape: 'whale', color: 'blue' }, png: 'A'.repeat(400004) }))
  const client = defaultClient()
  const next = savedClient({ ...client, pet: { ...client.pet, mark: { shape: 'kitty', color: 'aurora' } } })
  assert.deepEqual(next.pet.mark, { shape: 'kitty', color: 'aurora' })
  assert.deepEqual(next.servers, client.servers)
})
test('背景选区兼容旧外观并拒绝非数值和越界缩放', () => {
  const client = defaultClient()
  const { backgroundCrop: _crop, ...old } = client.appearance
  assert.equal(savedClient({ ...client, appearance: old }).appearance.backgroundCrop, null)
  const crop = { cx: 0.3, cy: 0.7, zoom: 2 }
  assert.deepEqual(savedClient({ ...client, appearance: { ...old, backgroundCrop: crop } }).appearance.backgroundCrop, crop)
  for (const value of [true, { ...crop, cx: NaN }, { ...crop, cy: 2 }, { ...crop, zoom: 0 }, { ...crop, zoom: 9 }, { ...crop, zoom: '2' }]) assert.throws(() => backgroundCrop(value), /选区/)
})
test('本机主题兼容旧外观并只接受原主题目录和三种明暗模式', () => {
  const client = defaultClient()
  const { theme: _theme, themeMode: _mode, ...old } = client.appearance
  const loaded = savedAppearance(old)
  assert.equal(loaded.theme, 'deepseek'); assert.equal(loaded.themeMode, 'system')
  for (const theme of Object.keys(allThemes())) for (const themeMode of ['system', 'light', 'dark']) {
    const next = savedClient({ ...client, appearance: { ...old, theme, themeMode } })
    assert.equal(next.appearance.theme, theme); assert.equal(next.appearance.themeMode, themeMode)
    assert.deepEqual(next.servers, client.servers)
  }
  for (const theme of ['unknown', '__proto__', 'url(https://example/theme.css)', true, {}]) assert.throws(() => savedAppearance({ ...old, theme }), /主题/)
  for (const themeMode of ['auto', 'server', true, 1]) assert.throws(() => savedAppearance({ ...old, themeMode }), /明暗/)
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
