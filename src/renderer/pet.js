// SPDX-License-Identifier: Apache-2.0
import '@dsbot/bootstrap'
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BotMark } from '@dsbot/client/mark.js'
import { CloseIcon, MonitorIcon } from '@dsbot/client/icons.js'
import { allThemes, effectsOf, themeCss } from '@dsbot/client/themes.js'
import { PetHover } from '../shared/pet-hover.ts'
import './pet.css'
const api = window.dsbotPet
const COLORS = ['green', 'yellow', 'red', 'blue']
const LABELS = { green: '运行', yellow: '待交互', red: '明确失败', blue: '完成待查看' }
function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [color, setColor] = useState(null)
  const [error, setError] = useState(null)
  const hover = useMemo(() => new PetHover(), [])
  const body = useRef(null); const lamps = useRef(null); const panel = useRef(null); const tools = useRef(null)
  const dragging = useRef(false)
  const model = useRef(snapshot); model.current = snapshot
  const currentColor = useRef(color); currentColor.current = color
  const prefs = snapshot?.servers.find(server => server.id === snapshot.activeServerId)?.team?.prefs
  useEffect(() => {
    const style = document.createElement('style'); style.textContent = themeCss(allThemes()[prefs?.theme] ?? allThemes().deepseek, prefs?.accent); document.head.append(style)
    document.body.dataset.btEffects = effectsOf(prefs)
    return () => style.remove()
  }, [prefs?.theme, prefs?.accent, prefs?.effects])
  useEffect(() => {
    const off = api.onSnapshot(next => setSnapshot(current => !current || next.revision >= current.revision ? next : current))
    const inside = (element, point) => { if (!element) return false; const box = element.getBoundingClientRect(); return point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom }
    const offPointer = api.onPointer(point => {
      let lamp = null
      for (const item of lamps.current?.querySelectorAll('[data-color]') ?? []) if (inside(item, point)) lamp = item.dataset.color
      hover.pointer(lamp, inside(panel.current, point), Date.now())
      hover.expire(Date.now())
      if (hover.color() !== currentColor.current) { currentColor.current = hover.color(); setColor(hover.color()) }
    })
    api.ready()
    return () => { off(); offPointer() }
  }, [hover])
  useLayoutEffect(() => {
    const box = element => { const rect = element?.getBoundingClientRect(); return rect && rect.width > 0 && rect.height > 0 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null }
    const publish = () => api.regions({ body: box(body.current), controls: [box(lamps.current), box(tools.current), box(panel.current)].filter(Boolean) })
    publish(); const observer = new ResizeObserver(publish)
    for (const item of [body.current, lamps.current, tools.current, panel.current]) if (item) observer.observe(item)
    return () => observer.disconnect()
  }, [color, Boolean(error)])
  const run = async action => {
    try { const result = await action(); if (!result?.ok) throw new Error(result?.error?.message ?? '操作未完成。'); setError(null) }
    catch (failure) { setError(failure.message) }
  }
  const tasks = (snapshot?.tasks ?? []).filter(task => task.color === color)
  const working = snapshot?.tasks.some(task => task.color === 'green' && !task.cached)
  const allCached = snapshot?.tasks.length > 0 && snapshot.tasks.every(task => task.cached)
  const locked = snapshot?.pet.locked === true
  const openLamp = value => { hover.pointer(value, false, Date.now()); setColor(value); currentColor.current = value }
  const stopDrag = event => {
    if (!dragging.current) return
    dragging.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    api.dragEnd()
  }
  return h('div', { className: 'deck-pet', 'data-working': working || undefined, 'data-cached': allCached || undefined },
    color ? h('section', { ref: panel, className: 'deck-pet-panel', 'aria-label': `${LABELS[color]}的关注对象` },
      h('header', null, h('span', { className: 'deck-pet-dot', 'data-color': color }), h('strong', null, LABELS[color]), h('span', null, `${tasks.length} 个关注对象`)),
      h('div', { className: 'deck-pet-list' }, tasks.length === 0 ? h('p', null, '此颜色没有待关注对象。') : tasks.map(task => h('button', { key: `${task.serverId}:${task.key}`, type: 'button', onClick: () => void run(() => api.select({ serverId: task.serverId, kind: task.kind, id: task.id })) },
        h('span', { className: 'deck-pet-task-name' }, task.title), h('span', { className: 'deck-pet-task-server' }, task.serverAlias), h('span', { className: 'deck-pet-task-detail' }, `${task.detail}${task.cached ? ' · 缓存，完成状态待确认' : ''}`)))),
      h('footer', null, '跳回原 DS-Bot 界面查看；离开灯与气泡 10 秒后隐藏。')) : null,
    h('div', { ref: tools, className: 'deck-pet-tools' },
      h('button', { type: 'button', title: '打开主窗口', 'aria-label': '打开主窗口', onClick: () => void run(api.open) }, h(MonitorIcon)),
      h('button', { type: 'button', title: locked ? '解锁主体拖动' : '锁定主体穿透', 'aria-label': locked ? '解锁主体拖动' : '锁定主体穿透', 'aria-pressed': locked, onClick: () => void run(() => api.prefs({ locked: !locked })) }, locked ? '锁' : '拖'),
      h('button', { type: 'button', title: '隐藏宠物', 'aria-label': '隐藏宠物', onClick: () => void run(() => api.prefs({ enabled: false })) }, h(CloseIcon))),
    h('div', { ref: lamps, className: 'deck-pet-lamps' }, COLORS.map(value => h('button', { key: value, type: 'button', 'data-color': value, title: `${LABELS[value]}：${snapshot?.counts[value] ?? 0} 个关注对象`, 'aria-label': `${LABELS[value]}：${snapshot?.counts[value] ?? 0} 个关注对象`, onPointerEnter: () => openLamp(value), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') openLamp(value) }, onClick: () => { const own = model.current?.tasks.filter(task => task.color === value) ?? []; if (own.length === 1) void run(() => api.select({ serverId: own[0].serverId, kind: own[0].kind, id: own[0].id })) } }, h('span', { className: 'deck-pet-dot', 'data-color': value }), h('span', null, snapshot?.counts[value] ?? 0)))),
    h('div', { ref: body, className: 'deck-pet-body', 'data-locked': locked || undefined,
      onPointerDown: event => { if (event.button !== 0 || locked) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); api.dragStart() },
      onPointerUp: stopDrag, onPointerCancel: stopDrag,
    }, h('span', { className: 'deck-pet-mark' }, h(BotMark, { size: 76 })), h('span', { className: 'deck-pet-label' }, allCached ? '缓存 · 待确认' : working ? '远程工作中' : 'DSBotDeck')),
    error ? h('p', { className: 'deck-pet-error', role: 'alert' }, error) : null)
}
createRoot(document.getElementById('root')).render(h(App))
