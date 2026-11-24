// SPDX-License-Identifier: Apache-2.0
// 使用虚构 feed 与可控时钟，只定义刷新与清理契约，不运行应用。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { TOOL_REFRESH_DELAY_MS, watchToolSteps } from '../src/shared/tool-refresh.ts'
import type { ToolFeed, ToolRefreshSchedule } from '../src/shared/tool-refresh.ts'
class FixtureFeed implements ToolFeed {
  readonly listeners = new Set<(event: string, data: unknown) => void>()
  on(listener: (event: string, data: unknown) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  emit(event: string, data: unknown = {}): void { for (const listener of this.listeners) listener(event, data) }
}
class FixtureClock {
  readonly tasks = new Set<() => void>()
  readonly delays: number[] = []
  readonly schedule: ToolRefreshSchedule = (callback, delay) => { this.tasks.add(callback); this.delays.push(delay); return () => { this.tasks.delete(callback) } }
  flush(): void { const tasks = [...this.tasks]; this.tasks.clear(); for (const task of tasks) task() }
}
const scope = { botId: 'bot-a', sessionId: 'part-a' }
test('密集工具变化合并为一秒一次，完成后仍能再次刷新', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock(); let reads = 0
  const close = watchToolSteps(feed, scope, () => { reads += 1 }, () => true, clock.schedule)
  feed.emit('live'); feed.emit('live'); feed.emit('revision')
  assert.equal(clock.tasks.size, 1); assert.deepEqual(clock.delays, [TOOL_REFRESH_DELAY_MS]); assert.equal(TOOL_REFRESH_DELAY_MS, 1000)
  clock.flush(); assert.equal(reads, 1)
  feed.emit('notice', { botId: 'bot-a', kind: 'done' }); clock.flush(); assert.equal(reads, 2)
  close()
})
test('另一 Bot、群任务与旧聊天段的消息不触发私聊读取', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock(); let reads = 0
  const close = watchToolSteps(feed, scope, () => { reads += 1 }, () => true, clock.schedule)
  feed.emit('notice', { botId: 'bot-b' })
  feed.emit('notice', { botId: 'bot-a', roomId: 'room-a' })
  feed.emit('message', { botId: 'bot-a', sessionId: 'old-part', item: { kind: 'bot' } })
  feed.emit('message', { botId: 'bot-a', sessionId: 'part-a', item: { kind: 'user' } })
  clock.flush(); assert.equal(reads, 0)
  feed.emit('message', { botId: 'bot-a', sessionId: 'part-a', item: { kind: 'bot' } }); clock.flush(); assert.equal(reads, 1)
  close()
})
test('群聊只跟随自身 notice，原 room 推送不重复追加读取', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock(); let reads = 0
  const close = watchToolSteps(feed, { roomId: 'room-a', sessionId: 'room-part' }, () => { reads += 1 }, () => true, clock.schedule)
  feed.emit('notice', { roomId: 'room-b' }); feed.emit('room', { roomId: 'room-a' }); clock.flush(); assert.equal(reads, 0)
  feed.emit('notice', { roomId: 'room-a', botId: 'member-a' }); clock.flush(); assert.equal(reads, 1)
  close()
})
test('隐藏、缓存或原读取上下文失效后，不执行已排队的刷新', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock(); let reads = 0; let available = true
  const close = watchToolSteps(feed, scope, () => { reads += 1 }, () => available, clock.schedule)
  feed.emit('live'); available = false; clock.flush(); assert.equal(reads, 0)
  feed.emit('revision'); assert.equal(clock.tasks.size, 0)
  available = true; feed.emit('live'); clock.flush(); assert.equal(reads, 1)
  close()
})
test('hello 或 lost 清除排队刷新，不与原恢复读取重复', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock(); let reads = 0
  const close = watchToolSteps(feed, scope, () => { reads += 1 }, () => true, clock.schedule)
  for (const event of ['hello', 'lost']) { feed.emit('live'); feed.emit(event); assert.equal(clock.tasks.size, 0); clock.flush() }
  assert.equal(reads, 0); close()
})
test('卸载释放订阅与定时器，目标对象被外部修改也不改原绑定', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock(); let reads = 0
  const target = { ...scope }
  const close = watchToolSteps(feed, target, () => { reads += 1 }, () => true, clock.schedule)
  target.botId = 'bot-b'
  feed.emit('notice', { botId: 'bot-b' }); assert.equal(clock.tasks.size, 0)
  feed.emit('notice', { botId: 'bot-a' }); assert.equal(clock.tasks.size, 1)
  const late = [...clock.tasks][0]
  close(); assert.equal(feed.listeners.size, 0); assert.equal(clock.tasks.size, 0)
  late?.(); assert.equal(reads, 0)
})
test('没有可读目标不请求任何工具步骤', () => {
  const feed = new FixtureFeed(); const clock = new FixtureClock()
  const close = watchToolSteps(feed, {}, () => { throw new Error('不应读取') }, () => true, clock.schedule)
  feed.emit('live'); feed.emit('revision'); feed.emit('notice', { botId: 'bot-a' }); assert.equal(clock.tasks.size, 0)
  close()
})
