// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Peer } from '../src/main/link-factory.ts'
import type { ConnectionToken } from '../src/main/server-connection.ts'
import type { RequestConnection } from '../src/main/request-gate.ts'
import { RequestGate } from '../src/main/request-gate.ts'
import { endpointPolicy } from '../src/shared/endpoint-policy.ts'
class BoundFixture implements RequestConnection {
  epoch = 1
  sent: unknown[] = []
  readonly peer = {} as Peer
  mode: 'phone' | 'browser' = 'phone'
  view() { return { alias: '测试目标', mode: this.mode } }
  token() { return { generation: this.epoch, peer: this.peer } }
  valid(token: ConnectionToken) { return token.generation === this.epoch && token.peer === this.peer }
  async call(endpoint: string, payload: unknown) { this.sent.push({ endpoint, payload }); return 'fixture-result' }
}
test('敏感端点每次验证，不缓存 Verified', async () => {
  const connection = new BoundFixture(); let verifications = 0
  const gate = new RequestGate({ verify: async () => { verifications += 1; return true } })
  await gate.execute(connection, 'provider-key', { value: 'fictional-a' }, { active: () => true })
  await gate.execute(connection, 'provider-key', { value: 'fictional-b' }, { active: () => true })
  assert.equal(verifications, 2); assert.equal(connection.sent.length, 2)
})
test('取消、不可用或原界面切换都不发送', async () => {
  const connection = new BoundFixture()
  await assert.rejects(new RequestGate({ verify: async () => false }).execute(connection, 'provider-key', {}, { active: () => true }))
  let active = true
  await assert.rejects(new RequestGate({ verify: async () => { active = false; return true } }).execute(connection, 'provider-key', {}, { active: () => active }))
  assert.equal(connection.sent.length, 0)
})
test('验证期间连接代次变化不发送，原 payload 已冻结', async () => {
  const connection = new BoundFixture(); const payload = { value: 'fictional-original' }
  const gate = new RequestGate({ verify: async () => { payload.value = 'fictional-changed'; return true } })
  await gate.execute(connection, 'provider-key', payload, { active: () => true })
  assert.deepEqual(connection.sent[0], { endpoint: 'provider-key', payload: { value: 'fictional-original' } })
  await assert.rejects(new RequestGate({ verify: async () => { connection.epoch += 1; return true } }).execute(connection, 'provider-key', {}, { active: () => true }))
  assert.equal(connection.sent.length, 1)
})
test('浏览器配对不能借系统验证提权，本机专属端点不进入链路', async () => {
  const connection = new BoundFixture(); let verified = 0
  const gate = new RequestGate({ verify: async () => { verified += 1; return true } })
  connection.mode = 'browser'
  await assert.rejects(gate.execute(connection, 'provider-key', {}, { active: () => true }))
  connection.mode = 'phone'
  await assert.rejects(gate.execute(connection, 'phone-remove', {}, { active: () => true }))
  await assert.rejects(gate.execute(connection, 'mcp-create-token', {}, { active: () => true }))
  assert.equal(verified, 0); assert.equal(connection.sent.length, 0)
  assert.equal(endpointPolicy('unknown-future-operation', 'phone'), 'unlock')
})
test('切走再切回也不能复用原导航代次的验证', async () => {
  const connection = new BoundFixture(); let epoch = 1
  const opening = epoch
  const context = { active: () => epoch === opening }
  const gate = new RequestGate({ verify: async () => { epoch += 1; epoch += 1; return true } })
  await assert.rejects(gate.execute(connection, 'provider-key', {}, context))
  assert.equal(connection.sent.length, 0)
})
test('电脑与浏览器接管在两种配对模式均拒绝，不弹系统验证或发送请求', async () => {
  const endpoints = [
    'computer-takeover', 'computer-handback', 'computer-stop', 'computer-set-enabled', 'computer-set-level',
    'computer-revoke-app', 'computer-provider-retry', 'computer-system-status', 'computer-permission',
    'computer-allow-foreground', 'computer-app-answer', 'computer-hold-answer', 'computer-user-active',
    'browser-frame', 'browser-takeover', 'browser-give-back', 'browser-stop',
    'computer-future-control', 'browser-future-control',
  ]
  for (const mode of ['phone', 'browser'] as const) {
    const connection = new BoundFixture(); connection.mode = mode; let verifications = 0
    const gate = new RequestGate({ verify: async () => { verifications += 1; return true } })
    for (const endpoint of endpoints) {
      assert.equal(endpointPolicy(endpoint, mode), 'denied')
      await assert.rejects(gate.execute(connection, endpoint, {}, { active: () => true }), /不提供远程电脑控制或浏览器接管/)
    }
    assert.equal(verifications, 0); assert.equal(connection.sent.length, 0)
  }
})
test('聊天、Bot 设置与已有截图附件保留，敏感设置仍逐次验证', async () => {
  const connection = new BoundFixture(); let verifications = 0
  const gate = new RequestGate({ verify: async () => { verifications += 1; return true } })
  for (const endpoint of ['chat', 'room-chat', 'models', 'providers', 'memory-view', 'schedules', 'image', 'file-download', 'update-bot', 'set-prefs', 'send', 'capabilities']) assert.equal(endpointPolicy(endpoint, 'phone'), 'safe')
  for (const endpoint of ['chat', 'send', 'update-bot', 'set-prefs']) await gate.execute(connection, endpoint, {}, { active: () => true })
  assert.equal(verifications, 0)
  assert.equal(endpointPolicy('computer-shot', 'phone'), 'unlock')
  assert.equal(endpointPolicy('computer-shot', 'browser'), 'denied')
  await gate.execute(connection, 'computer-shot', { attachmentId: 'fictional-recorded-shot' }, { active: () => true })
  await gate.execute(connection, 'provider-key', { value: 'fictional-key' }, { active: () => true })
  assert.equal(verifications, 2); assert.equal(connection.sent.length, 6)
})
test('请求已取消不开始系统验证，也不发送', async () => {
  const connection = new BoundFixture(); const controller = new AbortController(); controller.abort()
  await assert.rejects(new RequestGate({ verify: async () => { throw new Error('不应开始验证') } }).execute(connection, 'provider-key', {}, { active: () => true, signal: controller.signal }))
  assert.equal(connection.sent.length, 0)
})
