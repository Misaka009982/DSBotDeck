// SPDX-License-Identifier: Apache-2.0
// 交换记录的目标与错误回归；不读取真实服务器或运行界面。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { botExchangePair, messageExchange, exchangeFailure, exchangeRows } from '../src/shared/chat-model.ts'
const directory = () => ({ 'bot-a': { id: 'bot-a', name: '相同名称' }, 'part-a': { id: 'bot-a' }, 'bot-b': { id: 'bot-b', name: '相同名称' }, 'part-b': { id: 'bot-b' } })

test('Bot交换按当前目录的稳定编号与分段别名定位，不按同名匹配', () => {
  assert.deepEqual(botExchangePair('part-a', 'part-b', directory()), ['bot-a', 'bot-b'])
  assert.deepEqual(botExchangePair('bot-a', 'bot-b', directory()), ['bot-a', 'bot-b'])
})
test('缺来源、未知目录、同一Bot和群聊编号不生成虚假交换目标', () => {
  for (const pair of [[undefined, 'bot-b'], ['bot-a', null], ['bot-a', 'missing'], ['part-a', 'bot-a'], ['room-a', 'bot-b'], ['bot-a', '相同名称']]) assert.equal(botExchangePair(pair[0], pair[1], directory()), null)
  assert.equal(botExchangePair('bot-a', 'bot-b', null), null)
})
test('继承属性与损坏的目录编号不能被当成真实Bot', () => {
  const inherited = Object.create({ 'bot-b': { id: 'bot-b' } })
  inherited['bot-a'] = { id: 'bot-a' }
  assert.equal(botExchangePair('bot-a', 'bot-b', inherited), null)
  assert.equal(botExchangePair('bot-a', 'bad', { ...directory(), bad: { id: 'https://example.invalid' } }), null)
})
test('内部协作只打开服务端验证过的原交换，旧会话归属与私密对象拒绝猜测', () => {
  const item = { kind: 'internal', sessionId: 'part-b', exchange: { schema: 1, id: 'exchange-a', from: 'bot-a', to: 'bot-b' } }
  assert.deepEqual(messageExchange(item, directory()), ['bot-a', 'bot-b'])
  assert.equal(messageExchange({ ...item, exchange: undefined }, directory()), null)
  assert.equal(messageExchange({ ...item, sessionId: 'part-a' }, directory()), null)
  assert.equal(messageExchange({ ...item, exchange: { ...item.exchange, from: 'part-a' } }, directory()), null)
  assert.equal(messageExchange(item, { ...directory(), 'bot-a': { id: 'bot-a', private: true } }), null)
})
test('权限拒绝与缓存有明确说明，不回显服务端错误正文或伪装空记录', () => {
  const denied = exchangeFailure({ code: 'bot/refused', message: 'fictional-secret' })
  assert.match(denied, /授权/); assert.equal(denied.includes('fictional-secret'), false)
  assert.match(exchangeFailure({ code: 'bot/read-only' }), /缓存/)
  assert.match(exchangeFailure({ code: 'bot/not-found' }), /不存在/)
})
test('网络与协议失败可说明重新读取，不复述敏感错误或调用栈', () => {
  assert.match(exchangeFailure({ code: 'RPC_TIMEOUT', message: 'fictional-secret', stack: 'fictional-stack' }), /重新读取/)
  assert.match(exchangeFailure({ code: 'bot/incompatible' }), /不兼容/)
  assert.equal(exchangeFailure(new Error('fictional-secret')).includes('fictional-secret'), false)
})
test('真实空交换记录与读取失败区分，保留原公开内容且不修改输入', () => {
  assert.deepEqual(exchangeRows([]), [])
  const rows = [{ id: 'row-a', from: 'bot-a', to: 'bot-b', text: '公开消息', time: 1 }]
  const original = structuredClone(rows)
  assert.deepEqual(exchangeRows(rows), original); assert.deepEqual(rows, original)
})
test('缺失或损坏的交换回包不降级成没有消息', () => {
  for (const value of [undefined, null, {}, [null], [{ text: 42 }]]) assert.throws(() => exchangeRows(value), /交换记录格式/)
})
