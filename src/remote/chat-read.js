// SPDX-License-Identifier: Apache-2.0
// 远程聊天只读取已授权分页与事件；上游 v0.4.0 的本机会话日志接口不适用于配对连接。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { adaptRoomItems, mergeLatestPage, sameItem } from '@dsbot/ui/chat.js'
import { readExtraPage, extraReadFailure } from '../shared/extra-read-model.ts'
import { errorCode } from '../shared/validation.ts'
import { watchToolSteps } from '../shared/tool-refresh.ts'
const userKey = item => item.id !== undefined ? `id:${item.id}` : JSON.stringify([item.time, item.text, item.fileRefs, item.images])
export function useRemoteChat({ botId, roomId, sessionId, feed, fullMessages, extraReads, cached, epoch }) {
  const active = !cached && (botId !== undefined || roomId !== undefined)
  const [view, setView] = useState({ sessionId: null, items: [], cursor: null, loading: active, failed: false, stale: true })
  const [stream, setStream] = useState(null); const [pending, setPending] = useState([]); const [failure, setFailure] = useState(null)
  const scope = useRef(null)
  const generation = useRef(0); const busy = useRef(false); const ready = useRef(false); const refreshQueued = useRef(false)
  const early = useRef([]); const rejected = useRef(false); const knownUsers = useRef(new Set()); const loaded = useRef(false); const request = useRef(null)
  const keep = useRef(null)
  const matchUsers = (items, initial) => {
    const fresh = items.filter(item => {
      if (item.kind !== 'user' || knownUsers.current.has(userKey(item))) return false
      knownUsers.current.add(userKey(item)); return true
    })
    if (!fresh.length) return
    setPending(list => {
      const next = [...list]
      for (const item of fresh) {
        const at = next.findIndex(entry => entry.text === item.text && (entry.images ?? 0) === (item.images ?? 0)
          && (entry.fileRefs?.length ?? 0) === (item.fileRefs?.length ?? 0)
          && (!initial || !Number.isFinite(item.time) || item.time >= entry.time - 2000))
        if (at >= 0) next.splice(at, 1)
      }
      return next.length === list.length ? list : next
    })
  }
  const load = useCallback(async (cursor, scroller, refresh = false) => {
    if (!active) return
    if (busy.current) { if (cursor === undefined) refreshQueued.current = true; return }
    const current = generation.current; const controller = new AbortController()
    request.current = controller; busy.current = true; rejected.current = false
    if (cursor === undefined && !refresh) ready.current = false
    if (!refresh) setView(value => ({ ...value, loading: true, failed: false }))
    try {
      const page = await readExtraPage(call, 'extra-messages', {
        ...(roomId !== undefined ? { roomId } : { botId }), ...(cursor ? { cursor } : {}), fullMessages,
      }, () => roomId !== undefined
        ? call('room-chat', { roomId, steps: true, ...(cursor ? { cursor } : {}) }, controller.signal)
        : call('chat', { botId, steps: true, ...(cursor ? { cursor } : {}) }, controller.signal), extraReads, controller.signal)
      if (generation.current !== current || controller.signal.aborted) return
      const pageItems = roomId !== undefined ? adaptRoomItems(page.items) : page.items
      const pageSession = page.sessionId ?? sessionId
      setFailure(null)
      if (cursor === undefined) {
        const later = early.current.filter(entry => entry.sessionId === pageSession && !pageItems.some(item => sameItem(item, entry.item)))
        const items = [...pageItems, ...later.map(entry => entry.item)]
        early.current = []; ready.current = true
        setView(value => {
          const merged = value.sessionId === pageSession && value.items.length
            ? mergeLatestPage(value.items, value.cursor, items, page.cursor) : { items, cursor: page.cursor }
          return { sessionId: pageSession, ...merged, loading: false, failed: false, stale: false }
        })
        // 断线前的片段仅作暂停展示，取得新页后用服务器记录替代；新流不被旧页清掉。
        setStream(value => value?.paused ? null : value)
        matchUsers(items, !loaded.current); loaded.current = true
      } else {
        for (const item of pageItems) if (item.kind === 'user') knownUsers.current.add(userKey(item))
        if (scroller) keep.current = scroller.scrollHeight - scroller.scrollTop
        setView(value => ({ ...value, items: [...pageItems, ...value.items], cursor: page.cursor, loading: false, failed: false }))
      }
    } catch (error) {
      if (generation.current !== current || controller.signal.aborted) return
      // 本地切服或取消不代表服务端撤权；保留正文，等当前界面恢复后核对。
      if (errorCode(error) === 'RPC_ABORTED') {
        ready.current = false; early.current = []; refreshQueued.current = false; setFailure(null)
        setStream(value => value && !value.paused ? { ...value, paused: true } : value)
        setView(value => ({ ...value, loading: false, failed: false, stale: true }))
        return
      }
      setFailure({ message: extraReadFailure(error), cursor })
      rejected.current = errorCode(error) === 'bot/refused'
      if (rejected.current) { early.current = []; setStream(null); refreshQueued.current = false }
      ready.current = !rejected.current && (cursor !== undefined || refresh || ready.current)
      setView(value => ({ ...value, loading: false, failed: true, stale: value.stale || cursor === undefined, ...(errorCode(error) === 'bot/refused' ? { items: [], sessionId: null, cursor: null } : {}) }))
    } finally {
      if (generation.current === current) {
        request.current = null; busy.current = false
        if (refreshQueued.current) { refreshQueued.current = false; void loadRef.current(undefined, undefined, true) }
      }
    }
  }, [active, botId, roomId, sessionId, fullMessages, extraReads, epoch])
  const loadRef = useRef(load); loadRef.current = load
  useLayoutEffect(() => {
    const current = ++generation.current
    const nextScope = JSON.stringify([botId, roomId, sessionId, fullMessages, extraReads])
    const changed = scope.current !== nextScope
    scope.current = nextScope
    busy.current = false; ready.current = false; refreshQueued.current = false
    early.current = []; rejected.current = false; setFailure(null)
    // 网络暂停只使请求失效。只有目标或读取授权改变时，才清除已读会话正文。
    if (changed) {
      loaded.current = false; knownUsers.current.clear(); keep.current = null
      setStream(null); setPending([])
      setView({ sessionId: null, items: [], cursor: null, loading: active, failed: false, stale: true })
    } else {
      setStream(value => value && !value.paused ? { ...value, paused: true } : value)
      setView(value => ({ ...value, loading: active, failed: false, stale: true }))
    }
    if (active) void loadRef.current(undefined, undefined, !changed)
    return () => { if (generation.current === current) generation.current++; request.current?.abort(); request.current = null }
  }, [active, botId, roomId, sessionId, fullMessages, extraReads, epoch])
  useEffect(() => {
    if (!active) return
    const current = generation.current
    return feed.on((event, data) => {
      if (generation.current !== current || rejected.current) return
      if (event === 'hello') { if (ready.current) void loadRef.current(undefined, undefined, true); return }
      if (roomId !== undefined) {
        if (event === 'room' && data?.roomId === roomId) void loadRef.current(undefined, undefined, true)
        return
      }
      if (data?.botId !== botId || data.sessionId !== sessionId) return
      if (event === 'message' && data.item) {
        if (!ready.current) {
          if (early.current.length < 256) early.current.push(data)
          else refreshQueued.current = true
          return
        }
        setView(value => data.sessionId !== value.sessionId || value.items.some(item => sameItem(item, data.item))
          ? value : { ...value, items: [...value.items, data.item] })
        matchUsers([data.item], false)
        if (data.item.kind === 'bot') setStream(null)
      } else if (event === 'stream') {
        if (data.phase === 'start') setStream({ attemptId: data.attemptId, text: '' })
        else if (data.phase === 'end') setStream(value => value?.attemptId === data.attemptId ? null : value)
        else setStream(value => value?.attemptId === data.attemptId && !value.paused ? { ...value, text: value.text + (data.text ?? '') } : value)
      }
    })
  }, [active, feed, botId, roomId, sessionId, fullMessages, extraReads, epoch])
  useEffect(() => {
    const current = generation.current; const read = loadRef.current
    const available = () => active && generation.current === current && loadRef.current === read
      && document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached')
    const latest = () => { if (ready.current && available()) void read(undefined, undefined, true) }
    const dispose = watchToolSteps(feed, { botId, roomId, sessionId }, latest, available)
    const resume = () => { if (!rejected.current && available()) void read(undefined, undefined, true) }
    document.addEventListener('visibilitychange', resume)
    return () => { dispose(); document.removeEventListener('visibilitychange', resume) }
  }, [active, feed, botId, roomId, sessionId, fullMessages, extraReads, epoch])
  const send = async (text, actions, delivery, fileRefs, images) => {
    const current = generation.current
    const entry = { kind: 'user', text, time: Date.now(), ...(fileRefs?.length ? { fileRefs } : {}), ...(images ? { images } : {}) }
    setPending(list => [...list, entry]); actions.noteSent(sessionId)
    try {
      if (delivery) { await delivery(); if (generation.current === current) void loadRef.current(undefined, undefined, true) }
      else await actions.send(sessionId, text)
    } catch (error) {
      if (generation.current === current) setPending(list => list.filter(item => item !== entry))
      throw error
    }
  }
  return { view, stream, pending, load, send, keep, failure }
}
