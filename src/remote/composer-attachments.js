// SPDX-License-Identifier: Apache-2.0
// 附件只来自用户的选择、拖入或粘贴；跨聊天保留在本服务器视图内存中。
import { createElement as h, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { call } from '@dsbot/client/api.js'
import { CloseIcon, PaperclipIcon } from '@dsbot/client/icons.js'
import { AttachmentBatch, attachmentCapability, attachmentKey, attachmentMetadata, attachmentTarget } from '../shared/attachment-model.ts'
import { ResourceContext } from './resource-read.js'
import { draftPresence } from './draft-presence.js'
const drafts = new Map()
const listeners = new Set()
let revision = 0
const changed = () => { revision += 1; draftPresence('attachments', drafts.size > 0); for (const listener of listeners) listener() }
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const bytesLabel = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`
export function useComposerAttachments({ sessionId, field, disabled, onSend, onError, setText }) {
  useSyncExternalStore(subscribe, () => revision)
  const context = useContext(ResourceContext)
  const target = attachmentTarget(context.roster, sessionId)
  const key = target ? attachmentKey(target) : null
  const supported = attachmentCapability(context.roster?.extras)
  const batch = drafts.get(key)
  const latest = useRef(null); const request = useRef(null); const outgoing = useRef(null); const mounted = useRef(true)
  const [confirm, setConfirm] = useState(false)
  latest.current = { context, key, target, supported, disabled }
  const available = () => {
    const current = latest.current
    return mounted.current && !current.disabled && !current.context.cached && current.context.roster?.readOnly == null && current.key === key
      && current.target?.sessionId === sessionId && current.context.selection === sessionId && field.current?.isConnected
      && !document.body.hasAttribute('data-deck-cached') && document.visibilityState === 'visible' && !field.current.matches(':disabled')
  }
  // 提交已经开始时保留原请求结算；只在上传阶段因导航/断线停止后续分片。
  const cancelRead = () => { if (outgoing.current?.phase !== 'sending') request.current?.abort() }
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; cancelRead() }
  }, [])
  useLayoutEffect(() => { if (context.cached || disabled || context.roster?.readOnly != null) cancelRead() }, [context.cached, context.epoch, disabled, context.roster?.readOnly])
  useLayoutEffect(() => {
    if (batch?.text && ['draft', 'failed', 'unknown'].includes(batch.phase)) setText(value => value === '' ? batch.text : value)
  }, [key, batch?.phase])
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== 'visible') cancelRead() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  const add = files => {
    if (!available() || files.length === 0) return
    try {
      if (!supported) throw new Error('服务器尚不支持文件附件，请升级到支持聊天附件的增补版本。')
      if (batch && batch.target.sessionId !== sessionId) throw new Error('会话已换段，请先处理下方原会话的附件。')
      if (!batch && drafts.size >= 8) throw new Error('最多为 8 个聊天保留附件，请先发送或移除已有附件。')
      const total = [...drafts.values()].reduce((sum, item) => sum + item.size, 0) + files.reduce((sum, file) => sum + file.size, 0)
      if (total > 64 * 1024 * 1024) throw new Error('本服务器未发送附件合计超过 64 MiB，请先处理已有附件。')
      const current = batch ?? new AttachmentBatch(target)
      current.add(files); drafts.set(key, current); changed(); onError(null)
    } catch (error) { onError(error.message) }
  }
  const run = async operation => {
    if (!available() || request.current) throw new Error('当前聊天不可操作。')
    const controller = new AbortController(); request.current = controller
    try { await operation(controller.signal) }
    finally { if (request.current === controller) request.current = null }
  }
  const send = async text => {
    const current = drafts.get(key)
    if (!current?.files.length) return false
    if (!available() || !supported || current.target.sessionId !== sessionId || current.locked) throw new Error('原会话附件仍待处理或发送结果未知，请先核对。')
    const epoch = context.epoch
    outgoing.current = current
    await run(async signal => {
      const files = current.files.map(attachmentMetadata)
      await onSend(text, () => current.send(call, text, crypto.randomUUID(), () => available() && latest.current.context.epoch === epoch, signal, changed),
        files.filter(file => file.kind === 'file').map(file => ({ name: file.name, bytes: file.size })), files.filter(file => file.kind === 'image').length)
    })
    if (current.phase === 'sent') { drafts.delete(key); changed() }
    return true
  }
  const query = async () => {
    try {
      outgoing.current = null
      await run(signal => batch.query(call, signal, changed))
      if (batch.phase === 'sent') { setText(value => value.trim() === batch.text ? '' : value); drafts.delete(key); changed() }
    } catch (error) { if (mounted.current) onError(error.message) }
  }
  const removeAll = () => { if (batch?.phase === 'uploading' || batch?.phase === 'sending') return; drafts.delete(key); setConfirm(false); changed() }
  const input = h('input', { type: 'file', multiple: true, hidden: true, disabled: disabled || batch?.locked || false, onChange: event => {
    const files = [...(event.target.files ?? [])]; event.target.value = ''; add(files)
  } })
  const onPaste = event => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); add(files) } }
  const onDragOver = event => { if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = available() ? 'copy' : 'none' } }
  const onDrop = event => { if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) { event.preventDefault(); event.stopPropagation(); add([...(event.dataTransfer.files ?? [])]) } }
  const differentPart = batch && batch.target.sessionId !== sessionId
  const content = batch ? h('div', { className: 'deck-attachment-rail', role: 'group', 'aria-label': '待发送附件' },
    batch.files.map((file, index) => h('div', { className: 'deck-attachment-file', key: index }, h(PaperclipIcon, { size: 14 }),
      h('span', { title: file.name }, file.name), h('small', null, bytesLabel(file.size)),
      h('button', { type: 'button', className: 'bt-soft', disabled: batch.locked, 'aria-label': `移除 ${file.name}`, onClick: () => { batch.remove(index); if (!batch.files.length) drafts.delete(key); changed() } }, h(CloseIcon, { size: 12 })))),
    h('p', { className: 'deck-attachment-note', role: 'status' }, batch.phase === 'uploading' ? `上传附件 ${bytesLabel(batch.sentBytes)} / ${bytesLabel(batch.size)}` : batch.phase === 'sending' ? '正在提交消息…' : batch.message ?? '最多 8 个文件，单文件 16 MiB，合计 32 MiB。点击发送后上传。'),
    differentPart ? h('p', { className: 'deck-attachment-note' }, '会话已换段，附件仍绑定原会话。', !batch.locked ? h('button', { type: 'button', className: 'bt-soft', onClick: () => {
      if (!available()) return
      const next = new AttachmentBatch(target); next.add(batch.files); next.text = batch.text; drafts.set(key, next); changed()
    } }, '将附件放入当前会话') : null) : null,
    batch.phase === 'unknown' ? h('div', { className: 'deck-attachment-actions' },
      h('button', { type: 'button', className: 'bt-soft', onClick: () => { void query() } }, '查询原发送结果'),
      h('button', { type: 'button', className: 'bt-soft', onClick: () => setConfirm(true) }, '清除本地待确认记录'),
      confirm ? h('div', null, h('p', null, '请先核对聊天记录。清除本地记录不会撤销服务器可能已收到的消息。'),
        h('button', { type: 'button', className: 'bt-soft', onClick: removeAll }, '已核对，清除本地记录'),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => setConfirm(false) }, '取消')) : null) : null) : null
  return { input, content, send, hasFiles: Boolean(batch?.files.length), blocked: Boolean(batch?.locked || differentPart), onPaste, onDragOver, onDrop }
}
export function AttachmentDraftShelf() {
  useSyncExternalStore(subscribe, () => revision)
  const [confirm, setConfirm] = useState(null)
  if (!drafts.size) return null
  return h('details', { className: 'deck-draft-shelf' }, h('summary', null, `${drafts.size} 个聊天有附件或待确认消息`),
    h('p', { className: 'deck-resource-note' }, '回到对应聊天可继续发送或查询结果。附件只保留在本次客户端内存。'),
    [...drafts.entries()].map(([key, batch]) => h('div', { key },
      h('p', null, batch.files.map(file => file.name).join('、')),
      h('button', { type: 'button', className: 'bt-soft', disabled: ['uploading', 'sending'].includes(batch.phase), onClick: () => setConfirm(key) }, '丢弃本地附件记录'),
      confirm === key ? h('div', null, h('p', null, '确认丢弃这些本地附件及待确认记录？已经提交的消息不会撤销，请先核对聊天。'),
        h('button', { type: 'button', className: 'bt-soft', disabled: ['uploading', 'sending'].includes(batch.phase), onClick: () => { if (['uploading', 'sending'].includes(batch.phase)) return; drafts.delete(key); setConfirm(null); changed() } }, '确认丢弃'),
        h('button', { type: 'button', className: 'bt-soft', onClick: () => setConfirm(null) }, '取消')) : null)))
}
export function UserAttachments({ files }) {
  if (!Array.isArray(files)) return null
  return h('span', { className: 'deck-user-files', 'data-text-interaction-exclude': '' }, files.slice(0, 32).map((file, index) =>
    h('span', { key: index, className: 'deck-user-file' }, h(PaperclipIcon, { size: 14 }), typeof file?.name === 'string' ? file.name.slice(0, 200) : '文件',
      Number.isSafeInteger(file?.bytes) && file.bytes >= 0 ? h('small', null, bytesLabel(file.bytes)) : null)))
}
