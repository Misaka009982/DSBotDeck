// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { SavedServer } from '../src/shared/domain.ts'
import { assertServerIdentity, makePeer, newIdentity, pairingOffer } from '../src/main/link-factory.ts'
import { pairingUri } from '@dsbot/link'
const config = (): SavedServer => {
  const host = newIdentity()
  return { id: 'server-a', alias: '测试服务器', relayUrl: 'wss://relay.example/v1/link', hostDeviceId: host.deviceId, hostKey: host.publicKey, mode: 'phone', identity: newIdentity(), paired: true, autoConnect: false, unfollowed: [] }
}
test('私钥、公钥、设备 id 与令牌完整才创建链路对象，不发起网络', () => {
  const server = config(); assert.doesNotThrow(() => assertServerIdentity(server))
  assert.equal(typeof makePeer(server).connect, 'function')
  server.identity.privateKey = newIdentity().privateKey
  assert.throws(() => makePeer(server), /停止自动连接|不匹配/)
})
test('已损坏的原身份不能生成替代身份', () => {
  const server = config(); const before = { ...server.identity }
  server.identity.publicKey = 'fictional-invalid-key'
  assert.throws(() => assertServerIdentity(server), /没有生成替代/)
  assert.equal(server.identity.privateKey, before.privateKey)
})
test('配对沿用上游 URI 与主机公钥绑定，浏览器身份不冒充手机', () => {
  const server = config()
  const uri = pairingUri({ server: server.relayUrl, hostDeviceId: server.hostDeviceId, hostKey: server.hostKey, code: 'fictional-one-use-code', name: '测试服务器', device: 'browser' })
  assert.equal(pairingOffer(uri).device, 'browser')
  assert.throws(() => pairingOffer(uri.replace(encodeURIComponent(server.hostKey), 'fictional-invalid-key')))
})
