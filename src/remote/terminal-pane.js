// SPDX-License-Identifier: Apache-2.0
// 仅呈现插件创建的服务器用户 PTY；不启动本机进程，也不接管 Agent 终端。
import { createElement as h, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { call } from '@dsbot/client/api.js'
import { currentResourceSession, resourceAccessFailure, resourceFailure, ScopedResourceRead } from '../shared/resource-model.ts'
import { TerminalControl, terminalClosed, terminalCreated, terminalDimensions, terminalInput, terminalList, terminalPage, TERMINAL_STATUSES } from '../shared/terminal-model.ts'
import { onResourceDenied, rejectResourceReads, ReadState, useResourceContext, useResourceRead } from './resource-read.js'
import '@xterm/xterm/css/xterm.css'

// 只保留未确认操作的身份与序号，不保留输入正文；重开面板也不能重放旧输入。
const controls = new Map()
function controllerOf(handle) {
  const previous = controls.get(handle.terminalId)
  if (previous?.handleId === handle.handleId) { previous.observe(handle); return previous }
  if (!previous && controls.size >= 256) throw new Error('本视图终端状态达到上限，请先明确关闭旧终端。')
  const control = new TerminalControl(handle)
  if (previous && previous.state !== 'ready') control.uncertain()
  controls.set(handle.terminalId, control)
  return control
}
const visible = node => document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached') && node?.isConnected && !node.closest('[data-leaving]')
function writeFrame(terminal, bytes, signal) {
  return new Promise(resolve => {
    const done = () => { signal.removeEventListener('abort', done); resolve() }
    if (signal.aborted) { done(); return }
    signal.addEventListener('abort', done, { once: true })
    terminal.write(bytes, done)
  })
}
function TerminalScreen({ handle }) {
  const context = useResourceContext('terminals'); const node = useRef(null); const active = useRef(null); const actions = useRef(null)
  const [view, setView] = useState(handle); const [error, setError] = useState(null); const [notice, setNotice] = useState(null)
  const [controlState, setControlState] = useState('ready'); const [retry, setRetry] = useState(0)
  const identity = JSON.stringify([context.boundary, handle.handleId, retry])
  active.current = { identity, available: context.available, write: context.access.write }
  useLayoutEffect(() => {
    setView(handle); setError(null); setNotice(null)
    if (!context.available || !node.current) return
    let alive = true; let timer; let offset = 0; let queued = ''; let resize = null; let sending = false; let halted = false; let disposed = false
    const controller = new AbortController(); const lease = new ScopedResourceRead(); const fit = new FitAddon()
    let control
    try { control = controllerOf(handle) } catch { setError('本视图的终端状态预算已满，请先明确关闭旧终端。'); return }
    const current = () => alive && active.current.identity === identity && active.current.available && visible(node.current) && Date.now() < handle.expiresAt
    const writeAllowed = () => current() && active.current.write && !halted
    const terminal = new Terminal({ cols: handle.cols, rows: handle.rows, scrollback: 1500, disableStdin: true, cursorBlink: false,
      fontSize: 13, screenReaderMode: true, logLevel: 'off', windowOptions: {}, altClickMovesCursor: false,
      linkHandler: { activate: () => {}, allowNonHttpProtocols: false } })
    terminal.loadAddon(fit); terminal.open(node.current)
    const subscriptions = [0, 1, 2, 8, 52, 1337].map(id => terminal.parser.registerOscHandler(id, () => true))
    subscriptions.push(terminal.parser.registerCsiHandler({ final: 't' }, () => true))
    const paintControl = () => {
      if (!alive || halted) return
      terminal.options.disableStdin = !writeAllowed() || !control.acceptsInput
      setControlState(control.state)
    }
    const disposeTerminal = () => { if (!disposed) { disposed = true; for (const item of subscriptions) item.dispose(); terminal.dispose() } }
    const stopReading = message => {
      halted = true; queued = ''; resize = null; lease.cancel(); clearTimeout(timer)
      if (control.state === 'sending') control.uncertain()
      controller.abort(); disposeTerminal()
      if (alive) setError(message)
    }
    const offDenied = onResourceDenied(() => stopReading(resourceFailure({ code: 'bot/refused' })))
    const sendQueued = async () => {
      if (sending || !writeAllowed() || !control.canSend) return
      sending = true
      try {
        while (writeAllowed() && control.canSend && (queued || resize)) {
          const data = queued; const dimensions = data ? null : resize
          if (data) queued = ''; else resize = null
          const sequence = control.begin(); paintControl()
          try {
            const raw = await call(data ? 'extra-terminal-input' : 'extra-terminal-resize', { handleId: handle.handleId, sequence,
              ...(data ? { data } : dimensions) }, controller.signal)
            if (!current() || halted || controller.signal.aborted) { control.uncertain(); return }
            control.finish(raw)
            if (control.state !== 'ready') { queued = ''; resize = null; setNotice('上次控制结果待确认，后续排队输入未发送。'); break }
          } catch (failure) {
            control.uncertain(); queued = ''; resize = null
            if (alive) setNotice('输入或尺寸操作结果待确认；没有重发，后续排队输入已停止。')
            if (resourceAccessFailure(failure) && current()) rejectResourceReads()
            break
          }
        }
      } finally { sending = false; paintControl() }
    }
    subscriptions.push(terminal.onData(data => {
      if (!writeAllowed() || !control.acceptsInput) return
      try { queued = terminalInput(queued + data) }
      catch { setNotice('输入超过 16 KiB 或包含不完整字符；本次新增输入未发送。'); return }
      void sendQueued()
    }))
    subscriptions.push(terminal.onBinary(() => { if (current()) setNotice('此鼠标报告使用不支持的二进制编码，未发送；键盘仍可使用。') }))
    const poll = async () => {
      if (!current() || halted) return
      try {
        const raw = await lease.read(signal => call('extra-terminal-read', { handleId: handle.handleId, offset }, signal), signalCurrent)
        if (!current() || halted) return
        const page = terminalPage(raw, handle, offset)
        control.observe(page); setView(page); paintControl()
        if (!control.acceptsInput && (queued || resize)) { queued = ''; resize = null; setNotice('终端已变为不可输入，剩余排队内容没有发送。') }
        if (page.truncated) { terminal.reset(); setNotice('服务器输出缓存已丢失前缀；以下只保留可读尾部，屏幕状态可能不完整。') }
        if (page.cols !== terminal.cols || page.rows !== terminal.rows) terminal.resize(page.cols, page.rows)
        await writeFrame(terminal, page.bytes, controller.signal)
        if (!current() || halted) return
        offset = page.nextOffset
        if (page.outputEnded && ['closed', 'exited', 'failed'].includes(page.status) && offset === page.throughOffset) return
        timer = setTimeout(poll, offset < page.throughOffset ? 50 : 700)
      } catch (failure) {
        if (!current()) return
        if (resourceAccessFailure(failure)) rejectResourceReads()
        else stopReading(resourceFailure(failure))
      }
    }
    const signalCurrent = () => current() && !halted
    const expiry = setTimeout(() => { if (alive) stopReading('终端操作句柄已过期，请刷新目录取得新句柄。') }, Math.max(0, Math.min(600000, handle.expiresAt - Date.now())))
    actions.current = {
      fit: () => {
        if (!writeAllowed() || !control.canSend) return
        const proposed = fit.proposeDimensions()
        if (!proposed || !terminalDimensions(proposed.cols, proposed.rows)) { setNotice('当前可见区域不足以调整终端尺寸。'); return }
        resize = proposed; void sendQueued()
      },
      focus: () => { if (current() && !halted) terminal.focus() },
    }
    paintControl(); void poll()
    return () => {
      alive = false; queued = ''; resize = null; actions.current = null; clearTimeout(timer); clearTimeout(expiry); offDenied(); lease.cancel()
      if (control.state === 'sending') control.uncertain()
      controller.abort(); disposeTerminal()
    }
  }, [identity, context.available])
  return h('div', { className: 'deck-terminal-session' },
    h('div', { className: 'deck-resource-heading' }, h('span', null, TERMINAL_STATUSES[view.status], view.exitCode === null ? '' : ` · 退出码 ${view.exitCode}`),
      h('button', { type: 'button', className: 'bt-soft', disabled: !context.available || !context.access.write || !view.writable || controlState !== 'ready', onClick: () => actions.current?.fit() }, '适配窗口尺寸'),
      h('button', { type: 'button', className: 'bt-soft', disabled: !context.available, onClick: () => setRetry(value => value + 1) }, '重新核对输出')),
    h('p', { className: 'deck-resource-note' }, !context.access.write || !view.writable ? '只读观察，不改变终端输入权。' : controlState === 'unknown' || controlState === 'pending' ? '控制结果待确认，输入暂停；不会重放。' : '输入会发送到服务器本设备创建的终端。'),
    notice ? h('p', { role: 'status', className: 'deck-resource-note' }, notice) : null,
    error ? h('p', { role: 'alert', className: 'deck-resource-error' }, error) : null,
    view.error ? h('p', { className: 'deck-resource-error' }, '服务器报告输出或进程异常，请核对状态；退出码未知时不会推断成功。') : null,
    h('div', { ref: node, className: 'deck-terminal-screen', role: 'group', 'aria-label': '服务器用户终端', onClick: () => actions.current?.focus() }))
}
export function TerminalPane({ target }) {
  const context = useResourceContext('terminals'); const node = useRef(null); const action = useRef(null); const latest = useRef(null)
  const [owned, setOwned] = useState(false); const [selected, setSelected] = useState(null); const [message, setMessage] = useState(null); const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(null)
  const current = currentResourceSession(context.roster, target)
  const boundary = JSON.stringify([context.boundary, target, owned, current])
  latest.current = boundary
  const usable = () => latest.current === boundary && context.available && visible(node.current)
  const reader = useResourceRead({ identity: boundary, enabled: context.available && (owned || current), node,
    read: async (_cursor, signal) => terminalList(await call('extra-terminal-list', owned ? { owned: true } : target, signal), owned ? null : target) })
  useLayoutEffect(() => {
    action.current?.abort(); action.current = null; setBusy(false); setSelected(null); setConfirmClose(null)
    const off = onResourceDenied(() => { action.current?.abort(); setSelected(null); setConfirmClose(null) })
    return () => { off(); action.current?.abort(); action.current = null }
  }, [boundary])
  const mutate = async (endpoint, payload, accept) => {
    if (!usable() || !context.access.write || action.current) return
    const controller = new AbortController(); action.current = controller; setBusy(true); setMessage(null)
    try {
      const result = await call(endpoint, payload, controller.signal)
      if (!usable() || action.current !== controller || controller.signal.aborted) return
      accept(result); reader.reload()
    } catch (error) {
      if (!usable() || action.current !== controller) return
      setMessage(endpoint === 'extra-terminal-create' ? '创建结果待确认；请刷新当前目录或本设备终端目录核对，没有自动再次创建。' : '关闭结果待确认；请刷新本设备终端目录核对，没有自动再次关闭。')
      if (resourceAccessFailure(error)) rejectResourceReads()
    } finally { if (action.current === controller) { action.current = null; setBusy(false) } }
  }
  const list = reader.value?.items ?? []; const chosen = list.find(item => item.terminalId === selected)
  return h('div', { ref: node },
    h('p', { className: 'deck-resource-note' }, '服务器用户终端。关闭面板保留远程进程；明确关闭请进入“本设备终端”。输出可能包含敏感内容。'),
    context.reason ? h('p', { className: 'deck-resource-note' }, context.reason) : null,
    h('div', { className: 'deck-resource-heading' },
      h('button', { type: 'button', className: 'bt-soft', disabled: busy, onClick: () => { setSelected(null); setOwned(value => !value) } }, owned ? '返回当前会话' : '本设备终端'),
      h('button', { type: 'button', className: 'bt-soft', disabled: busy || reader.busy || !context.available, onClick: reader.reload }, '刷新目录'),
      !owned && current ? h('button', { type: 'button', className: 'bt-soft', disabled: busy || !context.available || !context.access.write,
        onClick: () => { void mutate('extra-terminal-create', { ...target, requestId: crypto.randomUUID(), cols: 80, rows: 24 }, raw => { const created = terminalCreated(raw, target); setSelected(created.terminalId); setMessage('服务器已创建用户终端。') }) } }, '创建服务器终端') : null),
    !current && !owned ? h('p', { className: 'deck-resource-note' }, '原会话已变化；可在本设备终端目录明确关闭旧终端。') : null,
    busy ? h('p', { role: 'status', className: 'deck-resource-note' }, '等待服务器确认…') : null,
    message ? h('p', { role: 'status', className: 'deck-resource-note' }, message) : null,
    h(ReadState, { reader }),
    reader.value && list.length === 0 ? h('p', { className: 'deck-resource-note' }, '此目录没有尚未关闭的用户终端。') : null,
    h('ul', { className: 'deck-workspace-entries' }, list.map(item => h('li', { key: item.terminalId },
      owned ? h('span', null, `${item.terminalId} · ${TERMINAL_STATUSES[item.status]}`)
        : h('button', { type: 'button', className: 'bt-soft', 'aria-pressed': selected === item.terminalId, onClick: () => setSelected(item.terminalId) }, `${item.terminalId} · ${TERMINAL_STATUSES[item.status]}`),
      owned ? h('button', { type: 'button', className: 'bt-soft', disabled: busy || !context.available || !context.access.write,
        onClick: () => setConfirmClose(item.terminalId) }, '关闭此终端') : null))),
    owned && confirmClose ? h('div', { className: 'deck-resource-confirm' }, h('p', null, '确认结束此用户终端及其进程？'),
      h('button', { type: 'button', className: 'bt-soft', disabled: busy, onClick: () => {
        const handle = list.find(item => item.terminalId === confirmClose)
        if (handle) void mutate('extra-terminal-close', { handleId: handle.handleId }, raw => { terminalClosed(raw, handle.terminalId); controls.delete(handle.terminalId); setConfirmClose(null); setMessage('服务器已确认关闭。') })
      } }, '确认关闭'), h('button', { type: 'button', className: 'bt-soft', onClick: () => setConfirmClose(null) }, '取消')) : null,
    !owned && chosen && context.available ? h(TerminalScreen, { key: JSON.stringify([boundary, chosen.handleId]), handle: chosen }) : null)
}
