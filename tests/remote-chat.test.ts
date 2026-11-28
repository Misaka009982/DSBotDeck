// SPDX-License-Identifier: Apache-2.0
// 用真实分页门禁与远程 hook，替代 React 调度和网络边界，覆盖迁移后的异步归属。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { paintSource } from '../scripts/paint-source.mjs'
import { readExtraPage, extraReadFailure } from '../src/shared/extra-read-model.ts'
import { DeckError, errorCode } from '../src/shared/validation.ts'
const hookText = await readFile(new URL('../src/remote/chat-read.js', import.meta.url), 'utf8')
const upstream = await readFile(new URL('../../DS-Bot/app/ui/src/chat.js', import.meta.url), 'utf8')
const helpersText = paintSource(upstream, path.resolve('source/app/ui/src/chat.js'), path.resolve('source')) ?? ''
const helpers = runInNewContext(`${helpersText.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')}\n({ adaptRoomItems, mergeLatestPage, sameItem })`)
interface Slot { value?: any; deps?: unknown[]; cleanup?: (() => void) | void }
interface Request { endpoint: string; payload: Record<string, unknown>; signal?: AbortSignal; resolve(value: unknown): void; reject(error: Error): void }
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function fixture() {
  const slots: Slot[] = []; let cursor = 0
  let effects: (() => void)[] = []
  const cell = (initial: () => Slot) => { const at = cursor++; return slots[at] ??= initial() }
  const same = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, at) => Object.is(value, b[at]))
  const effect = (start: () => (() => void) | void, deps?: unknown[]) => {
    const value = cell(() => ({}))
    if (!same(value.deps, deps)) effects.push(() => { value.cleanup?.(); value.deps = deps; value.cleanup = start() })
  }
  const requests: Request[] = []; const listeners = new Set<(event: string, data: unknown) => void>()
  const visibility = new Set<() => void>()
  const document = { visibilityState: 'visible', body: { hasAttribute: () => false },
    addEventListener: (_event: string, listener: () => void) => visibility.add(listener),
    removeEventListener: (_event: string, listener: () => void) => visibility.delete(listener) }
  const call = (endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal) => new Promise<unknown>((resolve, reject) => requests.push({ endpoint, payload, signal, resolve, reject }))
  const feed = { on(listener: (event: string, data: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const useRemoteChat = runInNewContext(`${hookText.replace(/^import .*\r?\n/gm, '').replace('export function', 'function')}\nuseRemoteChat`, {
    ...helpers, readExtraPage, extraReadFailure, errorCode, call, AbortController,
    useRef: (initial: unknown) => cell(() => ({ value: { current: initial } })).value,
    useState: (initial: unknown) => { const value = cell(() => ({ value: initial })); return [value.value, (next: any) => { value.value = typeof next === 'function' ? next(value.value) : next }] },
    useCallback: (fn: unknown, deps: unknown[]) => { const value = cell(() => ({})); if (!same(value.deps, deps)) { value.deps = deps; value.value = fn }; return value.value },
    useEffect: effect, useLayoutEffect: effect,
    watchToolSteps: () => () => {},
    document,
  })
  const target = { botId: 'bot-a', roomId: undefined as string | undefined, sessionId: 'part-a', feed, fullMessages: true, extraReads: 'ready', cached: false, epoch: 0 }
  const render = () => {
    cursor = 0; effects = []
    const value = useRemoteChat(target)
    for (const run of effects) run()
    return value
  }
  return { target, requests, render, emit: (event: string, data: unknown) => { for (const listener of listeners) listener(event, data) },
    visible: (shown: boolean) => { document.visibilityState = shown ? 'visible' : 'hidden'; for (const listener of visibility) listener() },
    close: () => { for (const slot of slots) slot.cleanup?.(); assert.equal(listeners.size, 0); assert.equal(visibility.size, 0) } }
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
test('本地切服取消保留聊天并在返回后补读，首次未读到页面也能恢复', async t => {
  for (const loaded of [false, true]) {
    const f = fixture(); t.after(f.close); f.render()
    if (loaded) {
      f.requests[0].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 1, text: '切服前消息' }], cursor: { beforeSeq: 1 } }); await settle()
      void f.render().load(undefined, undefined, true)
    }
    const before = f.render().view.items
    f.requests.at(-1)!.reject(new DeckError('RPC_ABORTED', '原服务器界面已切换或隐藏')); await settle()
    assert.equal(f.render().view.items, before); assert.equal(f.render().view.failed, false); assert.equal(f.render().failure, null)
    const count = f.requests.length
    f.visible(false); assert.equal(f.requests.length, count)
    f.visible(true); assert.equal(f.requests.length, count + 1)
    f.requests.at(-1)!.resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 1, text: '切服前消息' }, { kind: 'bot', id: 2, text: '返回后的消息' }], cursor: null }); await settle()
    assert.equal(f.render().view.stale, false); assert.equal(f.render().view.items.at(-1).text, '返回后的消息')
    const denied = f.render().load(undefined, undefined, true)
    f.requests.at(-1)!.reject(new DeckError('bot/refused', '设备授权已撤销')); await denied
    assert.deepEqual(plain(f.render().view.items), [])
    const rejectedCount = f.requests.length
    f.visible(false); f.visible(true); assert.equal(f.requests.length, rejectedCount)
  }
})
test('新会话取消旧页请求，迟到旧正文不能覆盖当前会话', async t => {
  const f = fixture(); t.after(f.close)
  f.render(); assert.equal(f.requests.length, 1)
  const first = f.requests[0]
  f.target.sessionId = 'part-b'; f.render()
  assert.equal(first.signal?.aborted, true); assert.equal(f.requests.length, 2)
  f.requests[1].resolve({ sessionId: 'part-b', items: [{ kind: 'bot', id: 2, text: '新会话', time: 2 }], cursor: null })
  await settle()
  first.resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 1, text: '旧正文', time: 1 }], cursor: null })
  await settle()
  assert.equal(f.render().view.sessionId, 'part-b')
  assert.deepEqual(plain(f.render().view.items).map((item: { text: string }) => item.text), ['新会话'])
})
test('授权拒绝清页并阻止后续事件补回，主动重读才能恢复', async t => {
  const f = fixture(); t.after(f.close)
  f.render()
  f.requests[0].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 1, text: '已授权内容' }], cursor: null }); await settle()
  const reload = f.render().load(undefined, undefined, true)
  f.requests[1].reject(new DeckError('bot/refused', '拒绝')); await reload
  f.emit('message', { botId: 'bot-a', sessionId: 'part-a', item: { kind: 'bot', id: 2, text: '迟到事件' } })
  assert.deepEqual(plain(f.render().view.items), []); assert.equal(f.render().stream, null)
  const retry = f.render().load()
  f.requests[2].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 3, text: '重新授权内容' }], cursor: null }); await retry
  assert.equal(f.render().view.items[0].text, '重新授权内容')
})
test('补历史页后更新最新页保留旧页及视口，群成员投影仍来自上游', async t => {
  const f = fixture(); t.after(f.close); f.target.roomId = 'room-a'
  f.render()
  f.requests[0].resolve({ items: [{ kind: 'bot', id: 'new', botId: 'member', text: '旧结果', time: 2 }], cursor: { part: 0, beforeSeq: 2 } }); await settle()
  const scroller = { scrollHeight: 500, scrollTop: 100 }
  const earlier = f.render().load({ part: 0, beforeSeq: 2 }, scroller)
  f.requests[1].resolve({ items: [{ kind: 'user', id: 'old', text: '历史', time: 1 }], cursor: { part: 0, beforeSeq: 1 } }); await earlier
  assert.equal(f.render().keep.current, 400)
  const update = f.render().load(undefined, undefined, true)
  f.requests[2].resolve({ items: [{ kind: 'bot', id: 'new', botId: 'member', text: '新结果', time: 2 }], cursor: { part: 0, beforeSeq: 2 } }); await update
  const view = f.render().view
  assert.deepEqual(plain(view.items).map((item: { text: string }) => item.text), ['历史', '新结果'])
  assert.equal(view.items[1].kind, 'post'); assert.equal(view.items[1].botId, 'member')
  assert.deepEqual(plain(view.cursor), { part: 0, beforeSeq: 1 })
})
test('缓存停止读取并取消旧页，重新连接只加载新代次', async t => {
  const f = fixture(); t.after(f.close); f.render()
  f.target.cached = true; f.render()
  assert.equal(f.requests[0].signal?.aborted, true)
  f.requests[0].resolve({ items: [{ kind: 'bot', text: '断线旧页' }] }); await settle()
  assert.deepEqual(plain(f.render().view.items), [])
  f.target.cached = false; f.target.epoch++; f.render()
  assert.equal(f.requests.length, 2)
  f.requests[1].resolve({ items: [], cursor: null }); await settle()
  assert.equal(f.render().view.failed, false)
})
test('已加载的消息和历史页在断线后保留，重连合并新页且不重发待确认消息', async t => {
  const f = fixture(); t.after(f.close); f.render()
  const latest = { kind: 'bot', id: 2, text: '已读回复', time: 2 }
  const firstCursor = { part: 0, beforeSeq: 2 }; const olderCursor = { part: 0, beforeSeq: 1 }
  f.requests[0].resolve({ sessionId: 'part-a', items: [latest], cursor: firstCursor }); await settle()
  const earlier = f.render().load(firstCursor, { scrollHeight: 500, scrollTop: 100 })
  f.requests[1].resolve({ items: [{ kind: 'user', id: 1, text: '更早的历史', time: 1 }], cursor: olderCursor }); await earlier
  const cachedItems = f.render().view.items
  let sent = 0; let finishSend = (): void => {}
  const sending = f.render().send('待确认消息', { noteSent: () => {}, send: () => { sent++; return new Promise<void>(resolve => { finishSend = resolve }) } })
  const sentAt = f.render().pending[0].time
  f.emit('stream', { botId: 'bot-a', sessionId: 'part-a', phase: 'start', attemptId: 'attempt-a' })
  f.emit('stream', { botId: 'bot-a', sessionId: 'part-a', attemptId: 'attempt-a', text: '尚未接收完整的回复' })
  const oldRead = f.render().load(undefined, undefined, true)
  f.target.cached = true; f.target.epoch++; f.render()
  assert.equal(f.requests[2].signal?.aborted, true)
  const offline = f.render()
  assert.equal(offline.view.items, cachedItems); assert.equal(offline.view.sessionId, 'part-a')
  assert.deepEqual(plain(offline.view.cursor), olderCursor)
  assert.equal(offline.view.loading, false); assert.equal(offline.view.stale, true)
  assert.equal(offline.stream.text, '尚未接收完整的回复'); assert.equal(offline.stream.paused, true)
  assert.equal(offline.pending.length, 1); assert.equal(offline.keep.current, 400)
  await offline.load(); assert.equal(f.requests.length, 3)
  f.requests[2].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 99, text: '迟到旧回包', time: 99 }], cursor: null }); await oldRead
  f.emit('message', { botId: 'bot-a', sessionId: 'part-a', item: { kind: 'bot', id: 98, text: '迟到事件', time: 98 } })
  assert.equal(f.render().view.items, cachedItems)
  finishSend(); await sending
  f.target.cached = false; f.render()
  assert.equal(f.render().view.items, cachedItems); assert.equal(f.requests.length, 4)
  f.requests[3].resolve({ sessionId: 'part-a', items: [latest, { kind: 'user', id: 3, text: '待确认消息', time: sentAt }, { kind: 'bot', id: 4, text: '恢复后的完整回复', time: sentAt + 1 }], cursor: firstCursor }); await settle()
  const resumed = f.render()
  assert.deepEqual(plain(resumed.view.items).map((item: { id: number }) => item.id), [1, 2, 3, 4])
  assert.deepEqual(plain(resumed.view.cursor), olderCursor)
  assert.equal(resumed.view.stale, false); assert.equal(resumed.stream, null)
  assert.equal(resumed.pending.length, 0); assert.equal(sent, 1)
})
test('重连读取失败保留旧页，手动重试仍合并历史，明确拒绝后清空', async t => {
  const f = fixture(); t.after(f.close); f.render()
  const latest = { kind: 'bot', id: 2, text: '原已读内容', time: 2 }
  const firstCursor = { part: 0, beforeSeq: 2 }; const olderCursor = { part: 0, beforeSeq: 1 }
  f.requests[0].resolve({ sessionId: 'part-a', items: [latest], cursor: firstCursor }); await settle()
  const earlier = f.render().load(firstCursor)
  f.requests[1].resolve({ items: [{ kind: 'user', id: 1, text: '更早的记录', time: 1 }], cursor: olderCursor }); await earlier
  const items = f.render().view.items
  f.target.cached = true; f.render()
  f.target.cached = false; f.target.epoch++; f.render()
  f.requests[2].reject(new DeckError('RPC_TIMEOUT', '虚构超时')); await settle()
  assert.equal(f.render().view.items, items); assert.equal(f.render().view.failed, true); assert.equal(f.render().view.stale, true)
  const retry = f.render().load()
  f.requests[3].resolve({ sessionId: 'part-a', items: [latest, { kind: 'bot', id: 3, text: '恢复后的内容', time: 3 }], cursor: firstCursor }); await retry
  assert.deepEqual(plain(f.render().view.items).map((item: { id: number }) => item.id), [1, 2, 3])
  assert.deepEqual(plain(f.render().view.cursor), olderCursor); assert.equal(f.render().view.stale, false)
  const denied = f.render().load()
  f.requests[4].reject(new DeckError('bot/refused', '授权已撤销')); await denied
  assert.deepEqual(plain(f.render().view.items), []); assert.equal(f.render().view.sessionId, null); assert.equal(f.render().view.cursor, null)
  f.emit('message', { botId: 'bot-a', sessionId: 'part-a', item: { kind: 'bot', id: 4, text: '拒绝后的事件', time: 4 } })
  assert.deepEqual(plain(f.render().view.items), [])
})
test('更早历史页读取失败及重试不把已确认的最新消息永久标成缓存', async t => {
  const f = fixture(); t.after(f.close); f.render()
  const cursor = { part: 0, beforeSeq: 2 }
  f.requests[0].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 2, text: '最新消息', time: 2 }], cursor }); await settle()
  const older = f.render().load(cursor)
  f.requests[1].reject(new DeckError('RPC_TIMEOUT', '历史页超时')); await older
  assert.equal(f.render().view.items.length, 1); assert.equal(f.render().view.stale, false)
  const retry = f.render().load(cursor)
  f.requests[2].resolve({ items: [{ kind: 'user', id: 1, text: '历史消息', time: 1 }], cursor: null }); await retry
  assert.equal(f.render().view.stale, false); assert.equal(f.render().view.failed, false)
  assert.deepEqual(plain(f.render().view.items).map((item: { id: number }) => item.id), [1, 2])
})
test('离线切换目标或完整消息授权变化时不能继续显示上一范围的缓存', async t => {
  for (const change of ['session', 'permission']) {
    const f = fixture(); t.after(f.close); f.render()
    f.requests[0].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 1, text: '原范围正文', time: 1 }], cursor: null }); await settle()
    f.target.cached = true; f.render(); assert.equal(f.render().view.items.length, 1)
    if (change === 'session') f.target.sessionId = 'part-b'
    else f.target.fullMessages = false
    f.render()
    assert.deepEqual(plain(f.render().view.items), []); assert.equal(f.render().view.sessionId, null)
    assert.equal(f.requests.length, 1)
  }
})
test('快速断开重连只变更连接代次时也保留旧页，服务器空页成功后才清空', async t => {
  const f = fixture(); t.after(f.close); f.render()
  f.requests[0].resolve({ sessionId: 'part-a', items: [{ kind: 'bot', id: 1, text: '原已读内容', time: 1 }], cursor: null }); await settle()
  f.target.epoch++; f.render()
  assert.equal(f.render().view.items.length, 1); assert.equal(f.render().view.stale, true)
  f.requests[1].resolve({ sessionId: 'part-a', items: [], cursor: null }); await settle()
  assert.deepEqual(plain(f.render().view.items), []); assert.equal(f.render().view.stale, false)
})
