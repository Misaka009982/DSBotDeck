// SPDX-License-Identifier: Apache-2.0
// 未保存内容只留在隔离服务器视图的内存；主进程仅接收有无草稿，不接收正文。
import { createElement as h, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { call } from '@dsbot/client/api.js'
import { writeClipboard } from '@dsbot/ui/primitives.js'
import { WorkspaceDraftStore, draftKey, editFile, savedChange } from '../shared/workspace-editor.ts'
import { errorCode } from '../shared/validation.ts'
import { currentResourceSession, resourceAccessFailure, resourceFailure } from '../shared/resource-model.ts'
import { onResourceDenied, rejectResourceReads, ReadState, useResourceContext, useResourceRead } from './resource-read.js'
import { draftPresence } from './draft-presence.js'
export const workspaceDrafts = new WorkspaceDraftStore()
workspaceDrafts.subscribe(() => draftPresence('workspace', workspaceDrafts.list().length > 0))
const useDrafts = () => useSyncExternalStore(workspaceDrafts.subscribe, () => workspaceDrafts.revision)
const visible = node => document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached') && node?.isConnected && !node.closest('[data-leaving]')
const STATUS = { editing: '尚未保存', saving: '正在提交', pending: '服务器处理中', saved: '服务器已确认保存', conflict: '版本冲突，编辑内容已保留', failed: '服务器确认保存失败', unknown: '保存结果未知，没有自动重发' }
export function WorkspaceEditor({ target, root, path, onClose }) {
  const context = useResourceContext('workspace'); const node = useRef(null); const latest = useRef(null); const request = useRef(null)
  const [draft, setDraft] = useState(null); const [error, setError] = useState(null); const [change, setChange] = useState(null); const [busy, setBusy] = useState(false)
  useDrafts()
  const identity = JSON.stringify([context.boundary, target, root.rootId, path])
  latest.current = identity
  const available = context.available && currentResourceSession(context.roster, target)
  const usable = () => latest.current === identity && available && visible(node.current)
  const reader = useResourceRead({ identity, enabled: available && Date.now() < root.expiresAt, node,
    read: async (_cursor, signal) => editFile(await call('extra-workspace-read', { rootId: root.rootId, path }, signal), root, path) })
  useLayoutEffect(() => {
    if (!reader.value) return
    if (reader.value.redacted) { setDraft(null); setChange(null); setError('当前文件含已遮盖内容，不能继续编辑；本地内容仍保留。'); return }
    try { setDraft(workspaceDrafts.open(target, root, reader.value)); setError(null) }
    catch (failure) { setError(resourceFailure(failure)) }
  }, [reader.value])
  useLayoutEffect(() => {
    setChange(null); setBusy(false); setDraft(null); setError(null)
    const off = onResourceDenied(() => { request.current?.abort(); setChange(null); setDraft(null) })
    return () => {
      off(); request.current?.abort(); request.current = null
      const kept = workspaceDrafts.get(target, path)
      if (kept?.status === 'saving') { kept.fail('RPC_ABORTED'); workspaceDrafts.changed() }
      workspaceDrafts.release(target, path)
    }
  }, [identity])
  const act = async kind => {
    if (!draft || workspaceDrafts.get(target, path) !== draft || !usable() || request.current) return
    if (kind === 'save' && (!context.access.write || !root.writable || !reader.value?.editable || draft.receipt?.rootId !== root.rootId)) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(null); setChange(null)
    let sent
    try {
      const payload = kind === 'save' ? draft.begin(crypto.randomUUID()) : draft.query()
      sent = draft.submission; workspaceDrafts.changed()
      const endpoint = kind === 'save' ? 'extra-workspace-save' : kind === 'query' ? 'extra-workspace-save-status' : 'extra-workspace-change'
      const raw = await call(endpoint, payload, controller.signal)
      if (!usable() || request.current !== controller || controller.signal.aborted || draft.submission !== sent) { if (kind === 'save') { draft.fail('RPC_ABORTED'); workspaceDrafts.changed() }; return }
      if (kind === 'change') setChange(savedChange(raw, draft))
      else { draft.result(raw); workspaceDrafts.changed() }
    } catch (failure) {
      if (kind === 'save' && sent) { draft.fail(errorCode(failure)); workspaceDrafts.changed() }
      if (!usable() || request.current !== controller) return
      setError(kind === 'save' && draft.status === 'unknown' ? '请求可能已被服务器执行；请查询原回执，不能重新提交。' : resourceFailure(failure))
      if (resourceAccessFailure(failure)) rejectResourceReads()
    } finally { if (request.current === controller) { request.current = null; setBusy(false) } }
  }
  const copy = async () => {
    if (!draft || !usable()) return
    const ok = await writeClipboard(draft.text)
    if (usable() && !ok) setError('复制未成功，请选择编辑内容手动复制。')
  }
  const canSave = draft?.status === 'editing' && draft.dirty && context.access.write && reader.value?.editable && draft.receipt?.rootId === root.rootId && Date.now() < root.expiresAt
  return h('div', { ref: node, className: 'deck-workspace-editor' },
    h('div', { className: 'deck-resource-heading' }, h('strong', null, `编辑 · ${path}`), h('button', { type: 'button', className: 'bt-soft', onClick: onClose }, '收起编辑')),
    h('p', { className: 'deck-resource-note' }, '按服务器版本与单次回执保存。外部程序并发写入的最后竞争窗口仍取决于服务器后端；未保存内容仅保留在本次客户端内存。'),
    h(ReadState, { reader }), error ? h('p', { className: 'deck-resource-error', role: 'alert' }, error) : null,
    draft && workspaceDrafts.get(target, path) === draft && available ? h('div', null,
      h('p', { className: 'deck-resource-note', role: 'status' }, STATUS[draft.status], ` · ${draft.newline === '\r\n' ? 'CRLF' : 'LF'}`),
      h('textarea', { className: 'deck-workspace-input', value: draft.text.replace(/\r\n/g, '\n'), spellCheck: false, 'aria-label': `${path} 的未保存编辑`,
        onChange: event => { try { draft.edit(event.target.value); workspaceDrafts.changed(); setError(null) } catch (failure) { setError(failure.message) } } }),
      h('div', { className: 'deck-resource-heading' },
        h('button', { type: 'button', className: 'bt-soft', disabled: busy || reader.busy || !canSave, onClick: () => { void act('save') } }, '保存到服务器'),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => { void copy() } }, '复制本地编辑'),
        draft.submission && draft.unresolved ? h('button', { type: 'button', className: 'bt-soft', disabled: busy, onClick: () => { void act('query') } }, '查询原保存结果') : null,
        !draft.unresolved ? h('button', { type: 'button', className: 'bt-soft', disabled: busy || reader.busy, onClick: reader.reload }, '重读当前文件并比较') : null,
        draft.status === 'saved' ? h('button', { type: 'button', className: 'bt-soft', disabled: busy, onClick: () => { void act('change') } }, '查看本次实际修改') : null),
      draft.comparison ? h('div', { className: 'deck-resource-confirm' },
        h('strong', null, '服务器文件或工作区根已变化；下方是重新读取的当前版本，你的编辑保留在上方。'), h('pre', null, draft.comparison.file.text),
        h('button', { type: 'button', className: 'bt-soft', disabled: busy || !context.access.write, onClick: () => {
          try { draft.bind(draft.comparison.root, draft.comparison.file, true); workspaceDrafts.changed() } catch (failure) { setError(resourceFailure(failure)) }
        } }, '已比较，以此版本为新基线')) : null,
      change ? h('div', null, h('strong', null, '来源：本次服务器保存结果'),
        !change.complete ? h('p', { className: 'deck-resource-note' }, '服务器未保留完整前后文本。') : null,
        change.redacted ? h('p', { className: 'deck-resource-note' }, '修改记录包含已遮盖内容。') : null,
        h('div', { className: 'deck-change-columns' }, h('section', null, h('strong', null, '保存前'), h('pre', null, change.before ?? '旧文本不可用')),
          h('section', null, h('strong', null, '保存后'), h('pre', null, change.after ?? '新文本不可用')))) : null) : null)
}
export function WorkspaceDraftShelf() {
  const context = useResourceContext('workspace'); const node = useRef(null)
  useDrafts()
  const [chosen, setChosen] = useState(null); const [discard, setDiscard] = useState(null); const [error, setError] = useState(null)
  const [deniedEpoch, setDeniedEpoch] = useState(null)
  const permitted = context.available && deniedEpoch !== context.epoch
  const drafts = workspaceDrafts.list(); const selected = drafts.find(item => draftKey(item.target, item.path) === chosen)
  useLayoutEffect(() => onResourceDenied(() => { setDeniedEpoch(context.epoch); setChosen(null); setDiscard(null); setError(null) }), [context.epoch])
  useLayoutEffect(() => { if (!permitted) { setChosen(null); setDiscard(null); setError(null) } }, [permitted])
  if (drafts.length === 0) return null
  const copy = async () => {
    if (!selected || !permitted || !visible(node.current)) return
    const ok = await writeClipboard(selected.text)
    if (!ok && visible(node.current)) setError('复制失败，请手动选择内容。')
  }
  return h('details', { ref: node, className: 'deck-draft-shelf' }, h('summary', null, `${drafts.length} 份未保存或待确认的文件编辑`),
    !permitted ? h('div', null,
      h('p', { className: 'deck-resource-note' }, '本地编辑仍保留，恢复该服务器连接与文件读取授权后可查看。访问被拒绝时，请重新连接后核对。'),
      h('button', { type: 'button', className: 'bt-soft', onClick: () => setDiscard('all') }, '丢弃本服务器的本地编辑'),
      discard === 'all' ? h('div', { className: 'deck-resource-confirm' }, h('p', null, '确认丢弃本服务器全部本地编辑？这不会撤销已经发出的服务器保存。'),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => { for (const item of workspaceDrafts.list()) workspaceDrafts.discard(item.target, item.path); setDiscard(null) } }, '确认全部丢弃'),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => setDiscard(null) }, '取消')) : null) : h('div', null,
      h('p', { className: 'deck-resource-note' }, '在原会话重新打开文件可继续编辑；旧会话内容可复制取回。此处不发送保存请求。'),
      h('select', { value: chosen ?? '', onChange: event => { setChosen(event.target.value); setDiscard(null) }, 'aria-label': '未保存的文件编辑' },
        h('option', { value: '' }, '选择文件'), drafts.map(item => h('option', { key: draftKey(item.target, item.path), value: draftKey(item.target, item.path) }, `${item.path} · ${item.target.sessionId}`))),
      selected ? h('div', null, h('p', { className: 'deck-resource-note' }, STATUS[selected.status]), h('textarea', { readOnly: true, value: selected.text, className: 'deck-workspace-input', 'aria-label': '取回本地编辑' }),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => { void copy() } }, '复制本地编辑'),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => setDiscard(chosen) }, '丢弃本地内容'),
        discard === chosen ? h('div', { className: 'deck-resource-confirm' }, h('p', null, selected.unresolved ? '确认丢弃本地内容？服务器写入仍可能完成，丢弃不会撤销它。' : '确认丢弃这份未保存的编辑？'),
          h('button', { type: 'button', className: 'bt-soft', onClick: () => { workspaceDrafts.discard(selected.target, selected.path); setChosen(null); setDiscard(null) } }, '确认丢弃'),
          h('button', { type: 'button', className: 'bt-soft', onClick: () => setDiscard(null) }, '取消')) : null) : null,
      error ? h('p', { className: 'deck-resource-error' }, error) : null))
}
