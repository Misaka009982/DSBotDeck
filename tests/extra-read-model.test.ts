// SPDX-License-Identifier: Apache-2.0
// 增补回退和有界读取先定义失败路径；本机不运行回归。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DetailReadQueue, readExtraPage, resetExtraReads } from '../src/shared/extra-read-model.ts'
import { remoteReadMode } from '../src/shared/remote-capabilities.ts'
import { DeckError } from '../src/shared/validation.ts'

test('模块声明和设备完整消息授权分开，旧版或未知版本不借名称开关升级', () => {
  assert.deepEqual(remoteReadMode({}), { state: 'legacy', fullMessages: false })
  assert.deepEqual(remoteReadMode({ extras: { fullMessages: true } }), { state: 'legacy', fullMessages: false })
  assert.deepEqual(remoteReadMode({ extras: { schema: 1, fullMessages: true } }), { state: 'ready', fullMessages: true })
  assert.deepEqual(remoteReadMode({ extras: { schema: 1, fullMessages: false } }), { state: 'ready', fullMessages: false })
  assert.deepEqual(remoteReadMode({ extras: { schema: 2, fullMessages: true } }), { state: 'incompatible', fullMessages: false })
})
test('原版声明下直接走旧读取，不先发送会被浏览器白名单拒绝的增补探测', async () => {
  let extra = 0; let legacy = 0
  const call = async () => { extra += 1; throw new DeckError('bot/refused', '浏览器不允许未知端点') }
  const fallback = async () => { legacy += 1; return { items: [] } }
  await readExtraPage(call, 'extra-messages', {}, fallback, 'legacy')
  assert.equal(extra, 0); assert.equal(legacy, 1)
  await assert.rejects(readExtraPage(call, 'extra-messages', {}, fallback, 'incompatible'), /不兼容/)
  assert.equal(extra, 0); assert.equal(legacy, 1)
})

