// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
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
