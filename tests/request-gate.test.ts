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
  learningGrant: boolean | undefined
  learningApproval() { return this.learningGrant ?? this.mode === 'phone' }
  view() { return { alias: '测试目标', mode: this.mode } }
  token() { return { generation: this.epoch, peer: this.peer } }
  valid(token: ConnectionToken) { return token.generation === this.epoch && token.peer === this.peer }
  async call(endpoint: string, payload: unknown): Promise<unknown> { this.sent.push({ endpoint, payload }); return 'fixture-result' }
}
test('已确认增补只读端点保留浏览器边界和活动目标，不放行未知前缀', async () => {
  const endpoints = ['extra-status', 'extra-attachment-status', 'extra-messages', 'extra-task-read', 'extra-tool-list', 'extra-tool-detail', 'extra-todos',
    'extra-delegation-list', 'extra-delegation-read', 'extra-tool-change', 'extra-workspace-open', 'extra-workspace-list', 'extra-workspace-read',
    'extra-workspace-save-status', 'extra-workspace-change', 'extra-terminal-list', 'extra-terminal-read']
  for (const mode of ['phone', 'browser'] as const) {
    const connection = new BoundFixture(); connection.mode = mode
    const gate = new RequestGate({ verify: async () => { throw new Error('只读增补不增加Windows Hello') } })
    for (const endpoint of endpoints) {
      assert.equal(endpointPolicy(endpoint, mode), 'safe')
      await gate.execute(connection, endpoint, { fullMessages: false }, { active: () => true })
      await assert.rejects(gate.execute(connection, endpoint, {}, { active: () => false }), /切换或隐藏/)
    }
    assert.equal(connection.sent.length, endpoints.length)
  }
  assert.equal(endpointPolicy('extra-unknown', 'browser'), 'denied')
  for (const mode of ['phone', 'browser'] as const) {
    const connection = new BoundFixture(); connection.mode = mode
    for (const endpoint of ['extra-unknown', 'extra-goal-unknown', 'extra-workspace-delete', 'extra-workspace-force-save', 'extra-terminal-exec', 'extra-terminal-takeover']) {
      assert.equal(endpointPolicy(endpoint, mode), 'denied')
      await assert.rejects(new RequestGate().execute(connection, endpoint, {}, { active: () => true }))
    }
    assert.equal(connection.sent.length, 0)
  }
})
test('增补写入只走固定端点与原上下文，发送后切换或取消表示未知结果且不重发', async () => {
  for (const endpoint of ['extra-attachment-open', 'extra-attachment-chunk', 'extra-attachment-send', 'extra-attachment-discard', 'extra-terminal-create', 'extra-terminal-input', 'extra-terminal-resize', 'extra-terminal-close', 'extra-workspace-save', 'extra-goal-control']) {
    for (const mode of ['phone', 'browser'] as const) {
      const connection = new BoundFixture(); connection.mode = mode
      const gate = new RequestGate({ verify: async () => { throw new Error('资源写入沿用服务器设备授权') } })
      await assert.rejects(gate.execute(connection, endpoint, {}, { active: () => false }), { code: 'bot/refused' })
      assert.equal(connection.sent.length, 0)
      let active = true
      connection.call = async (name, payload) => { connection.sent.push({ endpoint: name, payload }); active = false; return 'accepted' }
      await assert.rejects(gate.execute(connection, endpoint, { requestId: 'once' }, { active: () => active }), { code: 'bot/outcome-unknown' })
      assert.equal(connection.sent.length, 1)
      const controller = new AbortController()
      connection.call = async (name, payload) => { connection.sent.push({ endpoint: name, payload }); controller.abort(); return 'accepted' }
      await assert.rejects(gate.execute(connection, endpoint, {}, { active: () => true, signal: controller.signal }), { code: 'bot/outcome-unknown' })
      assert.equal(connection.sent.length, 2)
    }
  }
})
test('增补正文已发出后切服再切回或取消，迟到正文也不能交付', async () => {
  const connection = new BoundFixture(); let epoch = 1
  const opening = epoch
  connection.call = async (endpoint, payload) => { connection.sent.push({ endpoint, payload }); epoch += 2; return 'fictional-body' }
  await assert.rejects(new RequestGate().execute(connection, 'extra-tool-detail', { sessionId: 'part-a', callId: 'call-a', field: 'output' }, { active: () => epoch === opening }), /切换或隐藏/)
  assert.equal(connection.sent.length, 1)
  for (const endpoint of ['extra-delegation-list', 'extra-delegation-read', 'extra-tool-change', 'extra-workspace-open', 'extra-workspace-list', 'extra-workspace-read']) {
    const opening = epoch
    await assert.rejects(new RequestGate().execute(connection, endpoint, {}, { active: () => epoch === opening }), /切换或隐藏/)
  }
  const controller = new AbortController()
  connection.call = async () => { controller.abort(); return 'fictional-body' }
  await assert.rejects(new RequestGate().execute(connection, 'extra-messages', { botId: 'bot-a' }, { active: () => true, signal: controller.signal }), /取消/)
})
test('学习批准沿用手机配对权限，浏览器、隐藏和取消不能发送', async () => {
  const connection = new BoundFixture(); const gate = new RequestGate()
  assert.equal(endpointPolicy('learning-answer', 'phone'), 'unlock')
  assert.equal(endpointPolicy('learning-answer', 'browser'), 'denied')
  for (const approve of [true, false]) await gate.execute(connection, 'learning-answer', { id: 'proposal-a', approve }, { active: () => true })
  assert.deepEqual(connection.sent, [
    { endpoint: 'learning-answer', payload: { id: 'proposal-a', approve: true } },
    { endpoint: 'learning-answer', payload: { id: 'proposal-a', approve: false } },
  ])
  connection.mode = 'browser'
  await assert.rejects(gate.execute(connection, 'learning-answer', {}, { active: () => true }), /允许审批学习提案/)
  connection.mode = 'phone'
  await assert.rejects(gate.execute(connection, 'learning-answer', {}, { active: () => false }), /切换或隐藏/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(gate.execute(connection, 'learning-answer', {}, { active: () => true, signal: controller.signal }), /取消/)
  assert.equal(connection.sent.length, 2)
})
test('学习独立授权只允许对应审批，撤权后的在途回执仍标为未知而不重发', async () => {
  const connection = new BoundFixture(); connection.mode = 'browser'; connection.learningGrant = true
  const gate = new RequestGate()
  assert.equal(endpointPolicy('learning-answer', 'browser', true), 'unlock')
  assert.equal(endpointPolicy('provider-key', 'browser', true), 'denied')
  await gate.execute(connection, 'learning-answer', { id: 'p1', approve: false }, { active: () => true })
  connection.learningGrant = false
  for (const mode of ['phone', 'browser'] as const) {
    connection.mode = mode
    await assert.rejects(gate.execute(connection, 'learning-answer', { id: 'p2', approve: true }, { active: () => true }), { code: 'bot/refused' })
  }
  assert.equal(connection.sent.length, 1)
  connection.learningGrant = true
  connection.call = async (endpoint, payload) => { connection.sent.push({ endpoint, payload }); connection.learningGrant = false; return { applied: true } }
  await assert.rejects(gate.execute(connection, 'learning-answer', { id: 'p2', approve: true }, { active: () => true }), { code: 'bot/outcome-unknown' })
  assert.equal(connection.sent.length, 2)
})

test('学习审批已发送后切服、断线或取消，回执标记未知且不自动重发', async () => {
  for (const boundary of ['navigation', 'connection', 'abort']) {
    const connection = new BoundFixture(); const controller = new AbortController(); let active = true
    connection.call = async (endpoint, payload) => {
      connection.sent.push({ endpoint, payload })
      if (boundary === 'navigation') active = false
      if (boundary === 'connection') connection.epoch++
      if (boundary === 'abort') controller.abort()
      return 'accepted'
    }
    await assert.rejects(new RequestGate().execute(connection, 'learning-answer', { id: 'proposal-a', approve: true }, { active: () => active, signal: controller.signal }), { code: 'bot/outcome-unknown' })
    assert.equal(connection.sent.length, 1)
  }
})
test('默认门禁只按原配对权限发送，不依赖本机 Windows Hello', async () => {
  const connection = new BoundFixture(); const gate = new RequestGate()
  const payload = { provider: 'fixture-provider', value: 'fictional-key' }
  await gate.execute(connection, 'provider-key', payload, { active: () => true })
  assert.deepEqual(connection.sent, [{ endpoint: 'provider-key', payload }])
  connection.mode = 'browser'
  await assert.rejects(gate.execute(connection, 'provider-key', payload, { active: () => true }), /浏览器权限/)
  connection.mode = 'phone'
  await assert.rejects(gate.execute(connection, 'computer-takeover', {}, { active: () => true }), /不提供远程电脑控制/)
  await assert.rejects(gate.execute(connection, 'phone-remove', {}, { active: () => true }), /必须在服务器本机/)
  assert.equal(connection.sent.length, 1)
})
test('取消额外本机验证后，缓存、取消和失效界面仍不发送', async () => {
  const connection = new BoundFixture(); const gate = new RequestGate()
  await assert.rejects(gate.execute(connection, 'provider-key', {}, { active: () => false }), /切换或隐藏/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(gate.execute(connection, 'provider-key', {}, { active: () => true, signal: controller.signal }), /请求已取消/)
  connection.valid = () => false
  await assert.rejects(gate.execute(connection, 'provider-key', {}, { active: () => true }), /当前为缓存/)
  assert.equal(connection.sent.length, 0)
})
test('显式启用的验证器每次验证，不缓存 Verified', async () => {
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
  assert.equal(endpointPolicy('unknown-future-operation', 'phone'), 'denied')
  for (const mode of ['phone', 'browser'] as const) {
    for (const endpoint of ['session-page', 'session-control', 'workspace-read', 'terminal-create', 'api-token', 'plugins-install', 'speech-transcribe']) assert.equal(endpointPolicy(endpoint, mode), 'denied')
  }
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
  for (const endpoint of ['chat', 'room-chat', 'models', 'providers', 'memory-view', 'schedules', 'image', 'file-download', 'update-bot', 'set-prefs', 'send']) assert.equal(endpointPolicy(endpoint, 'phone'), 'safe')
  for (const endpoint of ['chat', 'send', 'update-bot', 'set-prefs']) await gate.execute(connection, endpoint, {}, { active: () => true })
  assert.equal(verifications, 0)
  assert.equal(endpointPolicy('computer-shot', 'phone'), 'denied')
  assert.equal(endpointPolicy('computer-shot', 'browser'), 'denied')
  await assert.rejects(gate.execute(connection, 'computer-shot', { attachmentId: 'fictional-recorded-shot' }, { active: () => true }))
  await gate.execute(connection, 'provider-key', { value: 'fictional-key' }, { active: () => true })
  assert.equal(verifications, 1); assert.equal(connection.sent.length, 5)
})
test('工具权限审批沿用允许一次或拒绝，失效界面和取消不发送', async () => {
  for (const mode of ['phone', 'browser'] as const) {
    const connection = new BoundFixture(); connection.mode = mode
    const gate = new RequestGate({ verify: async () => { throw new Error('原工具审批不应改成其他权限模式') } })
    assert.equal(endpointPolicy('approval-answer', mode), 'safe')
    for (const choice of ['allow', 'reject']) await gate.execute(connection, 'approval-answer', { id: `approval-${choice}`, choice }, { active: () => true })
    assert.deepEqual(connection.sent, [
      { endpoint: 'approval-answer', payload: { id: 'approval-allow', choice: 'allow' } },
      { endpoint: 'approval-answer', payload: { id: 'approval-reject', choice: 'reject' } },
    ])
    await assert.rejects(gate.execute(connection, 'approval-answer', { id: 'approval-old', choice: 'allow' }, { active: () => false }), /切换|隐藏/)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(gate.execute(connection, 'approval-answer', { id: 'approval-aborted', choice: 'allow' }, { active: () => true, signal: controller.signal }), /取消/)
    assert.equal(connection.sent.length, 2)
  }
})
test('请求已取消不开始系统验证，也不发送', async () => {
  const connection = new BoundFixture(); const controller = new AbortController(); controller.abort()
  await assert.rejects(new RequestGate({ verify: async () => { throw new Error('不应开始验证') } }).execute(connection, 'provider-key', {}, { active: () => true, signal: controller.signal }))
  assert.equal(connection.sent.length, 0)
})
