// SPDX-License-Identifier: Apache-2.0
// 本机服务器树复用上游标记、主题和按钮语法；原团队 UI 在独立页面内。
import { createElement as h, useEffect, useRef, useState } from 'react'
import { BotAvatar, BotMark } from '@dsbot/client/mark.js'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, DotsIcon, GearIcon, MonitorIcon, PeopleIcon, PlusIcon, SearchIcon, StarLineIcon } from '@dsbot/client/icons.js'
import { allThemes, effectsOf, themeCss } from '@dsbot/client/themes.js'
import { groupEntities, serverLabel, visibleServers } from '../shared/navigation.ts'
const api = window.dsbotDeck
const COLOR_LABELS = { green: '运行', yellow: '待交互', red: '明确失败', blue: '完成待查看' }
function storedCollapse() { try { return JSON.parse(localStorage.getItem('dsbotdeck.tree-collapsed') ?? '{}') } catch { return {} } }
const button = (label, onClick, icon = null, props = {}) => h('button', { type: 'button', className: 'deck-icon', title: label, 'aria-label': label, onClick, ...props }, icon ? h(icon) : label)
function useTheme(prefs) {
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = themeCss(allThemes()[prefs?.theme] ?? allThemes().deepseek, prefs?.accent)
    document.head.append(style)
    document.body.dataset.btEffects = effectsOf(prefs)
    if (prefs?.motion) document.body.dataset.btMotion = prefs.motion
    const paint = () => {
      const probe = document.createElement('span'); probe.style.cssText = 'position:fixed;visibility:hidden;background:var(--bt-main);color:var(--bt-ink)'; document.body.append(probe)
      const read = value => { const parts = value.match(/\d+/g); return parts?.length >= 3 ? `#${parts.slice(0, 3).map(part => Number(part).toString(16).padStart(2, '0')).join('')}` : '#ffffff' }
      const computed = getComputedStyle(probe); api.theme(read(computed.backgroundColor), read(computed.color)); probe.remove()
    }
    paint(); const dark = matchMedia('(prefers-color-scheme: dark)'); dark.addEventListener('change', paint)
    return () => { dark.removeEventListener('change', paint); style.remove() }
  }, [prefs?.theme, prefs?.accent, prefs?.motion, prefs?.effects])
}
function Sheet({ mode, server, busy, error, run, close }) {
  const [alias, setAlias] = useState(server?.alias ?? '')
  const [uri, setUri] = useState('')
  const first = useRef(null)
  useEffect(() => {
    const before = document.activeElement; first.current?.focus()
    const key = event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close() }
      if (event.key === 'Tab') {
        const items = [...document.querySelectorAll('.deck-sheet :is(button,input,textarea)')].filter(item => !item.disabled)
        if (items.length > 0 && event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus() }
        else if (items.length > 0 && !event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
      }
    }
    window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); before?.focus?.() }
  }, [busy])
  const submit = event => {
    event.preventDefault()
    if (mode === 'pair' || mode === 'repair') { const offer = uri; setUri(''); void run(() => api.pair(offer, alias, mode === 'repair' ? server.id : undefined), true) }
    else if (mode === 'rename') void run(() => api.rename(server.id, alias), true)
    else if (mode === 'forget') void run(() => api.forget(server.id), true)
  }
  const title = { pair: '添加远程 DS-Bot', repair: '重新配对', rename: '服务器别名', forget: '忘记服务器' }[mode]
  return h('div', { className: 'deck-scrim', onPointerDown: event => { if (event.target === event.currentTarget && !busy) close() } },
    h('section', { className: 'deck-sheet', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'deck-sheet-title' },
      h('header', null, h('h2', { id: 'deck-sheet-title' }, title), button('关闭', close, CloseIcon, { disabled: busy })),
      h('form', { onSubmit: submit },
        mode !== 'forget' ? h('label', { className: 'deck-field' }, '本机别名', h('input', { ref: first, className: 'bt-input', value: alias, maxLength: 80, disabled: busy, onChange: event => setAlias(event.target.value), autoComplete: 'off' })) : null,
        mode === 'pair' || mode === 'repair' ? h('div', null,
          h('label', { className: 'deck-field' }, '配对链接', h('textarea', { className: 'bt-input', value: uri, maxLength: 8192, rows: 4, spellCheck: false, autoComplete: 'off', disabled: busy, placeholder: 'dsbot://pair?... 或包含配对片段的浏览器链接', onChange: event => setUri(event.target.value) })),
          h('p', { className: 'deck-hint' }, '完整管理需手机配对二维码对应的 dsbot://pair 文本，可用手机扫码工具读取后粘贴。上游“复制浏览器链接”只有浏览器权限，Windows Hello 不会为它提权。'),
          h('p', { className: 'deck-hint' }, '请只连接可信的服务器。配对链接不保存、不写日志；不要把二维码或链接上传到外部服务。')) : null,
        mode === 'forget' ? h('p', null, `仅删除本客户端保存的「${server.alias}」连接身份，不停止远程 Bot，也不会撤销服务器端的设备授权。撤销旧设备须在服务器本机操作。`) : null,
        error ? h('p', { className: 'deck-error', role: 'alert' }, error) : null,
        h('footer', null, h('button', { type: 'button', className: 'bt-soft', onClick: close, disabled: busy }, '取消'),
          h('button', { ref: mode === 'forget' ? first : undefined, type: 'submit', className: 'bt-send', disabled: busy || (mode === 'pair' || mode === 'repair') && uri.trim() === '' }, busy ? '处理中…' : mode === 'forget' ? '仅忘记本机连接' : '保存')))))
}
export function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [viewError, setViewError] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [menu, setMenu] = useState(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(storedCollapse)
  const viewport = useRef(null)
  const tree = useRef(null)
  useEffect(() => {
    let stopped = false
    const accept = next => { if (!stopped) setSnapshot(current => !current || next.revision >= current.revision ? next : current) }
    const off = api.onSnapshot(accept); const offView = api.onViewError(setViewError)
    api.snapshot().then(accept).catch(() => setError('无法读取客户端配置，请检查主进程是否正常启动。'))
    return () => { stopped = true; off(); offView() }
  }, [])
  useEffect(() => {
    const measure = () => { const rect = viewport.current?.getBoundingClientRect(); if (rect) api.viewport({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }) }
    measure(); const observer = new ResizeObserver(measure); if (viewport.current) observer.observe(viewport.current)
    window.addEventListener('resize', measure); return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useEffect(() => { api.overlay(sheet !== null); return () => api.overlay(false) }, [sheet !== null])
  useEffect(() => { try { localStorage.setItem('dsbotdeck.tree-collapsed', JSON.stringify(collapsed)) } catch {} }, [collapsed])
  const active = snapshot?.servers.find(server => server.id === snapshot.activeServerId)
  useTheme(active?.team?.prefs)
  const toggle = key => setCollapsed(value => ({ ...value, [key]: !value[key] }))
  const run = async (action, close = false) => {
    if (busy) return
    setBusy(true); setError(null)
    try { const result = await action(); if (!result?.ok) throw new Error(result?.error?.message ?? '操作未完成。'); if (close) setSheet(null) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const openSheet = (mode, server = null) => { setMenu(null); setError(null); setSheet({ mode, server }) }
  const select = (server, entity) => { setMenu(null); void run(() => api.select({ serverId: server.id, kind: entity.kind, id: entity.id })) }
  const keyNav = event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const items = [...tree.current.querySelectorAll('[data-nav]')]; const at = items.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
    if (items[next]) { event.preventDefault(); items[next].focus() }
  }
  const servers = visibleServers(snapshot?.servers ?? [], search)
  return h('div', { className: 'deck-frame' },
    h('aside', { className: 'deck-side' },
      h('header', { className: 'deck-brand' }, h('div', { className: 'dsb-band' }), h(BotMark, { size: 24 }), h('span', null, 'DSBotDeck'), button('添加服务器', () => openSheet('pair'), PlusIcon, { disabled: Boolean(snapshot?.startupError) })),
      h('label', { className: 'deck-search' }, h(SearchIcon), h('input', { type: 'search', placeholder: '搜索服务器、Bot 或群聊', 'aria-label': '搜索服务器、Bot 或群聊', value: search, onChange: event => setSearch(event.target.value) })),
      h('nav', { ref: tree, className: 'deck-tree', role: 'tree', 'aria-label': '远程服务器与 Bot', onKeyDown: keyNav },
        servers.map(server => {
          const open = Boolean(search) || !collapsed[server.id]
          const query = server.alias.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ? '' : search
          return h('section', { key: server.id, className: 'deck-server', role: 'treeitem', 'aria-expanded': open, 'aria-label': server.alias },
            h('div', { className: 'deck-server-head' },
              h('button', { type: 'button', 'data-nav': '', className: 'deck-disclose', 'aria-expanded': open, 'aria-label': `${open ? '折叠' : '展开'} ${server.alias}`, onClick: () => toggle(server.id), onKeyDown: event => { if (event.key === 'ArrowLeft' && open || event.key === 'ArrowRight' && !open) { event.preventDefault(); toggle(server.id) } } }, h(open ? ChevronDownIcon : ChevronRightIcon)),
              h(MonitorIcon), h('button', { type: 'button', 'data-nav': '', className: 'deck-server-title', onClick: () => void run(() => api.navigate(server.id, { action: 'settings', page: 'general' })) }, h('strong', null, server.alias), h('span', { title: server.error ?? undefined }, server.cached && server.team ? `${serverLabel(server.state)} · 缓存` : serverLabel(server.state))),
              button('服务器操作', () => setMenu(menu === server.id ? null : server.id), DotsIcon, { 'aria-expanded': menu === server.id })),
            menu === server.id ? h('div', { className: 'deck-server-menu', role: 'menu' },
              ['ready', 'connecting', 'reconnecting'].includes(server.state) ? h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); void run(() => api.disconnect(server.id)) } }, '断开本机连接') : h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); void run(() => api.connect(server.id)) } }, '连接服务器'),
              h('button', { type: 'button', role: 'menuitem', onClick: () => openSheet('repair', server) }, '重新配对'),
              h('button', { type: 'button', role: 'menuitem', onClick: () => openSheet('rename', server) }, '修改本机别名'),
              h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); void run(() => api.navigate(server.id, { action: 'new-bot' })) } }, '新建 Bot'),
              h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); void run(() => api.navigate(server.id, { action: 'new-room' })) } }, '新建群聊'),
              h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); void run(() => api.navigate(server.id, { action: 'settings', page: 'general' })) } }, '原 DS-Bot 设置'),
              h('button', { type: 'button', role: 'menuitem', onClick: () => openSheet('forget', server) }, '忘记本机连接')) : null,
            open ? h('div', { role: 'group', className: 'deck-server-body' },
              server.error ? h('p', { className: 'deck-server-error' }, server.error) : null,
              groupEntities(server.team, query).map(group => {
                const groupKey = `${server.id}:${group.id}`; const expanded = Boolean(search) || !collapsed[groupKey]
                return h('div', { key: group.id, role: 'treeitem', 'aria-expanded': expanded, 'aria-label': group.label },
                  h('button', { type: 'button', 'data-nav': '', className: 'deck-group', 'aria-expanded': expanded, onClick: () => toggle(groupKey) }, h(expanded ? ChevronDownIcon : ChevronRightIcon), group.label, h('span', null, group.entities.length)),
                  expanded ? h('div', { role: 'group' }, group.entities.map(entity => {
                    const selected = snapshot.selected?.serverId === server.id && snapshot.selected.kind === entity.kind && snapshot.selected.id === entity.id
                    return h('div', { key: entity.key, className: 'deck-node', 'data-selected': selected || undefined },
                      h('button', { type: 'button', role: 'treeitem', 'aria-selected': selected, 'data-nav': '', className: 'deck-node-open', onClick: () => select(server, entity), title: `${entity.name} · ${entity.detail}${server.cached ? ' · 缓存，待确认' : ''}` },
                        entity.kind === 'room' ? h('span', { className: 'deck-room-mark' }, h(PeopleIcon)) : h(BotAvatar, { bot: entity, size: 28, main: entity.main, live: !server.cached }),
                        h('span', { className: 'deck-node-copy' }, h('span', { className: 'deck-node-name' }, entity.name), h('span', { className: 'deck-node-detail' }, entity.detail)),
                        entity.task ? h('span', { className: 'deck-lamp', 'data-color': entity.task, 'data-cached': server.cached || undefined, role: 'img', 'aria-label': `${COLOR_LABELS[entity.task]}${server.cached ? '（缓存）' : ''}` }) : null),
                      button(entity.followed ? '取消宠物关注' : '加入宠物关注', () => void run(() => api.follow(server.id, entity.key, !entity.followed)), StarLineIcon, { 'aria-pressed': entity.followed, className: 'deck-follow' }))
                  })) : null)
              }),
              !server.team ? h('p', { className: 'deck-hint' }, server.state === 'unpaired' || server.state === 'needs-pairing' ? '身份已保留，需有效配对码。' : '连接后读取原团队目录。') : null,
              server.team?.truncated ? h('p', { className: 'deck-hint' }, '导航仅显示前 512 个对象，原界面仍可管理完整团队。') : null) : null)
        }),
        servers.length === 0 ? h('div', { className: 'deck-tree-empty' }, search ? '没有匹配的服务器或对象。' : '添加服务器后，在这里选择 Bot 或群聊。') : null),
      h('footer', { className: 'deck-side-foot' },
        h('button', { type: 'button', className: 'bt-soft', disabled: !snapshot || Boolean(snapshot.startupError), 'aria-pressed': snapshot?.pet.enabled, onClick: () => void run(() => api.pet({ enabled: !snapshot.pet.enabled })) }, h(BotMark, { size: 16 }), snapshot?.pet.enabled ? '隐藏四色宠物' : '显示四色宠物'),
        active ? button('原 DS-Bot 设置', () => void run(() => api.navigate(active.id, { action: 'settings', page: 'general' })), GearIcon) : null)),
    h('main', { ref: viewport, className: 'deck-content-slot', 'aria-label': '原 DS-Bot 界面' },
      !snapshot || !active ? h('div', { className: 'deck-welcome' }, h(BotMark, { size: 72 }), h('h1', null, '连接远程 DS-Bot'), h('p', null, '原团队界面，多服务器导航。客户端不会启动本地 DSH。'), h('button', { type: 'button', className: 'bt-send', disabled: Boolean(snapshot?.startupError), onClick: () => openSheet('pair') }, '添加服务器')) : null,
      viewError ? h('div', { className: 'deck-view-error', role: 'alert' }, h('p', null, viewError), h('button', { type: 'button', className: 'bt-soft', onClick: () => void run(() => api.reopen(active.id)) }, '重新打开界面')) : null),
    snapshot?.startupError ? h('div', { className: 'deck-error-banner', role: 'alert' }, snapshot.startupError) : null,
    error && !sheet ? h('div', { className: 'deck-toast', role: 'alert' }, error, button('关闭提示', () => setError(null), CloseIcon)) : null,
    sheet ? h(Sheet, { key: `${sheet.mode}:${sheet.server?.id ?? ''}`, ...sheet, busy, error, run, close: () => { if (!busy) setSheet(null) } }) : null)
}
