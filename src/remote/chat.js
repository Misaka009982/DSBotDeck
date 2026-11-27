// SPDX-License-Identifier: Apache-2.0
// 远程协议容器复用 DS-Bot 的行、卡片、菜单和样式；不挂载本机 DSH 会话面板。
// 基于 DS-Bot app/ui/src/chat.js 的远程接入，Copyright 2026 Fei2411 and the DS Bot contributors。
import { createElement as h, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bubbles, ChatRows, Shimmer } from '@dsbot/client/cells.js'
import { ComposerPlus, ComposerVoice } from '@dsbot/client/composer.js'
import { isImeComposing, sendsOnEnter } from '@dsbot/client/enter-key.js'
import { ArrowUpIcon } from '@dsbot/client/icons.js'
import { t } from '@dsbot/client/i18n.js'
import { ApprovalCard } from '@dsbot/client/member-status.js'
import { ModelChoiceDock } from '@dsbot/client/model-menu.js'
import { PendingQuestion } from '@dsbot/client/questions.js'
import { foregroundApprovals } from '../shared/approval-model.ts'
import { remoteReadMode } from '../shared/remote-capabilities.ts'
import { useComposerAttachments } from './composer-attachments.js'
import { useComposerMenu } from './composer-menu.js'
import { useRemoteChat } from './chat-read.js'
import { LearningCards, useLearningHistory } from './learning-cards.js'
import { ResourceContext } from './resource-read.js'
function Composer({ sessionId, placeholder, disabled, onSend, actions, useUi, useRoster, useWork }) {
  const [text, setText] = useState(''); const [error, setError] = useState(null)
  const field = useRef(null)
  const inputActions = useMemo(() => ({
    captureInsertion: () => field.current ? { start: field.current.selectionStart, end: field.current.selectionEnd } : null,
    insertText: (value, at) => setText(current => {
      const start = Math.max(0, Math.min(at?.start ?? current.length, current.length))
      const end = Math.max(start, Math.min(at?.end ?? start, current.length))
      return current.slice(0, start) + value + current.slice(end)
    }),
  }), [])
  const attachments = useComposerAttachments({ sessionId, field, disabled, onSend, onError: setError, setText })
  const menu = useComposerMenu({ sessionId, text, setText, field, disabled, actions, useRoster, onError: setError })
  const enterToSend = useRoster(value => sendsOnEnter(value.prefs))
  useLayoutEffect(() => { const node = field.current; if (node) { node.style.height = 'auto'; node.style.height = `${node.scrollHeight}px` } }, [text])
  useEffect(() => { if (!disabled) field.current?.focus() }, [sessionId, disabled])
  const submit = async () => {
    const value = text.trim()
    if (value === '' && !attachments.hasFiles || disabled || attachments.blocked || menu.isBlocked()) return
    setError(null); setText('')
    try {
      if (attachments.hasFiles) await attachments.send(value)
      else if (!menu.runCommand(value)) await onSend(value)
    } catch (failure) { setText(current => current === '' ? value : current); setError(failure.message) }
  }
  return h('div', { className: 'dsb-composer-wrap', onPaste: attachments.onPaste, onDragOver: attachments.onDragOver, onDrop: attachments.onDrop },
    menu.content, attachments.content,
    error ? h('p', { className: 'dsb-composer-error', role: 'alert' }, error) : null,
    h('div', { className: 'dsb-composer', 'data-composer-card': '', 'data-multiline': text.includes('\n') || undefined },
      attachments.input,
      h('div', { className: 'dsb-composer-tools' }, h(ComposerPlus, { sessionId, inputActions, useRoster, useWork, actions })),
      h('div', { className: 'dsb-composer-input', 'data-input-scroll': '' }, h('textarea', {
        ref: field, rows: 1, value: text, disabled, placeholder, 'aria-label': placeholder, 'data-composer-input': '',
        ...menu.inputProps,
        onChange: event => { setText(event.target.value); menu.onSelect() },
        onKeyDown: event => {
          if (menu.onKeyDown(event)) return
          const plainEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
          const modEnter = event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
          if ((enterToSend ? plainEnter || modEnter : modEnter) && !isImeComposing(event)) { event.preventDefault(); void submit() }
        },
      })),
      h('div', { className: 'dsb-composer-trailing' },
        h(ComposerVoice, { sessionId, inputActions, actions, useUi, useRoster, disabled }),
        h('button', { type: 'button', className: 'dsb-send', disabled: disabled || attachments.blocked || text.trim() === '' && !attachments.hasFiles,
          'aria-label': t('Send message'), title: t('Send message'), onClick: () => { void submit() } }, h(ArrowUpIcon)))))
}
export function Chat({ sessionId, team }) {
  const { actions, hooks, chat: feed } = team
  const context = useContext(ResourceContext)
  const roster = hooks.useRoster(value => value)
  const bot = roster.byId[sessionId]; const room = roster.roomsById[sessionId]
  const name = bot?.name ?? room?.name ?? ''
  const extraMode = remoteReadMode(roster)
  const { view, stream, pending, load, send, keep, failure } = useRemoteChat({ botId: bot?.id, roomId: room?.id, sessionId, feed,
    fullMessages: extraMode.fullMessages, extraReads: extraMode.state, cached: context.cached, epoch: context.epoch })
  const historyItems = useLearningHistory(sessionId, view)
  const scroller = useRef(null); const follow = useRef(true)
  const question = roster.questions?.[sessionId]
  const running = hooks.useSessionStatus(map => map.get(sessionId)?.running === true)
  const approvalKey = hooks.useWork(work => JSON.stringify(room === undefined ? foregroundApprovals(work, bot?.id, sessionId) : []))
  const approvals = JSON.parse(approvalKey)
  useEffect(() => {
    document.body.toggleAttribute('data-bt-room', room !== undefined)
    return () => document.body.removeAttribute('data-bt-room')
  }, [room !== undefined])
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    if (keep.current !== null) { node.scrollTop = node.scrollHeight - keep.current; keep.current = null }
    else if (follow.current) node.scrollTop = node.scrollHeight
  }, [view.items, stream, pending, running, question, approvalKey, roster.learning, roster.learningSettled])
  useLayoutEffect(() => {
    if (!view.loading && !view.failed && view.sessionId !== null) team.deckPaint?.(bot?.id, room?.id, scroller.current)
  }, [view.items, view.loading, view.failed, view.sessionId])
  const onScroll = () => {
    const node = scroller.current
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    if (follow.current && !view.loading && !view.failed) team.deckPaint?.(bot?.id, room?.id, node)
  }
  const earlier = view.loading && view.sessionId !== null ? h(Shimmer, null, t('Loading earlier messages…'))
    : view.failed ? h('button', { type: 'button', className: 'bt-soft', onClick: () => load(failure?.cursor, scroller.current) }, t('Couldn’t load earlier messages · Retry'))
      : view.cursor ? h('button', { type: 'button', className: 'bt-soft', onClick: () => load(view.cursor, scroller.current) }, t('Load earlier')) : null
  const waiting = bot?.waiting === true
  return h('div', { className: 'dsb-chat' },
    h('div', { ref: scroller, className: 'dsb-scroll', 'data-conversation-scroll': '', onScroll },
      h('div', { className: 'dsb-column' },
        failure ? h('p', { className: 'deck-chat-read-error', role: 'alert' }, failure.message) : null,
        earlier ? h('div', { className: 'bt-earlier-top' }, earlier) : null,
        h('div', { className: 'dsb-flow', 'data-chat-flow': '', role: 'feed', 'aria-label': name, 'aria-busy': view.loading },
          h(ChatRows, { items: historyItems, sessionId, roster, actions, useUi: hooks.useUi, clock: true }),
          pending.length ? h('div', { className: 'dsb-pending' }, h(ChatRows, { items: pending, sessionId, roster, actions })) : null,
          stream?.text ? h(Bubbles, { texts: [stream.text], roster, selfId: bot?.id, actions, streaming: true, sessionId }) : null,
          h('div', { 'data-chat-running': '' }),
          question ? h(PendingQuestion, { key: JSON.stringify([sessionId, question.id]), sessionId, question, actions, inline: true, enterToSend: sendsOnEnter(roster.prefs) }) : null,
          h(LearningCards, { sessionId })))),
    h('div', { className: 'dsb-composer-root' },
      approvals.length ? h('div', { className: 'deck-chat-approvals', role: 'group', 'aria-label': t('Approval') }, approvals.map(approval => h(ApprovalCard, { key: approval.id, approval, bot, actions, showBot: true }))) : null,
      h(ModelChoiceDock, { sessionId, useRoster: hooks.useRoster, actions }),
      h(Composer, { sessionId, disabled: waiting || context.cached || Boolean(roster.readOnly),
        placeholder: waiting ? t('Pick a model and {name} can start.', { name }) : name ? t('Message {name}', { name }) : t('Message'),
        onSend: (text, delivery, fileRefs, images) => send(text, actions, delivery, fileRefs, images),
        actions, useUi: hooks.useUi, useRoster: hooks.useRoster, useWork: hooks.useWork })))
}
