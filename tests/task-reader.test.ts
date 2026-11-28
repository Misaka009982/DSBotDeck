// SPDX-License-Identifier: Apache-2.0
// 直接读取构建适配后的原后台任务组件，覆盖切服和读取结算；本机不运行。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { paintSource } from '../scripts/paint-source.mjs'
import { readExtraPage, extraReadFailure } from '../src/shared/extra-read-model.ts'
import { DeckError, errorCode } from '../src/shared/validation.ts'
const raw = await readFile(new URL('../../DS-Bot/ds-bot/src/client/bot-tasks.js', import.meta.url), 'utf8')
const adapted = paintSource(raw, path.resolve('source/ds-bot/src/client/bot-tasks.js'), path.resolve('source')) ?? ''
const component = adapted.slice(adapted.indexOf('export function TaskReaderView('), adapted.indexOf('export function DetailsTaskList(')).replace('export function', 'function')
interface Slot { value?: any; deps?: unknown[]; cleanup?: (() => void) | void }
interface Node { type: any; props: Record<string, any>; children: any[] }
interface Request { resolve(value: unknown): void; reject(error: Error): void }
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function fixture() {
  const slots: Slot[] = []; let cursor = 0; let effects: (() => void)[] = []
  const cell = (initial: () => Slot) => slots[cursor++] ??= initial()
  const same = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const effect = (start: () => (() => void) | void, deps?: unknown[]) => {
    const slot = cell(() => ({}))
    if (!same(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = start() })
  }
  const context = { cached: false, epoch: 0 }; const requests: Request[] = []; const intervals = new Set<() => void>(); const listeners = new Set<() => void>()
  let paints = 0
  const call = () => new Promise<unknown>((resolve, reject) => requests.push({ resolve, reject }))
  const props = { bot: { id: 'bot-a' }, task: { id: 'task-a', status: 'completed', sessionId: 'part-a' }, fullMessages: true,
    actions: { readTask: (_botId: string, _taskId: string, cursor?: unknown) => readExtraPage(call, 'extra-task-read', { cursor }, async () => { throw new Error('不能降级') }),
      deckTaskPaint: () => { paints++ } } }
  class History { group(items: unknown[]) { return items } }
  const Reader = runInNewContext(`${component}\nTaskReaderView`, {
    errorCode, extraReadFailure, ResourceContext: {}, useContext: () => context,
    ToolHistoryModel: History, DiagnosticHistoryModel: History,
    isActiveTask: (task: { status: string }) => task.status === 'active',
    taskOriginLabel: () => '', taskStatusLabel: (status: string) => status,
    t: (text: string) => text, hostText: (text: string) => text,
    TaskResourceEntries: 'TaskResourceEntries', ChevronLeftIcon: 'ChevronLeftIcon', Fragment: 'Fragment', Elapsed: 'Elapsed',
    MarkdownText: 'MarkdownText', mdLabels: () => ({}), relativeShort: () => '',
    h: (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => {
      if (props?.ref) props.ref.current = {}
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useRef: (initial: unknown) => cell(() => ({ value: { current: initial } })).value,
    useState: (initial: unknown) => { const slot = cell(() => ({ value: initial })); return [slot.value, (value: any) => { slot.value = typeof value === 'function' ? value(slot.value) : value }] },
    useCallback: (fn: unknown, deps: unknown[]) => { const slot = cell(() => ({})); if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = fn }; return slot.value },
    useEffect: effect, useLayoutEffect: effect,
    setInterval: (fn: () => void) => { intervals.add(fn); return fn }, clearInterval: (fn: () => void) => intervals.delete(fn),
    document: { hidden: false, addEventListener: (_name: string, fn: () => void) => listeners.add(fn), removeEventListener: (_name: string, fn: () => void) => listeners.delete(fn) },
  })
  const render = (): Node => { cursor = 0; effects = []; const tree = Reader(props); for (const run of effects) run(); return tree }
  const nodes = (node: Node): Node[] => [node, ...node.children.filter(child => child && typeof child === 'object').flatMap(nodes)]
  const find = (className: string) => nodes(render()).find(node => node.props.className === className)
  return { context, props, requests, render, find, paints: () => paints, intervals,
    close: () => { for (const slot of slots) slot.cleanup?.(); assert.equal(intervals.size, 0); assert.equal(listeners.size, 0) } }
}
const latest = { kind: 'user', seq: 2, text: '任务原记录' }
test('切服保留已结束任务的正文与更早页，隐藏不读取或确认已读，切回补读而不接旧回包', async t => {
  const f = fixture(); t.after(f.close); f.render()
  f.requests[0].resolve({ sessionId: 'part-a', items: [latest], cursor: { beforeSeq: 2 } }); await settle(); f.render()
  const earlier = f.find('bt-tread-more'); assert.ok(earlier)
  const more = earlier.props.onClick()
  f.requests[1].resolve({ items: [{ kind: 'user', seq: 1, text: '更早任务记录' }], cursor: { beforeSeq: 1 } }); await more
  f.context.epoch++; f.render(); assert.equal(f.requests.length, 3)
  f.context.cached = true; f.context.epoch++; f.render()
  f.requests[2].resolve({ items: [{ kind: 'user', seq: 99, text: '迟到任务页' }], cursor: null }); await settle()
  assert.match(JSON.stringify(f.render()), /任务原记录/); assert.match(JSON.stringify(f.render()), /更早任务记录/)
  assert.doesNotMatch(JSON.stringify(f.render()), /迟到任务页/)
  const paints = f.paints(); f.find('bt-tread-scroll')?.props.onScroll()
  await f.find('bt-tread-more')?.props.onClick(); assert.equal(f.requests.length, 3); assert.equal(f.paints(), paints)
  f.context.cached = false; f.context.epoch++; f.render(); assert.equal(f.requests.length, 4)
  f.find('bt-tread-scroll')?.props.onScroll(); assert.equal(f.paints(), paints)
  f.requests[3].resolve({ sessionId: 'part-a', items: [latest, { kind: 'user', seq: 3, text: '恢复任务记录' }], cursor: { beforeSeq: 2 } }); await settle(); f.render()
  assert.match(JSON.stringify(f.render()), /更早任务记录/); assert.match(JSON.stringify(f.render()), /恢复任务记录/)
  assert.ok(f.paints() > paints); assert.equal(f.find('bt-tread-err'), undefined)
})
test('本地取消不会伪装授权拒绝，真实拒绝及任务范围变化仍清正文；隐藏暂停轮询', async t => {
  const f = fixture(); t.after(f.close); f.props.task.status = 'active'; f.render()
  f.requests[0].resolve({ items: [latest], cursor: null }); await settle(); f.render()
  assert.equal(f.intervals.size, 1)
  f.context.epoch++; f.render()
  f.requests[1].reject(new DeckError('RPC_ABORTED', '界面已切换')); await settle()
  assert.match(JSON.stringify(f.render()), /任务原记录/); assert.equal(f.find('bt-tread-err'), undefined)
  f.context.cached = true; f.render(); assert.equal(f.intervals.size, 0)
  f.context.cached = false; f.context.epoch++; f.render()
  f.requests[2].reject(new DeckError('bot/refused', '授权已撤销')); await settle()
  assert.doesNotMatch(JSON.stringify(f.render()), /任务原记录/)
  assert.match(JSON.stringify(f.find('bt-tread-err')), /服务器拒绝/)
  f.context.epoch++; f.render()
  f.requests[3].resolve({ items: [latest], cursor: null }); await settle(); f.render()
  f.context.cached = true; f.props.task.id = 'task-b'; f.render()
  assert.doesNotMatch(JSON.stringify(f.render()), /任务原记录/); assert.equal(f.requests.length, 4)
})
