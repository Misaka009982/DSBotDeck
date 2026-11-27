// SPDX-License-Identifier: Apache-2.0
// 基于上游 app/ui/src/app.js 的入口适配，只替换导航边界和远程状态绑定。
// Copyright 2026 Fei2411 and the DS Bot contributors
import { Component, createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorToast } from '@dsbot/client/feedback.js'
import { call } from '@dsbot/client/api.js'
import { resetExtraReads } from '../shared/extra-read-model.ts'
import { sessionResourceTarget } from '../shared/resource-model.ts'
import { ResourceContext } from './resource-read.js'
import { ResourceEntries } from './resource-entry.js'
import { WorkspaceDraftShelf } from './workspace-editor.js'
import { AttachmentDraftShelf } from './composer-attachments.js'
import { PrivateGoalBar } from './private-goal.js'
import { HeaderPill } from '@dsbot/client/header.js'
import { Overlays } from '@dsbot/client/overlays.js'
import { currentPart } from '@dsbot/client/text.js'
import { Chat } from '@dsbot/ui/chat.js'
import { createTeam } from '@dsbot/ui/team.js'
import { useDeckLocale } from '../renderer/deck-locale.js'
import { useDeckTheme } from '../renderer/deck-theme.js'

const bridge = window.dsbotContent
function useFrame(selector) {
  const [viewport, setViewport] = useState(window.innerWidth)
  useEffect(() => { const resize = () => setViewport(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  return selector({ viewport, sidebarWidth: 0, collapsedWidth: 0 })
}
const useHiddenSidebar = () => 'hidden'
class Contain extends Component {
  constructor(props) { super(props); this.state = { failed: false }; this.failedAt = 0 }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) {
    this.props.onError(error)
    if (Date.now() - this.failedAt > 1000) this.setState({ failed: false })
    this.failedAt = Date.now()
  }
  render() { return this.state.failed ? null : this.props.children }
}
const targetOf = (roster, id) => {
  const bot = roster.byId[id]
  if (bot) return { kind: 'bot', id: bot.id }
  const room = roster.roomsById[id]
  return room ? { kind: 'room', id: room.id } : null
}
export function App() {
  const team = useMemo(createTeam, [])
  const { hooks, actions } = team
  const roster = hooks.useRoster(value => value)
  const shown = hooks.useShown(value => value)
  const [status, setStatus] = useState({ cached: true, alias: '远程 DS-Bot', state: 'connecting', error: null })
  const [feedLost, setFeedLost] = useState(true)
  const [resourceEpoch, setResourceEpoch] = useState(0)
  const [packet, setPacket] = useState(null)
  const localeReady = useDeckLocale(status.uiLanguage ?? 'zh')
  const cachedRef = useRef(true)
  cachedRef.current = status.cached || feedLost
  const views = { ...hooks, actions, useFrame, useSidebarPref: useHiddenSidebar }
  useDeckTheme(status.uiTheme, roster.prefs)
  useEffect(() => team.start(), [team])
  useEffect(() => {
    const offCommand = bridge.onCommand(setPacket)
    const offStatus = bridge.onStatus(setStatus)
    const offFeed = team.chat.on(event => { if (event === 'lost') { resetExtraReads(call); setFeedLost(true); setResourceEpoch(value => value + 1) }; if (event === 'hello') setFeedLost(false) })
    const visible = node => {
      if (!node || cachedRef.current || document.visibilityState !== 'visible' || node.scrollHeight - node.scrollTop - node.clientHeight > 80 || node.closest('[data-leaving]')) return false
      const box = node.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + Math.min(box.width / 2, 30), box.bottom - 8)
      return box.width > 0 && box.height > 0 && hit && node.contains(hit)
    }
    team.deckPaint = (botId, roomId, node) => {
      if (!visible(node)) return
      if (roomId) bridge.viewed('room', roomId)
      else if (botId) bridge.viewed('bot', botId)
    }
    actions.deckTaskPaint = (botId, taskId, node) => { if (visible(node)) bridge.viewedTask(botId, taskId) }
    bridge.ready()
    return () => { offCommand(); offStatus(); offFeed(); delete team.deckPaint; delete actions.deckTaskPaint }
  }, [team])
  useEffect(() => {
    if (!packet || !roster.ready) return
    if (packet.action === 'chat') {
      const target = packet.kind === 'room' ? roster.roomsById[packet.id] : roster.byId[packet.id]
      if (target) actions.openSession(target.id)
      else actions.notice('此对象不在当前远程团队目录中。')
    }
    else if (packet.action === 'settings') actions.openSettings(packet.page, packet.id)
    else if (packet.action === 'new-room') actions.openNewChat('group')
    else if (packet.action === 'new-bot') actions.openNewChat('create')
    setPacket(null)
  }, [packet, roster.ready, actions])
  useEffect(() => {
    if (!roster.ready || cachedRef.current) return
    const subject = shown ? roster.byId[shown] ?? roster.roomsById[shown] : null
    if (subject) {
      if (currentPart(subject) !== shown) actions.openSession(subject.id)
      return
    }
    const id = roster.byId[roster.mainBotId]?.id ?? roster.bots?.[0]?.id ?? roster.rooms?.[0]?.id
    if (id) actions.openSession(id)
  }, [roster.ready, roster.revision, shown, actions, status.cached, feedLost])
  useEffect(() => {
    const target = shown ? targetOf(roster, shown) : null
    if (target) bridge.selected(target.kind, target.id)
  }, [shown, roster.revision])
  const cached = status.cached || feedLost
  useEffect(() => {
    document.body.toggleAttribute('data-deck-cached', cached)
    return () => document.body.removeAttribute('data-deck-cached')
  }, [cached])
  useEffect(() => {
    document.body.toggleAttribute('data-deck-background', status.localBackground === true)
    return () => document.body.removeAttribute('data-deck-background')
  }, [status.localBackground])
  const closeOverlays = error => {
    actions.closeSettings(); actions.closeMemory(); actions.closeMenu(); actions.closePanel(); actions.closePalette(); actions.closeVoice(); actions.closeOverlay()
    actions.reportError(error, 'overlay')
  }
  const visibleShown = shown && (roster.byId[shown] || roster.roomsById[shown]) ? shown : null
  if (!localeReady) return null
  return h(ResourceContext.Provider, { value: { roster, cached, mode: status.mode, epoch: resourceEpoch, selection: shown, actions } }, h('div', { className: 'deck-remote-frame' },
    cached ? h('div', { className: 'deck-cache-banner', role: 'status' }, `${status.alias} · 缓存 · 完成状态待确认`, status.error ? h('span', null, status.error) : null) : null,
    h('fieldset', { className: 'deck-remote-controls', disabled: cached },
      h('main', { className: 'dsb-main dsb_centerCol' },
        h('div', { className: 'dsb-band' }),
        visibleShown ? h(Fragment, { key: visibleShown },
          h('div', { className: 'dsb-head' }, h(HeaderPill, { ...views, sessionId: visibleShown, useSession: team.sessionHook(visibleShown) })),
          h(PrivateGoalBar, { sessionId: visibleShown }),
          h(ResourceEntries, { target: sessionResourceTarget(roster, visibleShown) }),
          h(Chat, { key: visibleShown, sessionId: visibleShown, team }))
          : h('div', { className: 'deck-remote-empty' }, roster.ready ? '此服务器暂无可显示的 Bot，可从服务器菜单新建。' : '正在读取远程团队…'))),
    h(WorkspaceDraftShelf),
    h(AttachmentDraftShelf),
    h(Contain, { onError: closeOverlays }, h(Overlays, views)),
    h(ErrorToast, views)))
}
