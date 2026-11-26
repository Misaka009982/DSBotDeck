// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { WorkspaceDraft, WorkspaceDraftStore, editFile, savedChange } from '../src/shared/workspace-editor.ts'
const target = { scope: { kind: 'bot' as const, botId: 'bot-a' }, sessionId: 'part-a' }
const root = { rootId: 'root-a', sessionId: 'part-a', expiresAt: 9999999999999, maxFileBytes: 262144, pageSize: 64, writable: true }
const raw = () => ({ schema: 1, rootId: root.rootId, path: 'file.txt', text: '旧内容\r\n', version: 'v1', complete: true, encoding: 'utf-8', redacted: false, editable: true, receiptId: 'edit-a' })
const file = () => editFile(raw(), root, 'file.txt')
test('编辑固定完整文件和回执，CRLF保留，脱敏或损坏正文不能获得编辑回执', () => {
  const draft = new WorkspaceDraft(target, root, file())
  draft.edit('修改\n')
  assert.equal(draft.text, '修改\r\n')
  assert.throws(() => editFile({ ...raw(), redacted: true }, root, 'file.txt'))
  assert.throws(() => editFile({ ...raw(), complete: false }, root, 'file.txt'))
  assert.throws(() => new WorkspaceDraft(target, root, editFile({ ...raw(), editable: false, receiptId: null }, root, 'file.txt')))
  assert.throws(() => draft.edit('x\0y'))
  assert.throws(() => draft.edit('中'.repeat(90000)))
})
test('保存请求只领取一次，断线后只能查原回执，ready不是可以重发的证据', () => {
  const draft = new WorkspaceDraft(target, root, file()); draft.edit('新内容')
  const request = draft.begin('request-a', 1)
  assert.deepEqual(request, { rootId: 'root-a', receiptId: 'edit-a', requestId: 'request-a', content: '新内容' })
  assert.throws(() => draft.begin('request-b', 1))
  draft.fail('NETWORK'); assert.equal(draft.status, 'unknown')
  assert.deepEqual(draft.query(), { rootId: 'root-a', receiptId: 'edit-a' })
  draft.result({ schema: 1, rootId: 'root-a', receiptId: 'edit-a', requestId: null, status: 'ready', version: null })
  assert.equal(draft.status, 'unknown'); assert.throws(() => draft.begin('request-c', 1))
  assert.throws(() => draft.bind(root, file(), true))
})
test('成功仅取服务器新版本，保存期间的新编辑继续保留，迟到或错回执拒绝', () => {
  const draft = new WorkspaceDraft(target, root, file()); draft.edit('第一版'); draft.begin('request-a', 1)
  draft.edit('后续本地内容')
  assert.throws(() => draft.result({ schema: 1, rootId: 'other', receiptId: 'edit-a', requestId: 'request-a', status: 'saved', version: 'v2' }))
  draft.result({ schema: 1, rootId: 'root-a', receiptId: 'edit-a', requestId: 'request-a', status: 'saved', version: 'v2' })
  assert.equal(draft.baseVersion, 'v2'); assert.equal(draft.baseText, '第一版'); assert.equal(draft.text, '后续本地内容'); assert.equal(draft.dirty, true)
  draft.result({ schema: 1, rootId: 'root-a', receiptId: 'edit-a', requestId: 'request-a', status: 'pending', version: null })
  assert.equal(draft.status, 'saved'); assert.equal(draft.baseVersion, 'v2')
  assert.throws(() => draft.result({ schema: 1, rootId: 'root-a', receiptId: 'edit-a', requestId: 'request-a', status: 'saved', version: 'other-version' }))
  assert.throws(() => draft.begin('request-b', 1))
})
test('冲突保留原编辑，必须比较并明确采用新基线后才能再次保存', () => {
  const draft = new WorkspaceDraft(target, root, file()); draft.edit('我的编辑'); draft.begin('request-a', 1); draft.fail('bot/conflict')
  const newer = editFile({ ...raw(), version: 'v2', text: 'Agent修改', receiptId: 'edit-b' }, root, 'file.txt')
  draft.bind(root, newer)
  assert.equal(draft.status, 'conflict'); assert.equal(draft.text, '我的编辑')
  assert.throws(() => draft.begin('request-b', 1))
  draft.bind(root, newer, true)
  assert.equal(draft.baseVersion, 'v2'); assert.equal(draft.begin('request-c', 1).receiptId, 'edit-b')
})
test('同版本令牌下正文变化也要求比较，不能静默用新回执覆盖', () => {
  const draft = new WorkspaceDraft(target, root, file()); draft.edit('我的编辑')
  const changed = editFile({ ...raw(), text: '其他进程内容', receiptId: 'edit-b' }, root, 'file.txt')
  draft.bind(root, changed)
  assert.equal(draft.status, 'conflict'); assert.equal(draft.baseText, '旧内容\r\n'); assert.equal(draft.text, '我的编辑')
  assert.throws(() => draft.begin('request-a', 1))
  draft.bind(root, changed, true)
  assert.equal(draft.begin('request-b', 1).content, '我的编辑')
})
test('跨面板保留草稿，换根即使版本相同也需比较，最多八份不静默淘汰', () => {
  const store = new WorkspaceDraftStore()
  const draft = store.open(target, root, file()); draft.edit('未保存'); store.changed(); store.release(target, 'file.txt')
  assert.equal(store.get(target, 'file.txt'), draft)
  const otherRoot = { ...root, rootId: 'root-b' }; const sameVersion = editFile({ ...raw(), rootId: 'root-b', receiptId: 'edit-b' }, otherRoot, 'file.txt')
  draft.bind(otherRoot, sameVersion); assert.equal(draft.status, 'conflict'); assert.equal(draft.text, '未保存')
  for (let index = 1; index < 8; index += 1) {
    const path = `file-${index}.txt`; store.open(target, root, editFile({ ...raw(), path }, root, path)).edit('未保存')
  }
  assert.throws(() => store.open(target, root, editFile({ ...raw(), path: 'ninth.txt' }, root, 'ninth.txt')))
  assert.equal(store.list().length, 8)
  store.discard(target, 'file.txt'); assert.equal(store.get(target, 'file.txt'), undefined)
})
test('保存修改来源与原请求绑定，缺旧文本不伪造完整对比', () => {
  const draft = new WorkspaceDraft(target, root, file()); draft.edit('新内容'); draft.begin('request-a', 1)
  draft.result({ schema: 1, rootId: 'root-a', receiptId: 'edit-a', requestId: 'request-a', status: 'saved', version: 'v2' })
  const change = { schema: 1, source: 'workspace-save', rootId: 'root-a', receiptId: 'edit-a', requestId: 'request-a', path: 'file.txt', version: 'v2', before: null, after: '新内容', complete: false, redacted: false }
  assert.equal(savedChange(change, draft).before, null)
  assert.throws(() => savedChange({ ...change, complete: true }, draft))
  assert.throws(() => savedChange({ ...change, requestId: 'outside' }, draft))
})
