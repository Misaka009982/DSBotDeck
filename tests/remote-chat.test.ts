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
  const call = (endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal) => new Promise<unknown>((resolve, reject) => requests.push({ endpoint, payload, signal, resolve, reject }))
  const feed = { on(listener: (event: string, data: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const useRemoteChat = runInNewContext(`${hookText.replace(/^import .*\r?\n/gm, '').replace('export function', 'function')}\nuseRemoteChat`, {
    ...helpers, readExtraPage, extraReadFailure, errorCode, call, AbortController,
    useRef: (initial: unknown) => cell(() => ({ value: { current: initial } })).value,
    useState: (initial: unknown) => { const value = cell(() => ({ value: initial })); return [value.value, (next: any) => { value.value = typeof next === 'function' ? next(value.value) : next }] },
    useCallback: (fn: unknown, deps: unknown[]) => { const value = cell(() => ({})); if (!same(value.deps, deps)) { value.deps = deps; value.value = fn }; return value.value },
    useEffect: effect, useLayoutEffect: effect,
    watchToolSteps: () => () => {},
    document: { visibilityState: 'visible', body: { hasAttribute: () => false },
      addEventListener: (_event: string, listener: () => void) => visibility.add(listener),
      removeEventListener: (_event: string, listener: () => void) => visibility.delete(listener) },
  })
  const target = { botId: 'bot-a', roomId: undefined as string | undefined, sessionId: 'part-a', feed, fullMessages: true, extraReads: 'ready', cached: false, epoch: 0 }
  const render = () => {
    cursor = 0; effects = []
    const value = useRemoteChat(target)
    for (const run of effects) run()
    return value
  }
  return { target, requests, render, emit: (event: string, data: unknown) => { for (const listener of listeners) listener(event, data) },
    close: () => { for (const slot of slots) slot.cleanup?.(); assert.equal(listeners.size, 0); assert.equal(visibility.size, 0) } }
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
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
