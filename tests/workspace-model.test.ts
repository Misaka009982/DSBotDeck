// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { workspacePreview, workspaceSnapshotIdentity, workspaceTreeEntries } from '../src/shared/workspace-display.ts'
import { appendWorkspaceDirectory, workspaceDirectory, workspaceFile, workspacePath, workspaceRoot } from '../src/shared/workspace-model.ts'
const target = { scope: { kind: 'bot' as const, botId: 'bot-a' }, sessionId: 'part-a' }
const root = { rootId: 'root-a', sessionId: 'part-a', expiresAt: 1000, maxFileBytes: 256 * 1024, pageSize: 64, writable: true }
const file = () => ({ schema: 1, rootId: 'root-a', path: 'readme.txt', text: '原文\r\n', version: 'opaque-version', complete: true, encoding: 'utf-8', redacted: false, editable: true, receiptId: 'edit-a' })
test('工作区根绑定真实会话，路径只接受受限相对形式', () => {
  assert.deepEqual(workspaceRoot({ schema: 1, ...root }, target), root)
  assert.throws(() => workspaceRoot({ schema: 1, ...root, sessionId: 'other-part' }, target))
  assert.throws(() => workspaceRoot({ schema: 1, ...root, maxFileBytes: 1024 * 1024 }, target))
  for (const path of ['/etc/file', '../file', 'C:/file', '//server/file', 'https://host/file', 'x:y', 'a\\b', 'a//b', 'a/./b', 'NUL', 'file.', 'a\0b']) assert.throws(() => workspacePath(path), path)
  assert.equal(workspacePath('', true), '')
  assert.equal(workspacePath('src/正常文件.txt'), 'src/正常文件.txt')
})
test('目录空页、过滤与分页末尾分开，换根和重复条目拒绝', () => {
  const empty = { schema: 1, rootId: root.rootId, path: '', entries: [], filtered: true, cursor: null }
  assert.equal(workspaceDirectory(empty, root, '').filtered, true)
  const first = workspaceDirectory({ ...empty, entries: [{ name: 'src', type: 'directory' }], cursor: { digest: 'digest-a', offset: 1 } }, root, '')
  const next = workspaceDirectory({ ...empty, entries: [{ name: 'readme.txt', type: 'file', size: 0 }] }, root, '', first.cursor!)
  assert.equal(appendWorkspaceDirectory(first, next).entries.length, 2)
  assert.throws(() => workspaceDirectory({ ...empty, rootId: 'other-root' }, root, ''))
  assert.throws(() => workspaceDirectory({ ...empty, entries: [{ name: '../outside', type: 'file' }] }, root, ''))
  assert.throws(() => workspaceDirectory({ ...empty, entries: [{ name: 'x', type: ['file'] }] }, root, ''))
  assert.throws(() => workspaceDirectory({ ...empty, entries: [{ name: 'x', type: 'file' }], cursor: { digest: 'changed', offset: 2 } }, root, '', first.cursor!))
  assert.throws(() => appendWorkspaceDirectory(first, first))
})
test('文件仅接受完整有效正文，保持CRLF和空文件，不缓存编辑回执', () => {
  const value = workspaceFile(file(), root, 'readme.txt')
  assert.equal(value.text, '原文\r\n'); assert.equal(Object.hasOwn(value, 'receiptId'), false)
  assert.equal(workspaceFile({ ...file(), text: '' }, root, 'readme.txt').text, '')
  for (const patch of [{ complete: false }, { encoding: 'gbk' }, { path: 'other.txt' }, { rootId: 'other-root' }, { text: 'a\0b' }, { text: '中'.repeat(90_000) }]) assert.throws(() => workspaceFile({ ...file(), ...patch }, root, 'readme.txt'))
})
test('脱敏预览保持只读事实，矛盾编辑标记与损坏回包拒绝', () => {
  const shown = { ...file(), redacted: true, editable: false, receiptId: null, text: '[已脱敏]' }
  assert.equal(workspaceFile(shown, root, 'readme.txt').redacted, true)
  assert.equal(workspaceFile(shown, root, 'readme.txt').editable, false)
  assert.throws(() => workspaceFile({ ...shown, editable: true }, root, 'readme.txt'))
  assert.throws(() => workspaceFile({ ok: true }, root, 'readme.txt'))
})
test('远程目录适配原文件树保留完整相对路径、文件种类和未知大小', () => {
  const page = workspaceDirectory({ schema: 1, rootId: root.rootId, path: 'src', filtered: false, cursor: null,
    entries: [{ name: '__proto__', type: 'directory' }, { name: '文件.ts', type: 'file', size: 32 }] }, root, 'src')
  assert.deepEqual(workspaceTreeEntries(page), [
    { name: '__proto__', kind: 'dir', path: 'src/__proto__', size: null },
    { name: '文件.ts', kind: 'file', path: 'src/文件.ts', size: 32 },
  ])
  assert.equal(page.entries[0].type, 'directory')
})
test('自动续页达到4096项后明确停止，不借服务器游标无限扩展目录', () => {
  let directory = workspaceDirectory({ schema: 1, rootId: root.rootId, path: '', filtered: false, entries: [], cursor: null }, root, '')
  for (let offset = 0; offset < 4096; offset += 64) {
    const cursor = { digest: 'stable-directory', offset }
    const page = workspaceDirectory({ schema: 1, rootId: root.rootId, path: '', filtered: false,
      entries: Array.from({ length: 64 }, (_, index) => ({ name: `${offset + index}.txt`, type: 'file' })),
      cursor: { digest: cursor.digest, offset: offset + 64 } }, root, '', cursor)
    directory = appendWorkspaceDirectory(directory, page)
  }
  assert.equal(directory.entries.length, 4096); assert.equal(directory.limited, true)
})
test('每目录按文件名自然正序或倒序，目录优先且不修改原分页顺序', () => {
  const page = workspaceDirectory({ schema: 1, rootId: root.rootId, path: '', filtered: false, cursor: null,
    entries: [{ name: '10.txt', type: 'file' }, { name: '2.txt', type: 'file' }, { name: '资料', type: 'directory' }] }, root, '')
  const before = JSON.stringify(page)
  assert.deepEqual(workspaceTreeEntries(page).map(entry => entry.name), ['资料', '2.txt', '10.txt'])
  assert.deepEqual(workspaceTreeEntries(page, true).map(entry => entry.name), ['资料', '10.txt', '2.txt'])
  assert.equal(JSON.stringify(page), before)
})
test('工作区快照只随目标、已知目录和授权变化，不随连接或可见性变化', () => {
  const roster = { byId: { 'bot-a': { id: 'bot-a', sessionId: 'part-a', workDir: '/tmp/project' } },
    extras: { schema: 1, workspace: { schema: 1, read: true, write: true } } }
  const before = workspaceSnapshotIdentity(roster, target, 'part-a')
  assert.equal(workspaceSnapshotIdentity({ ...roster, cached: true, epoch: 2, visible: false }, target, 'part-a'), before)
  for (const patch of [
    { ...roster, byId: { 'bot-a': { ...roster.byId['bot-a'], workDir: '/tmp/other' } } },
    { ...roster, extras: { ...roster.extras, workspace: { ...roster.extras.workspace, read: false } } },
    { ...roster, extras: { ...roster.extras, workspace: { ...roster.extras.workspace, write: false } } },
  ]) assert.notEqual(workspaceSnapshotIdentity(patch, target, 'part-a'), before)
  assert.notEqual(workspaceSnapshotIdentity(roster, { ...target, sessionId: 'part-b' }, 'part-a'), before)
  assert.notEqual(workspaceSnapshotIdentity(roster, target, 'part-b'), before)
})
test('原预览仅接已验证文本，Markdown与表格可呈现，HTML和SVG保持源码', () => {
  for (const [path, kind, language] of [['README.md', 'markdown', 'markdown'], ['data.tsv', 'table', ''], ['src/a.ts', 'code', 'typescript'], ['index.html', 'code', 'xml'], ['image.svg', 'code', 'xml'], ['constructor', 'text', ''], ['x.__proto__', 'text', '']]) {
    const parsed = workspaceFile({ ...file(), path, text: '原文\r\n' }, root, path)
    const preview = workspacePreview(parsed)
    assert.equal(preview.kind, kind); assert.equal(preview.language, language)
    assert.equal(preview.text, '原文\r\n'); assert.equal(preview.size, 8)
    assert.equal(Object.hasOwn(preview, 'receiptId'), false)
    assert.equal(Object.hasOwn(preview, 'base64'), false)
  }
})
