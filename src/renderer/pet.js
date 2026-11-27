// SPDX-License-Identifier: Apache-2.0
import '@dsbot/bootstrap'
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GearIcon, MonitorIcon } from '@dsbot/client/icons.js'
import { PetHover } from '../shared/pet-hover.ts'
import { petToolbarVisible } from '../shared/pet-geometry.ts'
import { petPose } from '../shared/pet-sprite.ts'
import { PET_CANVAS, legacyPetAnchor, placePet } from '../shared/pet-layout.ts'
import { PetSprite } from './pet-sprite.js'
import { useDeckLocale } from './deck-locale.js'
import { useDeckTheme } from './deck-theme.js'
import './pet.css'
const api = window.dsbotPet
const COLORS = ['green', 'yellow', 'red', 'blue']
const LABELS = { green: '运行', yellow: '待交互', red: '明确失败', blue: '完成待查看' }
const POSE_COLORS = { working: 'green', waiting: 'yellow', error: 'red', success: 'blue' }
const INITIAL_LAYOUT = { ...placePet(legacyPetAnchor({ x: 0, y: 0 }, 112), 112, { x: 0, y: 0, ...PET_CANVAS }).layout, revision: 0 }
const boxOf = element => { const rect = element?.getBoundingClientRect(); return rect && rect.width > 0 && rect.height > 0 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null }
function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [assets, setAssets] = useState(null)
  const [color, setColor] = useState(null)
  const [layout, setLayout] = useState(INITIAL_LAYOUT)
  const [error, setError] = useState(null)
  const [toolbarShown, setToolbarShown] = useState(false)
  const toolbarVisible = useRef(false)
  const renderedLayout = useRef(0)
  const colors = COLORS.filter(value => (snapshot?.counts[value] ?? 0) > 0)
  const lampKey = colors.join(',')
  const hover = useMemo(() => new PetHover(), [])
  const body = useRef(null); const lamps = useRef(null); const panel = useRef(null); const tools = useRef(null)
  const dragging = useRef(false)
  const model = useRef(snapshot); model.current = snapshot
  const currentColor = useRef(color); currentColor.current = color
  const prefs = snapshot?.servers.find(server => server.id === snapshot.activeServerId)?.team?.prefs
  useDeckLocale(snapshot?.appearance.language ?? 'system')
  useDeckTheme(snapshot?.appearance, prefs)
  useEffect(() => {
    const off = api.onSnapshot(next => setSnapshot(current => !current || next.revision >= current.revision ? next : current))
    const offAssets = api.onAssets(setAssets)
    const offLayout = api.onLayout(next => setLayout(current => next.revision >= current.revision ? next : current))
    const inside = (element, point) => { if (!element) return false; const box = element.getBoundingClientRect(); return point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom }
    const offPointer = api.onPointer(point => {
      if (point.layoutRevision !== renderedLayout.current) return
      const shown = petToolbarVisible(boxOf(body.current), boxOf(tools.current), point, toolbarVisible.current)
      if (shown !== toolbarVisible.current) { toolbarVisible.current = shown; setToolbarShown(shown) }
      let lamp = null
      for (const item of lamps.current?.querySelectorAll('[data-color]') ?? []) if (inside(item, point)) lamp = item.dataset.color
      hover.pointer(lamp, inside(panel.current, point), Date.now())
      hover.expire(Date.now())
      if (hover.color() !== currentColor.current) { currentColor.current = hover.color(); setColor(hover.color()) }
    })
    api.ready()
    return () => { off(); offAssets(); offLayout(); offPointer() }
  }, [hover])
  useLayoutEffect(() => {
    if (color && !colors.includes(color)) { hover.close(); currentColor.current = null; setColor(null) }
  }, [lampKey, color, hover])
  useLayoutEffect(() => {
    const revision = layout.revision; renderedLayout.current = revision
    const publish = () => api.regions({ layoutRevision: revision, body: boxOf(body.current), controls: [boxOf(lamps.current), toolbarShown ? boxOf(tools.current) : null, boxOf(panel.current)].filter(Boolean) })
    publish(); const observer = new ResizeObserver(publish)
    for (const item of [body.current, lamps.current, tools.current, panel.current]) if (item) observer.observe(item)
    return () => observer.disconnect()
  }, [color, Boolean(error), layout.revision, lampKey, toolbarShown])
  const run = async action => {
    try { const result = await action(); if (!result?.ok) throw new Error(result?.error?.message ?? '操作未完成。'); setError(null) }
    catch (failure) { setError(failure.message) }
  }
  const tasks = (snapshot?.tasks ?? []).filter(task => task.color === color)
  const pose = petPose(snapshot?.tasks ?? [])
  const working = pose === 'working'
  const allCached = snapshot?.tasks.length > 0 && snapshot.tasks.every(task => task.cached)
  const statusColor = POSE_COLORS[pose]
  const statusLabel = allCached ? '缓存 · 待确认' : working ? '远程工作中' : LABELS[statusColor] ?? 'DSBotDeck'
  const locked = snapshot?.pet.locked === true
  const openLamp = value => { hover.pointer(value, false, Date.now()); setColor(value); currentColor.current = value }
  const closePanel = () => { hover.close(); currentColor.current = null; setColor(null) }
  const stopDrag = event => {
    if (!dragging.current) return
    dragging.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    api.dragEnd()
  }
  const size = layout.size
  return h('div', { className: 'deck-pet', style: {
    '--deck-pet-size': `${size}px`, '--deck-pet-width': `${layout.body.width}px`,
    '--deck-pet-canvas-width': `${layout.width}px`, '--deck-pet-canvas-height': `${layout.height}px`,
    '--deck-pet-body-x': `${layout.body.x}px`, '--deck-pet-body-y': `${layout.body.y}px`,
    '--deck-pet-tools-x': `${layout.toolbar.x}px`, '--deck-pet-tools-y': `${layout.toolbar.y}px`,
    '--deck-pet-lamps-x': `${layout.lamps.x}px`, '--deck-pet-lamps-y': `${layout.lamps.y}px`,
    '--deck-pet-panel-x': `${layout.panel.x}px`, '--deck-pet-panel-width': `${layout.panel.width}px`,
    '--deck-pet-panel-offset': `${layout.panel.offset}px`, '--deck-pet-panel-height': `${layout.panel.maxHeight}px`,
  }, 'data-bubble-side': layout.side, 'data-working': working || undefined, 'data-cached': allCached || undefined },
    color ? h('section', { ref: panel, className: 'deck-pet-panel', 'aria-label': `${LABELS[color]}的关注对象` },
      h('header', null, h('span', { className: 'deck-pet-dot', 'data-color': color }), h('strong', null, LABELS[color]), h('span', { className: 'deck-pet-count' }, `${tasks.length} 个关注对象`), h('button', { type: 'button', className: 'deck-pet-collapse', 'aria-label': '收起任务气泡', onClick: closePanel }, '×')),
      h('div', { className: 'deck-pet-list' }, tasks.length === 0 ? h('p', null, '此颜色没有待关注对象。') : tasks.map(task => h('button', { key: `${task.serverId}:${task.key}`, type: 'button', 'data-color': color, onClick: () => void run(() => api.select({ serverId: task.serverId, kind: task.kind, id: task.id })) },
        h('span', { className: 'deck-pet-task-name' }, task.title), h('span', { className: 'deck-pet-task-server' }, task.serverAlias), h('span', { className: 'deck-pet-task-detail' }, `${task.detail}${task.cached ? ' · 缓存，完成状态待确认' : ''}`)))),
      h('footer', null, error ? h('span', { role: 'alert' }, error) : '点击对象返回原聊天；离开灯与气泡 10 秒后收起。')) : null,
    h('div', { ref: tools, className: 'deck-pet-tools', 'data-visible': toolbarShown || undefined, 'aria-hidden': !toolbarShown },
      h('button', { type: 'button', title: '打开主窗口', 'aria-label': '打开主窗口', onClick: () => void run(api.open) }, h(MonitorIcon)),
      h('button', { type: 'button', title: 'Deck 宠物设置', 'aria-label': 'Deck 宠物设置', onClick: () => void run(api.settings) }, h(GearIcon))),
    colors.length ? h('div', { ref: lamps, className: 'deck-pet-lamps', role: 'toolbar', 'aria-label': '四色任务状态' }, colors.map(value => h('button', { key: value, type: 'button', 'data-color': value, 'data-active': color === value || undefined, 'data-live': snapshot?.tasks.some(task => task.color === value && !task.cached) || undefined, 'aria-pressed': color === value, title: `${LABELS[value]}：${snapshot?.counts[value] ?? 0} 个关注对象`, 'aria-label': `${LABELS[value]}：${snapshot?.counts[value] ?? 0} 个关注对象`, onPointerEnter: () => openLamp(value), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') openLamp(value) }, onClick: () => { const own = model.current?.tasks.filter(task => task.color === value) ?? []; if (own.length === 1) void run(() => api.select({ serverId: own[0].serverId, kind: own[0].kind, id: own[0].id })) } }, h('span', { className: 'deck-pet-dot', 'data-color': value }), h('span', { className: 'deck-pet-lamp-count' }, snapshot?.counts[value] ?? 0)))) : null,
    h('div', { ref: body, className: 'deck-pet-body', 'data-locked': locked || undefined,
      onPointerDown: event => { if (event.button !== 0 || locked) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); api.dragStart() },
      onPointerUp: stopDrag, onPointerCancel: stopDrag,
    }, h('span', { className: 'deck-pet-mark' }, h(PetSprite, { asset: assets?.selected, mark: snapshot?.pet.mark, pose, size, paused: allCached })), h('span', { className: 'deck-pet-label', 'data-color': statusColor, title: statusLabel }, statusLabel)),
    error && !color ? h('p', { className: 'deck-pet-error', role: 'alert' }, error) : null)
}
createRoot(document.getElementById('root')).render(h(App))
