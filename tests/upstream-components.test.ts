// SPDX-License-Identifier: Apache-2.0
// 在CI中验证只读提取的原组件与Deck适配；不调用网络、本机Session或终端。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { paintSource } from '../scripts/paint-source.mjs'
import { moduleAccess, moduleAccessText, resourcePermissions } from '../src/shared/resource-model.ts'
interface View { type: unknown; props: Record<string, any>; children: any[] }
const h = (type: unknown, props: Record<string, any> | null, ...children: any[]): View => ({ type, props: props ?? {}, children })
function nodes(view: any): View[] {
  if (Array.isArray(view)) return view.flatMap(nodes)
  if (!view || typeof view !== 'object' || !('children' in view)) return []
  return [view, ...view.children.flatMap(nodes)]
}
async function component(name: string, exports: string, extra: Record<string, unknown> = {}) {
  const root = path.resolve('DS-Bot')
  const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
  const code = paintSource(raw, path.join(root, name), root) ?? raw
  assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(root, name), root) ?? raw.replace(/\r?\n/g, '\r\n'), code)
  const value = runInNewContext(`${code.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')}\n({ ${exports} })`, {
    h, Fragment: 'fragment', useMemo: (fn: () => unknown) => fn(), useState: (value: unknown) => [value, () => {}],
    useEffect: () => {}, useRef: () => ({ current: null }), t: (value: string) => value,
    CheckIcon: 'check', CopyIcon: 'copy', CloseIcon: 'close', FileIcon: 'file', ChevronRightIcon: 'chevron',
    BotMark: 'mark', PasteCard: 'paste', fileExtension: () => 'txt', fileSizeText: () => '8 B',
    setTimeout: () => 0, writeClipboard: () => { throw new Error('不得绕过远程复制回调') }, ...extra,
  })
  return { value, code }
}
test('原候选菜单保留Bot标识、鼠标选择和combobox活跃项编号', async () => {
  const { value, code } = await component('app/ui/src/composer-menus.js', 'ComposerMenu')
  const picks: unknown[] = []
  const item = { key: 'bot-a', bot: { id: 'bot-a', name: '甲' }, title: '甲', subtitle: '角色' }
  const view = value.ComposerMenu({ items: [item], activeIndex: 0, id: 'menu-a', label: 'Bot', onSelect: (entry: unknown) => picks.push(entry) })
  const option = nodes(view).find(node => node.props.role === 'option')!
  assert.equal(view.props.id, 'menu-a'); assert.equal(option.props.id, 'menu-a-0')
  assert.equal(option.props['aria-selected'], true); assert.equal(option.props.tabIndex, -1)
  option.props.onClick(); assert.equal(picks[0], item)
  assert.equal(code.includes('classicCatalog'), false); assert.equal(code.includes('call('), false)
})
test('原附件栏显示文件与本机图片缩略图，移除只回调所选编号', async () => {
  const { value } = await component('app/ui/src/chat.js', 'ComposerAttachments')
  const removed: number[] = []
  const view = value.ComposerAttachments({ items: [{ id: 0, name: '说明.txt', size: 8 }, { id: 1, name: '截图.png', isImage: true, previewUrl: 'blob:local-image' }], onRemove: (id: number) => removed.push(id) })
  const all = nodes(view)
  assert.ok(all.some(node => node.props.className === 'dsb-attach-chip'))
  assert.equal(all.find(node => node.type === 'img')?.props.src, 'blob:local-image')
  const remove = all.filter(node => node.type === 'button')
  remove[1].props.onClick(); assert.deepEqual(removed, [1])
})
test('原工具代码块展开后保持全部已读文本，复制经远程回调并支持禁用', async () => {
  const { value } = await component('app/ui/src/tool-card.js', 'CodeSection')
  const text = '完整命令\n'.repeat(30); const copied: string[] = []
  const props = { label: '命令', text, unfolded: true, onCopy: (body: string) => { copied.push(body); return true } }
  const view = value.CodeSection(props)
  assert.equal(nodes(view).find(node => node.type === 'code')?.children[0], text)
  assert.equal(nodes(view).some(node => node.props.className === 'dsb-tool-fold'), false)
  nodes(view).find(node => node.type === 'button')!.props.onClick(); await Promise.resolve()
  assert.deepEqual(copied, [text])
  const disabled = value.CodeSection({ ...props, disabled: true })
  const button = nodes(disabled).find(node => node.type === 'button')!
  assert.equal(button.props.disabled, true); button.props.onClick(); assert.deepEqual(copied, [text])
})
test('原逐行差异保留行末换行变化，远程缺旧文本不伪造新增', async () => {
  const { value, code } = await component('app/ui/src/builtin-tool-views.js', 'computeLineDiff, DiffFileView', { shortPath: (value: string) => value, MiniCopy: 'copy' })
  const computed = value.computeLineDiff('旧\n相同\n', '新\n相同\n')
  assert.equal(computed.added, 1); assert.equal(computed.removed, 1)
  assert.equal(value.computeLineDiff('a', 'a\n').rows.some((row: { noNewline?: boolean }) => row.noNewline), true)
  assert.equal(value.computeLineDiff('a\r\n', 'a\n').added, 1)
  assert.equal(code.includes('previewDiffsFromArgs'), false); assert.equal(code.includes('registerBuiltinToolViews'), false)
  const raw = await readFile(new URL('../src/remote/change-view.js', import.meta.url), 'utf8')
  let calls = 0
  const { RecordedChange } = runInNewContext(`${raw.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')}\n({ RecordedChange })`, {
    h, useMemo: (fn: () => unknown) => fn(), computeLineDiff: (...args: unknown[]) => { calls++; return value.computeLineDiff(...args) },
    CodeSection: 'code-section', DiffFileView: 'diff-file', writeClipboard: () => Promise.resolve(true),
  })
  const missing = RecordedChange({ path: 'a.txt', before: null, after: '新内容', canCopy: () => false })
  assert.equal(calls, 0); assert.equal(nodes(missing).some(node => node.type === 'diff-file'), false)
  RecordedChange({ path: 'a.txt', before: '', after: '新内容', canCopy: () => true }); assert.equal(calls, 1)
})
test('资源只读原因字符串仍允许查看，但不能写文件或终端', async () => {
  const raw = await readFile(new URL('../src/remote/resource-read.js', import.meta.url), 'utf8')
  const code = raw.slice(raw.indexOf('export function useResourceContext('), raw.indexOf('export function useResourceRead('))
  const roster = { readOnly: null as null | boolean | string, extras: { schema: 1,
    workspace: { schema: 1, read: true, write: true }, terminals: { schema: 1, read: true, write: true } } }
  const { useResourceContext } = runInNewContext(`${code.replace(/^export /gm, '')}\n({ useResourceContext })`, {
    moduleAccess, moduleAccessText, resourcePermissions, ResourceContext: {},
    useContext: () => ({ roster, cached: false, epoch: 1, selection: 'part-a' }), useDetailAvailability: () => true,
  })
  for (const module of ['workspace', 'terminals']) {
    for (const readOnly of [null, true, '此团队由另一个窗口管理']) {
      roster.readOnly = readOnly
      const context = useResourceContext(module)
      assert.equal(context.available, true); assert.equal(context.access.write, readOnly === null)
    }
  }
})
