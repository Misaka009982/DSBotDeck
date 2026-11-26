// SPDX-License-Identifier: Apache-2.0
// 参数与输出只读、按页展示；关闭、缓存、隐藏或权限变化均释放正文和请求。
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { writeClipboard } from '@dsbot/ui/primitives.js'
import { DetailReadQueue } from '../shared/extra-read-model.ts'
import { errorCode } from '../shared/validation.ts'
import { argumentPresentation } from '../shared/tool-display.ts'
import { appendDetailPage, detailPage, keepDetailOnFailure, toolDetailFailure } from '../shared/tool-detail.ts'
const queue = new DetailReadQueue()
const fresh = () => document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached')
export function useDetailAvailability() {
  const [available, setAvailable] = useState(fresh)
  useEffect(() => {
    const update = () => setAvailable(fresh())
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-deck-cached'] })
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
  return available
}
export function useToolDetail({ tool, scope, field, fullMessages, enabled, node, allowed = () => true, onDenied = () => {} }) {
  const reference = tool.reference
  const key = JSON.stringify([reference, scope.sessionId ?? null, scope.botId ?? null, scope.taskId ?? null, scope.roomId ?? null, fullMessages, field])
  const empty = () => ({ key, busy: false, value: null, error: null })
  const [state, setState] = useState(empty)
  const request = useRef(null); const latest = useRef(null); const preview = useRef(null)
  latest.current = { key, enabled }
  const usable = () => latest.current?.key === key && latest.current.enabled && reference !== null && fresh() && allowed()
    && node.current?.isConnected && !node.current.closest('[data-leaving]')
  const cancel = () => { request.current?.abort(); request.current = null; preview.current = null }
  const load = async (offset = 0, digest) => {
    if (!usable() || request.current !== null) return
    const previous = offset === 0 ? null : preview.current
    if (offset > 0 && (!previous?.available || previous.previewLimited || previous.nextOffset !== offset || previous.digest !== digest)) return
    if (offset === 0) preview.current = null
    const controller = new AbortController(); request.current = controller
    setState(current => ({ ...current, key, busy: true, error: null, ...(offset === 0 ? { value: null } : {}) }))
    try {
      const payload = { sessionId: reference.sessionId, callId: reference.callId, field, fullMessages,
        ...(reference.callSeq === undefined ? {} : { callSeq: reference.callSeq }),
        ...(scope.roomId ? { roomId: scope.roomId } : {}),
        ...(scope.botId && scope.taskId ? { botId: scope.botId, taskId: scope.taskId } : {}),
        ...(offset > 0 ? { offset } : {}), ...(digest === undefined ? {} : { digest }) }
      const raw = await queue.read(() => call('extra-tool-detail', payload, controller.signal), controller.signal, usable)
      if (request.current !== controller || controller.signal.aborted || !usable()) return
      const value = appendDetailPage(previous, detailPage(raw, reference, field, offset, digest))
      preview.current = value
      setState({ key, value, busy: false, error: null })
    } catch (error) {
      if (request.current !== controller || controller.signal.aborted || latest.current?.key !== key || !latest.current.enabled) return
      const value = usable() && keepDetailOnFailure(error) ? preview.current : null
      preview.current = value
      setState({ ...empty(), value, error: toolDetailFailure(error) })
      if (['bot/refused', 'HTTP_401', 'HTTP_403', 'bot/incompatible'].includes(errorCode(error))) onDenied(toolDetailFailure(error))
    } finally { if (request.current === controller) request.current = null }
  }
  useLayoutEffect(() => {
    cancel(); setState(empty())
    if (enabled && reference) void load()
    return cancel
  }, [key, enabled, field === 'output' ? tool.outcome : null])
  const current = state.key === key && enabled ? state : empty()
  const value = current.value
  return { ...current, usable, canCopy: page => usable() && preview.current === page && page?.available && request.current === null,
    reload: () => { cancel(); setState(empty()); void load() },
    next: () => { if (value?.available && !value.previewLimited && value.nextOffset !== null) void load(value.nextOffset, value.digest) } }
}
export function ToolDetailField({ reader, field, name = null }) {
  const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState(null)
  const copyRevision = useRef(0)
  const page = reader.value
  const more = page?.available && !page.previewLimited && page.nextOffset !== null
  const presentation = page?.available && field === 'arguments' ? argumentPresentation(name, page.text, !page.previewLimited && page.nextOffset === null) : null
  const shown = presentation?.text ?? (page?.available ? page.text : '')
  useEffect(() => { setCopied(false); setCopyError(null); copyRevision.current += 1 }, [page])
  useEffect(() => () => { copyRevision.current += 1 }, [])
  const copy = async (full = false) => {
    if (!reader.canCopy(page)) return
    const revision = ++copyRevision.current
    const ok = await writeClipboard(full || presentation?.compact ? page.text : shown)
    if (revision !== copyRevision.current || !reader.canCopy(page)) return
    setCopied(ok); setCopyError(ok ? null : '复制未成功，请手动选择正文复制。')
  }
  return h('section', { className: 'deck-tool-field', 'aria-label': presentation?.title ?? (field === 'arguments' ? '参数' : '输出') },
    h('div', { className: 'deck-tool-section' }, presentation?.title ?? (field === 'arguments' ? '参数' : '输出')),
    reader.busy ? h('span', { role: 'status', className: 'deck-tool-limit' }, '正在读取…') : null,
    reader.error ? h('p', { role: 'alert', className: 'deck-tool-error' }, reader.error, page?.available ? ' 已读内容仍保留。' : '',
      h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: more ? reader.next : reader.reload }, more ? '重试下一段' : '重新读取首段')) : null,
    page && !page.available ? h('p', { className: 'deck-tool-limit' }, page.reason) : null,
    page?.available ? h('div', null,
      h('div', { className: 'md-code deck-tool-code' },
        h('button', { type: 'button', className: 'md-copy', disabled: reader.busy, onClick: () => { void copy() } }, copied ? '已复制' : presentation?.title === '命令' ? '复制命令' : '复制已读内容'),
        h('pre', { className: presentation?.compact ? 'deck-tool-params' : undefined }, shown === '' ? '（服务器返回空文本）' : shown)),
      presentation?.extra ? h('div', { className: 'deck-tool-extra' }, h('span', { className: 'deck-tool-section' }, '其他参数'), h('pre', null, presentation.extra)) : null,
      presentation?.title === '命令' ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => { void copy(true) } }, '复制完整参数') : null,
      page.previewLimited ? h('p', { role: 'status', className: 'deck-tool-limit' }, '已达到 128 Ki 字符显示上限，仅保留已读开头，内容不完整；更多内容请在服务器原会话查看。') : null,
      h('div', { className: 'deck-tool-pages' },
        h('span', null, `${field === 'arguments' ? '参数' : '输出'} · 已读 ${page.text.length} / ${page.totalChars} 字符`),
        more ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: reader.next }, '下一段') : null),
      copyError ? h('p', { className: 'deck-tool-error', role: 'alert' }, copyError) : null) : null)
}
