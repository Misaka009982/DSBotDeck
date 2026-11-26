// SPDX-License-Identifier: Apache-2.0
// 面板共用原配对链路；正文只留在当前可见、获授权的读取上下文中。
import { createContext, createElement as h, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { moduleAccess, moduleAccessText, resourceAccessFailure, resourceFailure, resourcePermissions, ScopedResourceRead } from '../shared/resource-model.ts'
import { useDetailAvailability } from './tool-detail.js'

export const ResourceContext = createContext({ roster: null, cached: true, epoch: 0, selection: null })
// 模块实例位于隔离的服务器视图；任一授权拒绝清空同视图的全部资源正文，不自动重试。
const denials = new EventTarget()
export function rejectResourceReads() { denials.dispatchEvent(new Event('refused')) }
export function onResourceDenied(listener) { denials.addEventListener('refused', listener); return () => denials.removeEventListener('refused', listener) }
export function useResourceContext(module) {
  const context = useContext(ResourceContext)
  const visible = useDetailAvailability()
  const access = moduleAccess(context.roster?.extras, module)
  return { ...context, access, available: visible && !context.cached && access.state === 'ready',
    boundary: JSON.stringify([context.epoch, context.selection, context.cached, visible, resourcePermissions(context.roster?.extras)]),
    reason: !visible || context.cached ? '缓存或隐藏期间不读取资源正文。' : moduleAccessText(access) }
}
export function useResourceRead({ identity, enabled, node, read, merge = (_previous, next) => next }) {
  const lease = useMemo(() => new ScopedResourceRead(), [])
  const version = useRef(0); const latest = useRef(null); const preview = useRef(null)
  latest.current = { identity, enabled }
  const empty = () => ({ identity, value: null, busy: false, error: null })
  const [state, setState] = useState(empty)
  const usable = () => latest.current?.identity === identity && latest.current.enabled && document.visibilityState === 'visible'
    && !document.body.hasAttribute('data-deck-cached') && node.current?.isConnected && !node.current.closest('[data-leaving]')
  const load = async cursor => {
    if (!usable() || lease.busy) return
    const generation = version.current
    const previous = cursor == null ? null : preview.current
    if (cursor != null && previous === null) return
    if (previous === null) preview.current = null
    setState(current => ({ ...current, identity, value: previous, busy: true, error: null }))
    try {
      const next = await lease.read(signal => read(cursor, signal), usable)
      if (version.current !== generation || !usable()) return
      const value = merge(previous, next)
      preview.current = value
      setState({ identity, value, busy: false, error: null })
    } catch (error) {
      if (version.current !== generation || latest.current?.identity !== identity) return
      if (resourceAccessFailure(error)) { rejectResourceReads(); return }
      // 拒绝、坏页和断线不保留敏感旧正文，也不自动换接口或重发。
      preview.current = null
      setState({ ...empty(), error: resourceFailure(error) })
    }
  }
  const clear = () => { version.current += 1; lease.cancel(); preview.current = null }
  useLayoutEffect(() => {
    clear(); setState(empty())
    const refused = () => { clear(); setState({ ...empty(), error: resourceFailure({ code: 'bot/refused' }) }) }
    denials.addEventListener('refused', refused)
    if (enabled) void load()
    return () => { denials.removeEventListener('refused', refused); clear() }
  }, [identity, enabled])
  return { ...(state.identity === identity && enabled ? state : empty()), usable,
    canCopy: value => usable() && value !== null && preview.current === value && !lease.busy,
    reload: () => { clear(); setState(empty()); void load() }, more: cursor => { if (cursor != null) void load(cursor) } }
}
export function ReadState({ reader }) {
  return h('div', { className: 'deck-resource-read-state' },
    reader.busy ? h('p', { role: 'status', className: 'deck-resource-note' }, '正在读取…') : null,
    reader.error ? h('p', { role: 'alert', className: 'deck-resource-error' }, reader.error,
      h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: reader.reload }, '重新读取')) : null)
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
