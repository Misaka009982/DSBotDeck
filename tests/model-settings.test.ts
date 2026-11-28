// SPDX-License-Identifier: Apache-2.0
// 模型表单的请求生命周期回归；替代React调度与RPC，不启动界面或连接服务器。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { providerCatalog, providerModelRequest } from '../src/shared/provider-model.ts'
import { DeckError, errorCode } from '../src/shared/validation.ts'
interface Node { type: any; props: Record<string, any>; children: any[] }
interface Slot { value?: any; deps?: unknown[]; cleanup?: (() => void) | void }
interface Request { endpoint: string; payload: any; signal: AbortSignal; resolve(value: unknown): void; reject(error: Error): void }
const text = await readFile(new URL('../src/remote/model-settings.js', import.meta.url), 'utf8')
const code = text.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
const settled = async () => { for (let index = 0; index < 10; index++) await Promise.resolve() }
function nodes(node: any): Node[] { return Array.isArray(node) ? node.flatMap(nodes) : node?.children ? [node, ...node.children.flatMap(nodes)] : [] }
const catalog = (revision = 1, added = false) => ({ available: true, revision, providers: [{ id: 'relay', name: 'Relay', refreshable: true, models: [{ id: 'kept', name: 'Kept' }, ...(added ? [{ id: 'new-model', name: 'New' }] : [])] }] })
const draft = { id: 'new-model', name: 'New', contextWindow: '128000', maxTokens: '', input: '' }
function fixture() {
  const slots: Slot[] = []; let cursor = 0; let effects: (() => void)[] = []; let visible = true
  const cell = (initial: () => Slot) => slots[cursor++] ??= initial()
  const requests: Request[] = []
  const context = { mode: 'phone', cached: false, epoch: 0, roster: { readOnly: null as string | null } }
  const actions = { refreshModels: async () => {} }
  const { ModelSettings, ModelForm } = runInNewContext(`${code}\n;({ ModelSettings, ModelForm })`, {
    h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useContext: () => context, ResourceContext: {}, useDetailAvailability: () => visible,
    useRef: (initial: unknown) => cell(() => ({ value: { current: initial } })).value,
    useState: (initial: any) => { const slot = cell(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [slot.value, (value: any) => { slot.value = typeof value === 'function' ? value(slot.value) : value }] },
    useLayoutEffect: (start: () => (() => void) | void, deps: unknown[]) => {
      const slot = cell(() => ({}))
      if (!slot.deps || !deps.every((value, index) => Object.is(value, slot.deps?.[index]))) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = start() })
    },
    language: () => 'en', t: (value: string) => value, hostText: (value: string) => value, toTraditional: (value: string) => value,
    SelectMenu: 'select', PlusIcon: 'plus', providerCatalog, providerModelRequest, errorCode, AbortController,
    document: { get visibilityState() { return visible ? 'visible' : 'hidden' }, body: { hasAttribute: () => context.cached } },
    call: (endpoint: string, payload: unknown, signal: AbortSignal) => new Promise<unknown>((resolve, reject) => requests.push({ endpoint, payload, signal, resolve, reject })),
  })
  const render = () => {
    cursor = 0; effects = []
    const tree: Node = ModelSettings({ actions, initialProvider: 'relay' })
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = { isConnected: true, closest: () => null }
    for (const run of effects) run()
    return tree
  }
  const form = () => nodes(render()).find(node => node.type === ModelForm)!
  const reload = () => nodes(render()).find(node => node.type === 'button')!.props.onClick()
  const close = () => { for (const slot of slots) slot.cleanup?.() }
  return { context, actions, requests, render, form, reload, close, hide: () => { visible = false; render() }, show: () => { visible = true; render() } }
}
test('模型保存绑定原版本，重复点击只发送一次，刷新失败不降级已确认结果', async t => {
  const f = fixture(); t.after(f.close); f.render()
  assert.equal(f.requests[0].endpoint, 'providers')
  f.requests[0].resolve(catalog()); await settled()
  const action = f.form().props.onSave
  f.actions.refreshModels = async () => { throw new Error('刷新超时') }
  const saving = action(null, draft); await action(null, draft)
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].endpoint, 'provider-models-save')
  assert.equal(f.requests[1].payload.revision, 1)
  f.requests[1].resolve(catalog(2, true)); await saving; await settled()
  assert.ok(JSON.stringify(f.render()).includes('Saved.')); assert.equal(f.form().props.disabled, false)
})
test('浏览器权限和缓存表单不能写，切走后的成功回包不回填且恢复只允许重新读取', async t => {
  const f = fixture(); t.after(f.close); f.render(); f.requests[0].resolve(catalog()); await settled()
  f.context.mode = 'browser'; f.render()
  await f.form().props.onSave(null, draft); assert.equal(f.requests.length, 1)
  f.context.mode = 'phone'; f.render(); f.reload()
  f.requests[1].resolve(catalog()); await settled()
  const saving = f.form().props.onSave(null, draft)
  f.hide(); assert.equal(f.requests[2].signal.aborted, true)
  f.requests[2].resolve(catalog(2, true)); await saving
  assert.equal(JSON.stringify(f.render()).includes('Saved.'), false)
  f.show(); assert.equal(f.form().props.disabled, true)
  await f.form().props.onSave(null, draft); assert.equal(f.requests.length, 3)
  f.reload(); f.requests[3].resolve(catalog(2, true)); await settled()
  assert.equal(f.form().props.disabled, false)
  f.context.cached = true; f.context.epoch++; f.render()
  await f.form().props.onSave(null, draft); assert.equal(f.requests.length, 4)
  f.context.cached = false; f.render(); f.reload()
  const other = catalog(3); other.providers[0].id = 'other-provider'
  f.requests[4].resolve(other); await settled()
  assert.equal(f.form(), undefined, '原服务商失效不能自动把编辑目标换成其他服务商')
  assert.ok(JSON.stringify(f.render()).includes('The provider is no longer available'))
})
test('版本冲突与损坏保存回包保留编辑锁，不自动重发', async t => {
  for (const kind of ['stale', 'malformed']) {
    const f = fixture(); t.after(f.close); f.render(); f.requests[0].resolve(catalog()); await settled()
    const saving = f.form().props.onSave(null, draft)
    if (kind === 'stale') f.requests[1].reject(new DeckError('bot/stale', 'The provider changed'))
    else f.requests[1].resolve({ available: true, providers: 'broken' })
    await saving
    assert.equal(f.form().props.disabled, true)
    await f.form().props.onSave(null, draft); assert.equal(f.requests.length, 2)
    if (kind === 'malformed') assert.ok(JSON.stringify(f.render()).includes('Save result is unknown'))
  }
})
