// SPDX-License-Identifier: Apache-2.0
// 给原独立输入框增补候选菜单；复用上游提及和动作，不接DSH或新增RPC。
import { createElement as h, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { mentionRows } from '@dsbot/client/at-menu.js'
import { commandEntries } from '@dsbot/client/command-actions.js'
import { menuIcons } from '@dsbot/client/composer.js'
import { GoalIcon } from '@dsbot/client/icons.js'
import { t } from '@dsbot/client/i18n.js'
import { privateGoalChatTarget } from '../shared/private-goal.ts'
import { commandName, composerTrigger, menuKeyAction, replaceComposerTrigger } from '../shared/composer-model.ts'
const signature = (text, trigger) => trigger ? `${trigger.kind}:${trigger.start}:${trigger.end}:${text}` : ''
export function useComposerMenu({ sessionId, text, setText, field, disabled, actions, useRoster, onError }) {
  const roster = useRoster(value => value)
  const latest = useRef(roster); latest.current = roster
  const store = useMemo(() => ({ getSnapshot: () => latest.current }), [])
  const entries = useMemo(() => commandEntries({ roster: store, actions }), [store, actions])
  const icons = useMemo(() => menuIcons(store), [store])
  const listId = `deck-composer-${useId()}`
  const panel = useRef(null); const pending = useRef(null); const composing = useRef(false)
  const [span, setSpan] = useState({ start: 0, end: 0 })
  const [focused, setFocused] = useState(false); const [blocked, setBlocked] = useState(false); const [inComposition, setInComposition] = useState(false)
  const [closed, setClosed] = useState(''); const [selected, setSelected] = useState({ key: '', index: 0 })
  const isBlocked = () => disabled || !field.current?.isConnected || field.current.matches(':disabled') || document.body.hasAttribute('data-deck-cached') || document.visibilityState !== 'visible'
  const select = () => {
    const node = field.current
    if (!node) return
    if (document.activeElement === node && !isBlocked()) setFocused(true)
    setSpan(previous => previous.start === node.selectionStart && previous.end === node.selectionEnd ? previous : { start: node.selectionStart, end: node.selectionEnd })
  }
  useEffect(() => {
    const update = () => { setBlocked(isBlocked()); if (isBlocked()) { setFocused(false); setClosed('') } }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-deck-cached'] })
    document.addEventListener('visibilitychange', update); update()
    const outside = event => { if (!field.current?.contains(event.target) && !panel.current?.contains(event.target)) setFocused(false) }
    document.addEventListener('pointerdown', outside)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); document.removeEventListener('pointerdown', outside) }
  }, [disabled])
  useLayoutEffect(() => {
    const node = field.current
    if (!node) return
    const insertion = pending.current; pending.current = null
    if (insertion?.text === text) {
      node.setSelectionRange(insertion.caret, insertion.caret)
      if (insertion.focus) node.focus()
    }
    select()
  }, [text])
  const trigger = useMemo(() => composerTrigger(text, span.start, span.end), [text, span.start, span.end])
  const key = useMemo(() => signature(text, trigger), [text, trigger])
  const commandRows = () => {
    const rows = [...entries.contributions, ...entries.decorations].filter(entry => entry.available({ sessionId })).map(entry => ({ kind: 'command', key: entry.name, label: entry.label?.() ?? t('Goal'), description: entry.description?.() ?? t('Group goal'), icon: entry.icon ?? GoalIcon, entry }))
    const target = privateGoalChatTarget(latest.current, sessionId)
    if (!target) return rows
    return [...rows.filter(row => row.key !== 'goal'), { kind: 'command', key: 'goal', label: '私聊目标', description: '查看或设置当前 Bot 的持续目标', icon: GoalIcon,
      entry: { ui: { run: () => {
        const current = privateGoalChatTarget(latest.current, sessionId)
        if (!current || current.botId !== target.botId || current.sessionId !== target.sessionId) throw new Error('当前私聊已变化，请重新打开目标入口。')
        actions.openSettings('bots', current.botId)
      } } } }]
  }
  const readRows = token => {
    if (token.kind === 'command') return commandRows().filter(row => row.key.toLowerCase().includes(token.query.toLowerCase())).slice(0, 12)
    return (mentionRows(latest.current, sessionId, token.query) ?? []).filter(row => !/\s$/.test(token.query) || (row.bot?.name ?? t('Everyone')).length > token.query.trimEnd().length).slice(0, 12).map(row => ({ kind: 'mention', key: row.bot?.id ?? `everyone:${row.room.id}`, label: row.bot?.name ?? t('Everyone'), description: row.bot?.role ?? (row.room ? t('{count} members', { count: row.room.members.length }) : ''), icon: icons(row), text: row.text }))
  }
  const eligible = focused && !disabled && !blocked && !inComposition && trigger && closed !== key
  const items = eligible ? readRows(trigger) : []
  const index = selected.key === key ? Math.min(selected.index, Math.max(0, items.length - 1)) : 0
  const shown = eligible && (items.length > 0 || trigger.kind === 'command')
  useLayoutEffect(() => {
    const list = panel.current; const row = list?.children[index]
    if (!shown || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }, [shown, key, index])
  const pick = item => {
    if (isBlocked() || composing.current) return
    const node = field.current; const current = node.value
    const token = composerTrigger(current, node.selectionStart, node.selectionEnd)
    if (!token || current !== text || token.kind !== item.kind) return
    const row = readRows(token).find(value => value.key === item.key)
    if (!row) return
    try {
      if (row.kind === 'command') row.entry.ui.run({ sessionId })
      const insertion = replaceComposerTrigger(current, token, row.kind === 'mention' ? row.text : '')
      pending.current = { ...insertion, focus: row.kind === 'mention' }
      setClosed(signature(insertion.text, composerTrigger(insertion.text, insertion.caret)))
      setText(value => value === current ? insertion.text : value)
    } catch (error) { onError(error.message); setClosed(key) }
  }
  const onKeyDown = event => {
    if (!shown || isBlocked()) return false
    const action = menuKeyAction({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, isComposing: composing.current || event.nativeEvent.isComposing, keyCode: event.keyCode }, items.length, index)
    if (!action) return false
    event.preventDefault(); event.stopPropagation()
    if (action.kind === 'close') setClosed(key)
    else if (action.kind === 'move') setSelected({ key, index: action.index })
    else pick(items[action.index])
    return true
  }
  const runCommand = value => {
    const name = commandName(value)
    const row = name ? commandRows().find(item => item.key === name) : null
    if (!row) return false
    if (isBlocked() || composing.current) throw new Error('当前聊天不可执行操作；请等待连接或输入法确认。')
    row.entry.ui.run({ sessionId }); setClosed(key)
    return true
  }
  return {
    isBlocked, onKeyDown, runCommand, onSelect: select,
    inputProps: {
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-haspopup': 'listbox', 'aria-expanded': Boolean(shown),
      'aria-controls': shown ? listId : undefined, 'aria-activedescendant': shown && items.length ? `${listId}-${index}` : undefined,
      onSelect: select, onKeyUp: select, onFocus: () => { setFocused(true); select() }, onBlur: () => setFocused(false),
      onCompositionStart: () => { composing.current = true; setInComposition(true) },
      onCompositionEnd: () => { composing.current = false; setInComposition(false); select() },
    },
    content: shown ? h('div', { ref: panel, id: listId, className: 'deck-composer-menu', role: 'listbox', 'aria-label': trigger.kind === 'mention' ? t('Bots') : 'DS-Bot 命令' },
      items.length ? items.map((row, at) => h('button', { key: row.key, id: `${listId}-${at}`, type: 'button', role: 'option', tabIndex: -1, 'aria-selected': at === index, onPointerDown: event => event.preventDefault(), onPointerEnter: () => setSelected({ key, index: at }), onClick: () => pick(row) },
        h(row.icon, { size: 18 }), h('span', null, h('strong', null, row.kind === 'command' ? `/${row.key} · ${row.label}` : row.label), row.description ? h('small', null, row.description) : null)))
        : h('p', { className: 'deck-composer-empty', role: 'status' }, '这里只提供当前会话可用的 DS-Bot 定时任务和目标动作；当前没有匹配项。')) : null,
  }
}
