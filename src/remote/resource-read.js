// SPDX-License-Identifier: Apache-2.0
// 面板共用原配对链路；工作区可显式保留只读快照，请求有效性仍逐次核对。
import { createContext, createElement as h, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { moduleAccess, moduleAccessText, resourceAccessFailure, resourceFailure, resourcePermissions, ScopedResourceRead } from '../shared/resource-model.ts'
import { useDetailAvailability } from './tool-detail.js'
import { errorCode } from '../shared/validation.ts'

export const ResourceContext = createContext({ roster: null, cached: true, epoch: 0, selection: null })
// 模块实例位于隔离的服务器视图；任一授权拒绝清空同视图的全部资源正文，不自动重试。
const denials = new EventTarget()
export function rejectResourceReads() { denials.dispatchEvent(new Event('refused')) }
export function onResourceDenied(listener) { denials.addEventListener('refused', listener); return () => denials.removeEventListener('refused', listener) }
export function useResourceContext(module) {
  const context = useContext(ResourceContext)
  const visible = useDetailAvailability()
  const rawAccess = moduleAccess(context.roster?.extras, module)
  const access = { ...rawAccess, write: rawAccess.write && !context.roster?.readOnly }
  return { ...context, access, available: visible && !context.cached && access.state === 'ready',
    boundary: JSON.stringify([context.epoch, context.selection, context.cached, visible, context.roster?.readOnly, resourcePermissions(context.roster?.extras)]),
    reason: !visible || context.cached ? '缓存或隐藏期间不读取资源正文。' : moduleAccessText(access) }
}
export function useResourceRead({ identity, enabled, node, read, merge = (_previous, next) => next, retain = false, epoch = 0 }) {
  const lease = useMemo(() => new ScopedResourceRead(), [])
  const version = useRef(0); const latest = useRef(null); const preview = useRef(null); const denied = useRef(false)
  latest.current = { identity, enabled, epoch }
  const empty = () => ({ identity, value: null, busy: false, error: null, epoch, stale: true })
  const [state, setState] = useState(empty)
  const usable = () => latest.current?.identity === identity && latest.current.epoch === epoch && latest.current.enabled && document.visibilityState === 'visible'
    && !document.body.hasAttribute('data-deck-cached') && node.current?.isConnected && !node.current.closest('[data-leaving]')
  const load = async cursor => {
    if (!usable() || lease.busy) return
    const generation = version.current
    const previous = cursor == null ? null : preview.current
    if (cursor != null && previous === null) return
    const displayed = retain ? preview.current : previous
    if (!retain && previous === null) preview.current = null
    setState(current => ({ ...current, identity, value: displayed, busy: true, error: null }))
    try {
      const next = await lease.read(signal => read(cursor, signal), usable)
      if (version.current !== generation || !usable()) return
      const value = merge(previous, next)
      preview.current = value
      setState({ identity, value, busy: false, error: null, epoch, stale: false })
    } catch (error) {
      if (version.current !== generation || latest.current?.identity !== identity) return
      if (resourceAccessFailure(error)) { rejectResourceReads(); return }
      const interrupted = ['RPC_ABORTED', 'RPC_TIMEOUT', 'bot/read-only', 'TRANSPORT_CLOSED', 'SERVER_UNREACHABLE', 'HOST_OFFLINE', 'HOST_UNREACHABLE'].includes(errorCode(error))
      // 只保留已验证的工作区快照；失效、坏页或真实拒绝仍不能继续显示旧正文。
      if (!retain || !interrupted) preview.current = null
      setState({ ...empty(), value: preview.current, error: resourceFailure(error) })
    }
  }
  const cancel = () => { version.current += 1; lease.cancel() }
  const clear = () => { cancel(); preview.current = null }
  useLayoutEffect(() => {
    clear(); denied.current = false; setState(empty())
    const refused = () => { clear(); denied.current = true; setState({ ...empty(), error: resourceFailure({ code: 'bot/refused' }) }) }
    denials.addEventListener('refused', refused)
    return () => { denials.removeEventListener('refused', refused); clear() }
  }, [identity])
  useLayoutEffect(() => {
    cancel()
    if (retain) setState(value => ({ ...value, busy: false, stale: true }))
    else { preview.current = null; setState(empty()) }
    // 已读快照在恢复时由用户显式刷新，避免阅读途中替换正文；没有快照时才自动读取。
    if (enabled && (!retain || preview.current === null && !denied.current)) void load()
    return cancel
  }, [identity, enabled, epoch, retain])
  const current = state.identity === identity && (enabled || retain) ? state : empty()
  const stale = current.stale || current.epoch !== epoch || !enabled
  return { ...current, stale, usable,
    canCopy: value => usable() && value !== null && preview.current === value && !lease.busy,
    reload: () => { if (!usable()) return; cancel(); denied.current = false; if (!retain) { preview.current = null; setState(empty()) }; void load() },
    more: cursor => { if (cursor != null && (!retain || !stale)) void load(cursor) } }
}
export function ReadState({ reader, enabled = true }) {
  return h('div', { className: 'deck-resource-read-state' },
    reader.busy ? h('p', { role: 'status', className: 'deck-resource-note' }, '正在读取…') : null,
    reader.error ? h('p', { role: 'alert', className: 'deck-resource-error' }, reader.error,
      h('button', { type: 'button', className: 'bt-soft', disabled: !enabled || reader.busy, onClick: reader.reload }, '重新读取')) : null)
}
export function ResourcePanel({ title, children, onClose }) {
  const node = useRef(null)
  useEffect(() => {
    const previous = document.activeElement; const panel = node.current
    panel?.focus()
    return () => { if (previous?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus() }
  }, [])
  return h('section', { ref: node, className: 'deck-resource-pane', role: 'region', 'aria-label': title, tabIndex: -1,
    onKeyDown: event => { if (event.key === 'Escape' && !event.target.closest('.deck-terminal-screen') && !event.nativeEvent?.isComposing) { event.stopPropagation(); onClose() } } },
    h('div', { className: 'deck-resource-heading' }, h('strong', null, title), h('button', { type: 'button', className: 'bt-soft', onClick: onClose, 'aria-label': `关闭${title}` }, '关闭')),
    children)
}