test('增强聊天保留原调用字段，不调用旧端点或修改请求', async () => {
  const payload = { botId: 'bot-a', cursor: { beforeSeq: 8 }, fullMessages: false }; const before = structuredClone(payload)
  const calls: unknown[] = []
  const call = async (endpoint: string, value: unknown) => { calls.push({ endpoint, value }); return { items: [], cursor: null } }
  const result = await readExtraPage(call, 'extra-messages', payload, () => { throw new Error('不能回退') })
  assert.deepEqual(result, { items: [], cursor: null }); assert.deepEqual(payload, before)
  assert.deepEqual(calls, [{ endpoint: 'extra-messages', value: payload }])
})
test('仅明确缺失当前增补端点才回退，缺失探测在本次连接内复用', async () => {
  for (const message of ['Unknown endpoint: extra-messages', 'Unknown endpoint extra-messages']) {
    let reads = 0; let legacy = 0
    const call = async () => { reads += 1; throw new DeckError('bot/not-found', message) }
    const fallback = async () => { legacy += 1; return { items: [] } }
    await readExtraPage(call, 'extra-messages', {}, fallback); await readExtraPage(call, 'extra-messages', {}, fallback)
    assert.equal(reads, 1); assert.equal(legacy, 2)
    resetExtraReads(call); await readExtraPage(call, 'extra-messages', {}, fallback)
    assert.equal(reads, 2)
  }
})
test('拒绝、锁定、网络、无代码、其他缺失和损坏回包不能降级或吞错', async () => {
  for (const error of [new DeckError('bot/refused', 'extra-messages'), new DeckError('bot/unavailable', 'extra-messages'), new DeckError('RPC_ABORTED', 'extra-messages'), new DeckError('RPC_TIMEOUT', 'extra-messages'), new DeckError('bot/not-found', 'Unknown Bot'), new DeckError('bot/not-found', 'extra-messages session not found'), new DeckError('bot/not-found', 'Unknown endpoint extra-messages-other'), new DeckError('bot/not-found', 'Unknown endpoint extra-task-read'), new Error('extra-messages')]) {
    let fallback = false
    await assert.rejects(readExtraPage(async () => { throw error }, 'extra-messages', {}, async () => { fallback = true; return { items: [] } }))
    assert.equal(fallback, false)
  }
  await assert.rejects(readExtraPage(async () => ({}), 'extra-messages', {}, async () => ({ items: [] })), /格式/)
})
test('请求完整消息时不能借缺接口回退取得未经授权正文', async () => {
  for (const message of ['Unknown endpoint: extra-messages', 'Unknown endpoint extra-messages']) {
    let fallback = false
    await assert.rejects(readExtraPage(async () => { throw new DeckError('bot/not-found', message) }, 'extra-messages', { fullMessages: true }, async () => { fallback = true; return { items: [] } }))
    assert.equal(fallback, false)
  }
})
test('连接标记变化后旧缺失回包不能触发新连接的兼容读取', async () => {
  let fail = (_error: Error): void => { throw new Error('未开始') }; let legacy = 0
  const call = () => new Promise<unknown>((_resolve, reject) => { fail = reject })
  const pending = readExtraPage(call, 'extra-messages', {}, async () => { legacy += 1; return { items: [] } })
  resetExtraReads(call); fail(new DeckError('bot/not-found', 'Unknown endpoint: extra-messages'))
  await assert.rejects(pending, /失效/); assert.equal(legacy, 0)
})
test('聊天分页把取消信号传入原请求，取消后迟到正文不再可用', async () => {
  const controller = new AbortController()
  let received: AbortSignal | undefined
  let complete = (_value: unknown): void => { throw new Error('读取尚未开始') }
  const call = (_endpoint: string, _payload: Record<string, unknown>, signal?: AbortSignal) => {
    received = signal
    return new Promise<unknown>(resolve => { complete = resolve })
  }
  const reading = readExtraPage(call, 'extra-messages', { botId: 'bot-a' }, async () => { throw new Error('不应回退') }, 'ready', controller.signal)
  assert.equal(received, controller.signal)
  controller.abort(); complete({ items: [{ kind: 'bot', text: '迟到正文' }] })
  await assert.rejects(reading, { code: 'RPC_ABORTED' })
  let called = false
  await assert.rejects(readExtraPage(async () => { called = true; return { items: [] } }, 'extra-messages', {}, async () => { called = true; return { items: [] } }, 'legacy', controller.signal), { code: 'RPC_ABORTED' })
  assert.equal(called, false)
})
test('工具详情队列最多三条并行，按顺序释放且取消排队项不发请求', async () => {
  const queue = new DetailReadQueue()
  const release: (() => void)[] = []; const started: number[] = []
  const jobs = Array.from({ length: 5 }, (_, index) => {
    const controller = new AbortController()
    const result = queue.read(() => new Promise<number>(resolve => { started.push(index); release.push(() => resolve(index)) }), controller.signal)
    return { controller, result }
  })
  assert.deepEqual(started, [0, 1, 2])
  jobs[3].controller.abort()
  await assert.rejects(jobs[3].result, /取消/)
  release[0](); assert.equal(await jobs[0].result, 0)
  assert.deepEqual(started, [0, 1, 2, 4])
  release[1](); release[2](); release[3]()
  assert.deepEqual(await Promise.all([jobs[1].result, jobs[2].result, jobs[4].result]), [1, 2, 4])
})
test('详情积压有128项上限，达到预算不会再调用网络请求', async () => {
  const queue = new DetailReadQueue(1); const controllers: AbortController[] = []; const results: Promise<unknown>[] = []
  let release = (_value: number): void => { throw new Error('未开始') }
  const active = queue.read(() => new Promise<number>(resolve => { release = resolve }), new AbortController().signal)
  for (let index = 0; index < 128; index++) {
    const controller = new AbortController(); controllers.push(controller)
    const result = queue.read(async () => index, controller.signal)
    results.push(result); void result.catch(() => {})
  }
  await assert.rejects(queue.read(async () => { throw new Error('不能发送') }, new AbortController().signal), /上限/)
  for (const controller of controllers) controller.abort()
  release(1); assert.equal(await active, 1)
  await Promise.allSettled(results)
})
test('排队时目标隐藏或读取失败也释放槽位，不接受取消后的迟到结果', async () => {
  const queue = new DetailReadQueue(1)
  let finish = (_value: number): void => { throw new Error('未开始') }
  const controller = new AbortController()
  const first = queue.read(() => new Promise<number>(resolve => { finish = resolve }), controller.signal)
  let available = true; let invoked = false
  const waiting = queue.read(async () => { invoked = true; return 2 }, new AbortController().signal, () => available)
  available = false; controller.abort(); finish(1)
  await assert.rejects(first, /取消/); await assert.rejects(waiting, /取消|失效/); assert.equal(invoked, false)
  await assert.rejects(queue.read(async () => { throw new Error('虚构失败') }, new AbortController().signal), /虚构失败/)
  assert.equal(await queue.read(async () => 3, new AbortController().signal), 3)
})
