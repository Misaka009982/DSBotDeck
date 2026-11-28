// SPDX-License-Identifier: Apache-2.0
// 使用真实工作区组件和读取队列，仅替换React调度、DOM与网络；回归由CI执行。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import * as resources from '../src/shared/resource-model.ts'
import * as workspace from '../src/shared/workspace-model.ts'
import * as display from '../src/shared/workspace-display.ts'
import { DeckError, errorCode } from '../src/shared/validation.ts'
interface Slot { value?: any; deps?: unknown[]; cleanup?: (() => void) | void }
interface Component { slots: Slot[]; mounted: boolean }
interface View { type: any; props: Record<string, any>; children: any[] }
interface Request { endpoint: string; payload: any; signal: AbortSignal; resolve(value: unknown): void; reject(error: Error): void }
const source = async (file: string) => (await readFile(new URL(`../src/remote/${file}`, import.meta.url), 'utf8')).replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
const code = `${await source('resource-read.js')}\n${await source('workspace-pane.js')}\n${await source('workspace-panel.js')}\n;({ WorkspacePane, useRemoteWorkspace, useResourceRead, rejectResourceReads })`
const target = { scope: { kind: 'bot', botId: 'bot-a' }, sessionId: 'part-a' }
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve() }
function fixture() {
  const components = new Map<string, Component>(); const elements = new Map<string, any>(); let current: Component; let cursor = 0
  let effects: (() => void)[] = []; let changed = false; let tree: any
  const requests: Request[] = []; const timers = new Map<number, () => void>(); let timerId = 0
  const roster = { readOnly: null, byId: { 'bot-a': { id: 'bot-a', sessionId: 'part-a', workDir: '/tmp/project' } },
    extras: { schema: 1, workspace: { schema: 1, read: true, write: true, readOnlyPreview: true } } }
  const context = { roster, cached: false, epoch: 1, selection: 'part-a' }
  let visible = true
  const props = { target, initialPath: 'notes.md', tab: 'preview', active: true, onOpenFile: (path: string) => { props.initialPath = path; props.tab = 'preview' } }
  const cell = (initial: () => Slot) => current.slots[cursor++] ??= initial()
  const same = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const effect = (start: () => (() => void) | void, deps?: unknown[]) => {
    const slot = cell(() => ({}))
    if (!same(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = start() })
  }
  const h = (type: unknown, props: Record<string, any> | null, ...children: unknown[]): View => ({ type, props: props ?? {}, children })
  const api = runInNewContext(code, {
    ...resources, ...workspace, ...display, errorCode, EventTarget, Event, AbortController, h,
    createContext: () => ({}), useContext: () => context, useDetailAvailability: () => visible && !context.cached,
    useRef: (initial: unknown) => cell(() => ({ value: { current: initial } })).value,
    useState: (initial: any) => {
      const slot = cell(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [slot.value, (value: any) => { const next = typeof value === 'function' ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; changed = true } }]
    },
    useMemo: (fn: () => unknown, deps: unknown[]) => { const slot = cell(() => ({})); if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = fn() }; return slot.value },
    useEffect: effect, useLayoutEffect: effect,
    document: { get visibilityState() { return visible ? 'visible' : 'hidden' }, body: { hasAttribute: () => context.cached } },
    setTimeout: (fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout: (id: number) => timers.delete(id),
    call: (endpoint: string, payload: unknown, signal: AbortSignal) => new Promise<unknown>((resolve, reject) => {
      const aborted = () => reject(new DeckError('RPC_ABORTED', '读取已取消'))
      signal.addEventListener('abort', aborted, { once: true })
      requests.push({ endpoint, payload, signal,
        resolve: value => { signal.removeEventListener('abort', aborted); resolve(value) },
        reject: error => { signal.removeEventListener('abort', aborted); reject(error) } })
    }),
    UpstreamPreview: 'upstream-preview', WorkspaceEditor: 'workspace-editor', workspaceDrafts: { get: () => undefined }, TerminalPane: 'terminal',
    RefreshIcon: 'refresh', SearchIcon: 'search', ArrowUpIcon: 'arrow-up', ArrowDownIcon: 'arrow-down',
    TreeBranch: (props: any) => props.entries.map((entry: any) => h('button', { className: 'dsb-ft-row', 'data-path': entry.path,
      onClick: () => entry.kind === 'dir' ? props.onToggleDir(entry.path) : props.onSelectFile(entry.path) }, entry.name)),
    buildWorkspaceTabs: () => [{ id: 'files' }, { id: 'preview' }],
  })
  function expand(value: any, parent: string): any {
    if (Array.isArray(value)) return value.map((child, index) => expand(child, `${parent}/${child?.props?.key ?? index}`))
    if (!value || typeof value !== 'object') return value
    if (typeof value.type === 'function') {
      const id = `${parent}:${value.type.name}:${value.props.key ?? ''}`
      const component = components.get(id) ?? { slots: [], mounted: false }; components.set(id, component); component.mounted = true
      current = component; cursor = 0
      return expand(value.type(value.props), id)
    }
    const id = `${parent}:${value.type}:${value.props.key ?? ''}`
    if (!elements.has(id)) elements.set(id, { isConnected: true, scrollTop: 0, closest: () => null })
    if (value.props.ref) value.props.ref.current = elements.get(id)
    return { ...value, instance: elements.get(id), children: expand(value.children, id) }
  }
  const render = () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      changed = false; effects = []; for (const component of components.values()) component.mounted = false
      tree = expand(h(api.WorkspacePane, props), 'pane')
      for (const [id, component] of components) if (!component.mounted) { for (const slot of component.slots) slot.cleanup?.(); components.delete(id) }
      for (const run of effects) run()
      if (!changed) return tree
    }
    throw new Error('组件更新未收敛')
  }
  const nodes = (value: any): any[] => Array.isArray(value) ? value.flatMap(nodes) : value?.children ? [value, ...nodes(value.children)] : []
  const all = () => nodes(render())
  const preview = () => all().find(view => view.type === 'upstream-preview')
  const complete = async (request: Request, value: unknown) => { request.resolve(value); await settle(); render(); await settle() }
  const root = { schema: 1, rootId: 'root-a', sessionId: 'part-a', expiresAt: Date.now() + 600000, maxFileBytes: 256 * 1024, pageSize: 64, writable: true }
  const panelState = { tab: 'preview', file: 'notes.md', fileSessionId: 'part-a' }
  const team = { hooks: { useUi: (select: (value: unknown) => unknown) => select({ rightPanel: panelState }) },
    actions: { openFiles() {}, openFile() {}, newTerminal() {}, canOpenFiles() {}, canOpenTerminal() {} } }
  const panel = (tab = 'preview') => {
    current = components.get('panel-hook') ?? { slots: [], mounted: true }; components.set('panel-hook', current); cursor = 0; effects = []
    const result = api.useRemoteWorkspace({ team, roster, shown: 'bot-a', cached: context.cached, epoch: context.epoch })
    for (const run of effects) run()
    return result.workspace.render(tab, true)
  }
  const readResource = (retain: boolean) => {
    current = components.get('read-hook') ?? { slots: [], mounted: true }; components.set('read-hook', current); cursor = 0; effects = []
    const result = api.useResourceRead({ identity: 'detail', enabled: !context.cached, epoch: context.epoch, retain,
      node: { current: { isConnected: true, closest: () => null } }, read: async () => '已验证正文' })
    for (const run of effects) run()
    return result
  }
  return { context, props, requests, render, all, preview, complete, root, api, components, panel, readResource,
    hide: () => { visible = false; render() }, show: () => { visible = true; render() }, expire: () => { for (const timer of [...timers.values()]) timer(); render() },
    close: () => { for (const component of components.values()) for (const slot of component.slots) slot.cleanup?.() } }
}
async function loaded(f: ReturnType<typeof fixture>) {
  f.render(); await settle()
  assert.equal(f.requests[0].endpoint, 'extra-workspace-open')
  await f.complete(f.requests[0], f.root)
  const read = f.requests.find(request => request.endpoint === 'extra-workspace-read'); assert.ok(read)
  await f.complete(read, { schema: 1, rootId: 'root-a', path: 'notes.md', version: 'v1', text: '还没看完\r\n第二段',
    complete: true, encoding: 'utf-8', redacted: false, editable: false, receiptId: null })
}
test('文件侧栏连接变化不重挂，终端仍随连接失效，已知工作目录变化会换掉文件范围', t => {
  const f = fixture(); t.after(f.close)
  const before = f.panel().props.key; const terminal = f.panel('terminal').children.at(-1).props.key
  f.context.cached = true; f.context.epoch++
  assert.equal(f.panel().props.key, before)
  assert.notEqual(f.panel('terminal').children.at(-1).props.key, terminal)
  f.context.cached = false; f.context.epoch++
  assert.equal(f.panel().props.key, before)
  f.context.roster.byId['bot-a'].workDir = '/tmp/other'
  assert.notEqual(f.panel().props.key, before)
})
test('快照保留必须显式启用，其他资源详情仍在不可读时释放正文', async t => {
  for (const retain of [false, true]) {
    const f = fixture(); t.after(f.close); f.readResource(retain); await settle()
    assert.equal(f.readResource(retain).value, '已验证正文')
    f.context.cached = true; f.context.epoch++; f.readResource(retain)
    assert.equal(f.readResource(retain).value, retain ? '已验证正文' : null)
    f.api.rejectResourceReads(); assert.equal(f.readResource(retain).value, null)
  }
})
test('文件刷新超时保留正文与预览实例，显式刷新成功后才替换内容', async t => {
  const f = fixture(); t.after(f.close); await loaded(f)
  const preview = f.preview(); const content = preview.props.file.text
  f.all().find(view => view.props.title === '重新读取文件')!.props.onClick(); await settle()
  assert.equal(f.preview().props.file.text, content); assert.equal(f.preview().props.loading, false)
  f.requests.at(-1)!.reject(new DeckError('RPC_TIMEOUT', '读取超时')); await settle()
  assert.equal(f.preview().props.file.text, content); assert.equal(f.preview().instance, preview.instance)
  f.all().find(view => view.props.title === '重新读取文件')!.props.onClick(); await settle()
  await f.complete(f.requests.at(-1)!, { schema: 1, rootId: 'root-a', path: 'notes.md', version: 'v2', text: '新版本',
    complete: true, encoding: 'utf-8', redacted: false, editable: false, receiptId: null })
  assert.equal(f.preview().props.file.text, '新版本'); assert.equal(f.preview().instance, preview.instance)
})
test('已读文件离线、隐藏和句柄到期后继续呈现，恢复不自动换正文或复用写回执', async t => {
  const css = await readFile(new URL('../src/remote/resource-pane.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /body\[data-deck-cached\][^{]*\.deck-workspace-preview[^}]*visibility\s*:\s*hidden/)
  assert.match(css, /\.deck-workspace-preview \.dsb-pv button/)
  const f = fixture(); t.after(f.close); await loaded(f)
  const first = f.preview(); const content = first.props.file.text; first.instance.scrollTop = 180
  f.context.cached = true; f.context.epoch++; f.render(); await settle()
  assert.equal(f.preview().props.file.text, content); assert.equal(f.preview().props.loading, false)
  assert.equal(f.preview().instance, first.instance); assert.equal(f.preview().instance.scrollTop, 180)
  f.hide(); f.expire(); assert.equal(f.preview().props.file.text, content)
  const reads = f.requests.length
  f.context.cached = false; f.context.epoch++; f.show(); await settle()
  assert.equal(f.requests.length, reads); assert.equal(f.preview().props.file.text, content)
  assert.equal(f.all().some(view => view.type === 'workspace-editor'), false)
  assert.match(JSON.stringify(f.render()), /缓存/)
  assert.equal(f.all().find(view => view.props.title === '重新读取文件')?.props.disabled, true)
})
test('真实资源拒绝、授权撤销及目标变化清快照，迟到旧读取不能恢复正文', async t => {
  for (const change of ['refused', 'permission', 'target']) {
    const f = fixture(); t.after(f.close); await loaded(f)
    const reload = f.all().find(view => view.props.title === '重新读取文件'); assert.ok(reload)
    reload.props.onClick(); await settle()
    const late = f.requests.at(-1)!; assert.equal(late.endpoint, 'extra-workspace-read')
    if (change === 'refused') f.api.rejectResourceReads()
    if (change === 'permission') f.context.roster.extras.workspace.read = false
    if (change === 'target') f.props.target = { scope: { kind: 'bot', botId: 'bot-a' }, sessionId: 'part-b' }
    f.render(); assert.equal(late.signal.aborted, true)
    await f.complete(late, { schema: 1, rootId: 'root-a', path: 'notes.md', version: 'v2', text: '迟到正文', complete: true, encoding: 'utf-8', redacted: false, editable: false })
    assert.doesNotMatch(JSON.stringify(f.render()), /还没看完|迟到正文/)
  }
})
test('展开目录自动跨64项读取，逐目录倒序只改变自己的自然文件名排序', async t => {
  const f = fixture(); t.after(f.close); f.props.tab = 'files'; f.props.initialPath = ''
  f.render(); await settle(); await f.complete(f.requests[0], f.root)
  const first = f.requests.at(-1)!; assert.equal(first.endpoint, 'extra-workspace-list')
  const entries = [{ name: 'folder', type: 'directory' }, ...Array.from({ length: 63 }, (_, index) => ({ name: `${index + 1}.txt`, type: 'file' }))]
  await f.complete(first, { schema: 1, rootId: 'root-a', path: '', entries, filtered: false, cursor: { digest: 'dir-a', offset: 64 } })
  const second = f.requests.at(-1)!; assert.deepEqual(JSON.parse(JSON.stringify(second.payload.cursor)), { digest: 'dir-a', offset: 64 })
  await f.complete(second, { schema: 1, rootId: 'root-a', path: '', entries: [{ name: '64.txt', type: 'file' }], filtered: false, cursor: null })
  const row = f.all().find(view => view.props['data-path'] === 'folder'); assert.ok(row); row.props.onClick(); f.render(); await settle()
  await f.complete(f.requests.at(-1)!, { schema: 1, rootId: 'root-a', path: 'folder', entries: [{ name: '10.txt', type: 'file' }, { name: '2.txt', type: 'file' }], filtered: false, cursor: null })
  const order = () => f.all().filter(view => view.props['data-path']).map(view => view.props['data-path'])
  assert.deepEqual(order().filter(path => path.startsWith('folder/')), ['folder/2.txt', 'folder/10.txt'])
  const sort = f.all().find(view => view.props['aria-label'] === 'folder：按文件名倒序'); assert.ok(sort)
  const requests = f.requests.length; sort.props.onClick(); f.render(); await settle()
  assert.deepEqual(order().filter(path => path.startsWith('folder/')), ['folder/10.txt', 'folder/2.txt'])
  assert.deepEqual(order().filter(path => !path.startsWith('folder/')).slice(-2), ['63.txt', '64.txt'])
  assert.equal(f.requests.length, requests)
})
test('目录续页中断保留已读列表并停止自动重试，旧页完成不能覆盖离线快照', async t => {
  const f = fixture(); t.after(f.close); f.props.tab = 'files'; f.props.initialPath = ''
  f.render(); await settle(); await f.complete(f.requests[0], f.root)
  await f.complete(f.requests.at(-1)!, { schema: 1, rootId: 'root-a', path: '', entries: [{ name: 'kept.txt', type: 'file' }], filtered: false, cursor: { digest: 'dir-a', offset: 1 } })
  const next = f.requests.at(-1)!; const count = f.requests.length
  next.reject(new DeckError('RPC_TIMEOUT', '分页超时')); await settle(); f.render(); await settle()
  assert.match(JSON.stringify(f.render()), /kept.txt/); assert.equal(f.requests.length, count)
  f.context.cached = true; f.context.epoch++; f.render(); f.context.cached = false; f.context.epoch++; f.render(); await settle()
  assert.match(JSON.stringify(f.render()), /kept.txt/); assert.equal(f.requests.length, count)
})
