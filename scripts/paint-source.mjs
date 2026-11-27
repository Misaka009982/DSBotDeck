// SPDX-License-Identifier: Apache-2.0
// 不修改上游文件；构建内存中增加结果呈现回调、只读工具摘要，并隐藏不需要的控制入口。
import path from 'node:path'
const slash = value => value.replaceAll('\\', '/')
const TOOL_STEPS_IMPORT = "import { ToolSteps } from '@dsbotdeck/tool-steps'\nimport { ToolHistoryModel, toolGroupKey } from '@dsbotdeck/tool-history'\nimport { DiagnosticHistoryModel, MessageNote } from '@dsbotdeck/message-note'\nimport { groupInternalMessages } from '@dsbotdeck/chat-model'\n"
/** @type {Map<string, [string, string][]>} */
const SCOPE_EDITS = new Map([
  ['ds-bot/src/client/settings.js', [
    ["pages: [['computer', 'Computer use'], ['browser', 'Browser'], ['capabilities', 'Capabilities'], ['secrets', 'Secrets']]", "pages: [['browser', 'Browser'], ['capabilities', 'Capabilities'], ['secrets', 'Secrets']]"],
    ["tools: 'computer', guide: 'overview'", "tools: 'capabilities', guide: 'overview'"],
    ['\nfunction ThemeGallery({ themes, current, dark, onPick }) {', '\nexport function ThemeGallery({ themes, current, dark, onPick }) {'],
  ]],
  ['ds-bot/src/client/bot-settings.js', [
    ["import { t } from './i18n.js'", "import { t } from './i18n.js'\nimport { PrivateGoalSettings } from '@dsbotdeck/private-goal'"],
    ['    h(BotComputerCard, { bot, roster, actions, run, Card, Row }),\n', ''],
    ["    h(Card, { title: t('Profile') },", "    h(PrivateGoalSettings, { key: bot.id, botId: bot.id, Card }),\n    h(Card, { title: t('Profile') },"],
  ]],
  ['ds-bot/src/client/header.js', [
    ["import { t } from './i18n.js'", "import { t } from './i18n.js'\nimport { HeaderActions } from '@dsbotdeck/header-actions'"],
    ["  const pill = h('button', {", "  const pill = h(HeaderActions, {\n    botId: !away ? bot?.id : undefined, name, openSettings: actions.openSettings,"],
  ]],
  ['ds-bot/src/client/learning-card.js', [
    ["function ProposalCard({ proposal, initialError = '', onFailure, onResolved, actions }) {", "export function ProposalCard({ proposal, initialError = '', onFailure, onResolved, actions, disabled = false }) {"],
    ['    if (busyRef.current) return', '    if (busyRef.current || disabled) return'],
    ['    h(ProposalFoot, { busy, answer }))', '    h(ProposalFoot, { busy: busy || disabled, answer }))'],
  ]],
  ['ds-bot/src/client/details-drawer.js', [
    ["    ...(bot ? ['browser'] : []),\n    ...(bot && roster.computer?.enabled === true ? ['computer'] : []),\n", ''],
  ]],
  ['ds-bot/src/client/team-actions.js', [
    ["import { noteClientError } from './diagnostics.js'", "import { noteClientError } from './diagnostics.js'\nimport { readExtraPage } from '@dsbotdeck/extra-read'\nimport { remoteReadMode } from '@dsbotdeck/remote-capabilities'"],
    ["    readTask: (botId, taskId, cursor, steps = false) => call('bot-task-read', { botId, taskId, ...(cursor ? { cursor } : {}), ...(steps ? { steps: true } : {}) }),", "    readTask: (botId, taskId, cursor, steps = false) => { const mode = remoteReadMode(roster.getSnapshot()); return readExtraPage(call, 'extra-task-read', { botId, taskId, ...(cursor ? { cursor } : {}), ...(steps ? { steps: true } : {}), fullMessages: mode.fullMessages }, () => call('bot-task-read', { botId, taskId, ...(cursor ? { cursor } : {}), ...(steps ? { steps: true } : {}) }), mode.state) },"],
    ["    exchange: (a, b) => call('exchange', { a, b }).catch(() => []),", "    exchange: (a, b) => call('exchange', { a, b }),"],
    ["    exchangeText: (id, a, b) => call('exchange-text', { id, ...(a !== undefined && b !== undefined ? { a, b } : {}) }).catch(() => undefined),", "    exchangeText: (id, a, b) => call('exchange-text', { id, ...(a !== undefined && b !== undefined ? { a, b } : {}) }),"],
  ]],
  ['ds-bot/src/client/browser-pane.js', [
    ["import { t } from './i18n.js'", "import { t } from './i18n.js'\nimport { remoteReadMode } from '@dsbotdeck/remote-capabilities'"],
    ['h(TaskReaderView, { bot: taskBot, task: taskEntry, actions: panelActions })', 'h(TaskReaderView, { bot: taskBot, task: taskEntry, actions: panelActions, fullMessages: remoteReadMode(roster).fullMessages })'],
  ]],
  ['ds-bot/src/client/exchange.js', [
    ["import { t } from './i18n.js'", "import { t } from './i18n.js'\nimport { exchangeFailure, exchangeRows } from '@dsbotdeck/chat-model'"],
    ['  const [entries, setEntries] = useState(null)', '  const [entries, setEntries] = useState(null)\n  const [failure, setFailure] = useState(null)\n  const [retry, setRetry] = useState(0)'],
    [`    setEntries(null)
    const load = async () => {
      const result = await actions.exchange(pair[0], pair[1])
      if (stop) return
      const key = JSON.stringify(result ?? [])
      if (key !== seen) { seen = key; setEntries(result ?? []) }
      timer = setTimeout(load, document.hidden ? 8000 : 2000)
    }`, `    setEntries(null); setFailure(null)
    const load = async () => {
      try {
        const raw = await actions.exchange(pair[0], pair[1])
        if (stop) return
        const result = exchangeRows(raw)
        const key = JSON.stringify(result)
        if (key !== seen) { seen = key; setEntries(result) }
        timer = setTimeout(load, document.hidden ? 8000 : 2000)
      } catch (error) {
        // 拒绝、撤销或读取失败不伪装成空记录，也不继续自动轮询。
        if (stop) return
        setEntries(null); setFailure(exchangeFailure(error))
      }
    }`],
    ['  }, [pair[0], pair[1]])', '  }, [pair[0], pair[1], retry])'],
    ["        entries === null ? h('div', { className: 'bt-hint' }, t('Loading…'))", "        failure ? h('div', { className: 'deck-exchange-error', role: 'alert' }, failure, h('button', { type: 'button', className: 'bt-soft', disabled: leaving, onClick: () => setRetry(value => value + 1) }, '重新读取')) : null,\n        entries === null ? (failure ? null : h('div', { className: 'bt-hint' }, t('Loading…')))"],
  ]],
  ['ds-bot/src/client/settings-overview.js', [
    ["onOpen: () => actions.openSettings('computer'), value: capabilities.length", "onOpen: () => actions.openSettings('capabilities'), value: capabilities.length"],
    ["      roster.computer?.enabled ? h(Chip, null, t('Computer use')) : null,\n", ''],
  ]],
  ['ds-bot/src/client/member-status.js', [
    ["    // Group and background-task approvals are answered directly through DS Bot;\n    // foreground own-chat approvals still use DSH's own inline card.\n    approval.answerable && (approval.roomId !== undefined || approval.taskId !== undefined)", "    // Deck 前台、群聊与后台均复用服务器审批接口，不依赖 DSH 本机卡。\n    approval.answerable === true"],
  ]],
])
export const SCOPED_UI_FILES = [...SCOPE_EDITS.keys()]
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('上游 UI 接入结构已变化，请更新只读构建适配；未修改上游文件。')
  return source.replace(before, after)
}
export function paintSource(source, id, root) {
  const name = slash(path.relative(root, id))
  const scoped = SCOPE_EDITS.get(name)
  if (scoped !== undefined) {
    source = source.replaceAll('\r\n', '\n')
    for (const [before, after] of scoped) source = replaceOnce(source, before, after)
    return source
  }
  if (['app/ui/src/chat.js', 'app/ui/src/team.js', 'ds-bot/src/client/activity-row.js', 'ds-bot/src/client/bot-tasks.js', 'ds-bot/src/client/cells.js'].includes(name)) source = source.replaceAll('\r\n', '\n')
  if (name === 'app/ui/src/team.js') {
    source = replaceOnce(source, '  const pull = async () => {', '  const pull = async (full = false, signal) => {')
    source = replaceOnce(source,
      "    const value = await call('state', { since: known.revision, models: known.modelsKey ?? '', locale: language() })\n    if (order < applied) return",
      "    const value = await call('state', { since: full ? -1 : known.revision, models: known.modelsKey ?? '', locale: language() }, signal)\n    if (full && (signal?.aborted || value.unchanged || !Number.isSafeInteger(value.revision) || !Array.isArray(value.bots) || !Array.isArray(value.rooms) || order < applied || value.revision < roster.getSnapshot().revision)) throw new DeckError('bot/stale', '完整目标状态未取得，请重新读取。')\n    if (order < applied) return")
    source = replaceOnce(source,
      '    if (value.unchanged || (value.revision === current.revision && value.modelsKey === current.modelsKey)) return',
      '    if (value.unchanged || (!full && value.revision === current.revision && value.modelsKey === current.modelsKey)) return')
    source = replaceOnce(source, '  const actions = {', '  const actions = {\n    deckRefreshLearning: async signal => { await pull(true, signal); return roster.getSnapshot() },\n    deckRefreshGoals: async signal => { await pull(true, signal); return roster.getSnapshot() },')
    source = replaceOnce(source, '    const changed = {}', '    const changed = learningLiveChanges(current, value)')
    source = replaceOnce(source,
      "      actions.noteLive(part, 'tool', doing?.tool ? { label: workPhrase(doing), state: toolState(doing.tool) } : null)",
      "      const tool = workToolNote(doing)\n      actions.noteLive(part, 'tool', tool ? { ...tool, state: toolState(tool.tool) } : null)")
    source = replaceOnce(source,
      '      setStatus(part, { running: busy })',
      "      setStatus(part, { running: busy })\n      const tool = workToolNote(rooms[room.id], r.byId)\n      actions.noteLive(part, 'tool', tool ? { ...tool, state: toolState(tool.tool) } : null)")
    source = replaceOnce(source,
      '    if (value.capabilityStatuses !== undefined && JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})) changed.capabilityStatuses = value.capabilityStatuses',
      '    if (value.capabilityStatuses !== undefined && JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})) changed.capabilityStatuses = value.capabilityStatuses\n    // 设备授权可以先于团队 revision 变化，不能被原增量早退忽略。\n    if (value.extras !== undefined && JSON.stringify(value.extras) !== JSON.stringify(current.extras ?? null)) changed.extras = value.extras')
    return "import { workToolNote } from '@dsbotdeck/tool-model'\nimport { learningLiveChanges } from '@dsbotdeck/learning-model'\nimport { DeckError } from '@dsbotdeck/validation'\n" + source
  }
  if (name === 'ds-bot/src/client/activity-row.js') {
    source = replaceOnce(source, 'inputAt > (tool?.at ?? 0)', 'preferInputStatus(inputAt, tool)')
    return "import { preferInputStatus } from '@dsbotdeck/tool-model'\n" + source
  }
  if (name === 'ds-bot/src/client/cells.js') {
    source = replaceOnce(source, 'function EventLine({ prefix, bots, joiner = t(\'and\'), onOpen, whole = false }) {', 'export function EventLine({ prefix, bots, joiner = t(\'and\'), onOpen, whole = false }) {')
    const anchor = "    case 'divider': return h(PartLine, { key, time: row.time })"
    source = replaceOnce(source, anchor, `    case 'steps': return h(ToolSteps, { key: toolGroupKey(row, sessionId, key), entry: row, scope: { sessionId, roomId: roster.roomsById[sessionId]?.id }, fullMessages: remoteReadMode(roster).fullMessages })\n    case 'internal': return h(MessageNote, { key, item: row, EventLine })\n    case 'diagnostic': return h(MessageNote, { key: row.deckDiagnosticGroupKey ?? key, item: row })\n${anchor}`)
    source = replaceOnce(source, '  let before\n  return rows.flatMap((row, index) => {', '  const toolHistory = useRef(null)\n  if (toolHistory.current === null) toolHistory.current = new ToolHistoryModel()\n  const diagnosticHistory = useRef(null)\n  if (diagnosticHistory.current === null) diagnosticHistory.current = new DiagnosticHistoryModel()\n  const displayRows = diagnosticHistory.current.group(groupInternalMessages(toolHistory.current.group(rows, { sessionId }), roster.byId, remoteReadMode(roster).fullMessages), { sessionId, fullMessages: remoteReadMode(roster).fullMessages })\n  let before\n  return displayRows.flatMap((row, index) => {')
    source = replaceOnce(source, '    const key = rows.length - index', '    const key = displayRows.length - index')
    source = replaceOnce(source,
      '      return h(EventLine, { key, prefix, bots: [other], onOpen: () => { if (selfId && other.id) actions.openExchange(selfId, other.id) }, whole: true })',
      '      return h(PeerEvent, { key, prefix, other, selfId, sessionId, roster, actions, EventLine })')
    return "import { PeerEvent } from '@dsbotdeck/peer-event'\nimport { remoteReadMode } from '@dsbotdeck/remote-capabilities'\n" + TOOL_STEPS_IMPORT + source
  }
  if (name === 'app/ui/src/chat.js') {
    source = replaceOnce(source, "call('chat', { botId,", "call('chat', { botId, steps: true,")
    source = replaceOnce(source, "call('room-chat', { roomId,", "call('room-chat', { roomId, steps: true,")
    source = replaceOnce(source, 'function useChat(botId, roomId, part, feed) {', 'function useChat(botId, roomId, part, feed, fullMessages, extraReads) {')
    source = replaceOnce(source, '  const [stream, setStream] = useState(null)', '  const [stream, setStream] = useState(null)\n  const [failure, setFailure] = useState(null)')
    source = replaceOnce(source,
      "      const page = roomId !== undefined\n        ? await call('room-chat', { roomId, steps: true, ...(cursor ? { cursor } : {}) })\n        : await call('chat', { botId, steps: true, ...(cursor ? { cursor } : {}) })",
      "      const page = await readExtraPage(call, 'extra-messages', { ...(roomId !== undefined ? { roomId } : { botId }), ...(cursor ? { cursor } : {}), fullMessages }, () => roomId !== undefined\n        ? call('room-chat', { roomId, steps: true, ...(cursor ? { cursor } : {}) })\n        : call('chat', { botId, steps: true, ...(cursor ? { cursor } : {}) }), extraReads)")
    source = replaceOnce(source, '      const pageItems = roomId !== undefined ? adaptRoomItems(page.items)', '      setFailure(null)\n      const pageItems = roomId !== undefined ? adaptRoomItems(page.items)')
    source = replaceOnce(source,
      "    } catch {\n      if (gen.current !== myGen) return\n      ready.current = cursor !== undefined || refresh || ready.current\n      if (!refresh) setView(current => ({ ...current, loading: false, failed: true }))",
      "    } catch (error) {\n      if (gen.current !== myGen) return\n      setFailure({ message: extraReadFailure(error), cursor })\n      ready.current = cursor !== undefined || refresh || ready.current\n      setView(current => ({ ...current, loading: false, failed: true, ...(fullMessages && errorCode(error) === 'bot/refused' ? { items: [], sessionId: null } : {}) }))")
    source = replaceOnce(source, '  }, [active, botId, roomId, part])\n  const loadRef = useRef(load)', '  }, [active, botId, roomId, part, fullMessages, extraReads])\n  const loadRef = useRef(load)')
    source = replaceOnce(source, '  // A new part starts the chat over.\n  useEffect(() => {', '  // 换段或完整消息授权变化先释放旧历史，保留原 Composer 草稿。\n  useLayoutEffect(() => {')
    source = replaceOnce(source, '    setStream(null)\n    setView({ sessionId: null,', '    setStream(null); setFailure(null)\n    setView({ sessionId: null,')
    source = replaceOnce(source, '  }, [active, botId, roomId, part])\n\n  useEffect(() => feed.on', '  }, [active, botId, roomId, part, fullMessages, extraReads])\n\n  useEffect(() => feed.on')
    source = replaceOnce(source, '  return { view, stream, pending, load, send, keep }', '  return { view, stream, pending, load, send, keep, failure }')
    source = replaceOnce(source, '  const { view, stream, pending, load, send, keep } = useChat(bot?.id, room?.id, sessionId, feed)', '  const extraMode = remoteReadMode(roster)\n  const { view, stream, pending, load, send, keep, failure } = useChat(bot?.id, room?.id, sessionId, feed, extraMode.fullMessages, extraMode.state)')
    source = replaceOnce(source, 'onClick: () => load(view.cursor ?? undefined, scroller.current)', 'onClick: () => load(failure?.cursor, scroller.current)')
    source = replaceOnce(source, "        earlier ? h('div', { className: 'bt-earlier-top' }, earlier) : null,", "        failure ? h('p', { className: 'deck-chat-read-error', role: 'alert' }, failure.message) : null,\n        earlier ? h('div', { className: 'bt-earlier-top' }, earlier) : null,")
    source = replaceOnce(source, '  const inputActions = useInput(field, setText)', '  const inputActions = useInput(field, setText)\n  const menu = useComposerMenu({ sessionId, text, setText, field, disabled, actions, useRoster, onError: setError })')
    source = replaceOnce(source, "    if (value === '' || disabled) return", "    if (value === '' || disabled || menu.isBlocked()) return")
    source = replaceOnce(source, '      await onSend(value)', '      if (!menu.runCommand(value)) await onSend(value)')
    source = replaceOnce(source, "  return h('div', { className: 'dsb-composer-wrap' },\n", "  return h('div', { className: 'dsb-composer-wrap' },\n    menu.content,\n")
    source = replaceOnce(source, "          'data-composer-input': '',\n          onChange: event => setText(event.target.value),", "          'data-composer-input': '',\n          ...menu.inputProps,\n          onChange: event => { setText(event.target.value); menu.onSelect() },")
    source = replaceOnce(source, '          onKeyDown: (event) => {\n', '          onKeyDown: (event) => {\n            if (menu.onKeyDown(event)) return\n')
    source = replaceOnce(source,
      '  const running = hooks.useSessionStatus(map => map.get(sessionId)?.running === true)',
      '  const running = hooks.useSessionStatus(map => map.get(sessionId)?.running === true)\n  const approvalKey = hooks.useWork(work => JSON.stringify(room === undefined ? foregroundApprovals(work, bot?.id, sessionId) : []))\n  const approvals = JSON.parse(approvalKey)')
    source = replaceOnce(source, '[view.items, stream, pending, running, question]', '[view.items, stream, pending, running, question, approvalKey, roster.learning, roster.learningSettled]')
    source = replaceOnce(source,
      "          question ? h(PendingQuestion, { key: JSON.stringify([sessionId, question.id]), sessionId, question, actions, inline: true, enterToSend: sendsOnEnter(roster.prefs) }) : null))),",
      "          question ? h(PendingQuestion, { key: JSON.stringify([sessionId, question.id]), sessionId, question, actions, inline: true, enterToSend: sendsOnEnter(roster.prefs) }) : null,\n          h(LearningCards, { sessionId })))),")
    source = replaceOnce(source,
      "    h('div', { className: 'dsb-composer-root' },",
      "    h('div', { className: 'dsb-composer-root' },\n      approvals.length ? h('div', { className: 'deck-chat-approvals', role: 'group', 'aria-label': t('Approval') }, approvals.map(approval => h(ApprovalCard, { key: approval.id, approval, bot, actions, showBot: true }))) : null,")
    const feed = '  useEffect(() => feed.on((event, data) => {\n'
    source = replaceOnce(source, feed, `  // 保留原读取上下文，工具变化只合并刷新可见且非缓存的聊天。\n  useEffect(() => {\n    const read = loadRef.current\n    const generation = gen.current\n    const available = () => gen.current === generation && loadRef.current === read && document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached')\n    const latest = () => { if (ready.current && available()) void read(undefined, undefined, true) }\n    const dispose = watchToolSteps(feed, { botId, roomId, sessionId: part }, latest, available)\n    document.addEventListener('visibilitychange', latest)\n    return () => { dispose(); document.removeEventListener('visibilitychange', latest) }\n  }, [feed, botId, roomId, part, fullMessages, extraReads])\n\n${feed}`)
    const anchor = '  const onScroll = () => {\n'
    source = replaceOnce(source, anchor, `  // 本地远程壳只在成功布局最新一页后确认对应结果。\n  useLayoutEffect(() => {\n    if (!view.loading && !view.failed && view.sessionId !== null) team.deckPaint?.(bot?.id, room?.id, scroller.current)\n  }, [view.items, view.loading, view.failed, view.sessionId])\n\n${anchor}`)
    source = replaceOnce(source, '    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX\n', '    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX\n    if (follow.current && !view.loading && !view.failed) team.deckPaint?.(bot?.id, room?.id, node)\n')
    return "import { readExtraPage, extraReadFailure } from '@dsbotdeck/extra-read'\nimport { remoteReadMode } from '@dsbotdeck/remote-capabilities'\nimport { errorCode } from '@dsbotdeck/validation'\nimport { useComposerMenu } from '@dsbotdeck/composer-menu'\nimport { foregroundApprovals } from '@dsbotdeck/approval-model'\nimport { ApprovalCard } from '@dsbot/client/member-status.js'\nimport { LearningCards } from '@dsbotdeck/learning-cards'\nimport { watchToolSteps } from '@dsbotdeck/tool-refresh'\n" + source
  }
  if (name === 'ds-bot/src/client/bot-tasks.js') {
    source = replaceOnce(source, "import { Elapsed } from './cells.js'", "import { Elapsed, EventLine } from './cells.js'")
    source = replaceOnce(source, 'useMemo, useRef, useState', 'useMemo, useRef, useState, useLayoutEffect')
    source = replaceOnce(source, 'const [showSteps, setShowSteps] = useState(false)', 'const [showSteps, setShowSteps] = useState(true)')
    source = replaceOnce(source, 'export function TaskReaderView({ bot, task, actions }) {', 'export function TaskReaderView({ bot, task, actions, fullMessages = false }) {')
    source = replaceOnce(source, '  const scrollRef = useRef(null)', '  const scrollRef = useRef(null)\n  const toolHistory = useRef(null)\n  if (toolHistory.current === null) toolHistory.current = new ToolHistoryModel()\n  const diagnosticHistory = useRef(null)\n  if (diagnosticHistory.current === null) diagnosticHistory.current = new DiagnosticHistoryModel()')
    source = replaceOnce(source, '  }, [botId, taskId, showSteps])', '  }, [botId, taskId, showSteps, fullMessages])')
    source = replaceOnce(source, '  const loadLatest = useCallback(async (quiet = false, gen = reqGenRef.current) => {', `  const noteReadError = err => {
    if (fullMessages && errorCode(err) === 'bot/refused') {
      setPage(null); setOlder([]); setOlderCursor({ active: false, cursor: null })
    }
    setError(extraReadFailure(err))
  }
  const loadLatest = useCallback(async (quiet = false, gen = reqGenRef.current) => {`)
    source = replaceOnce(source,
      "      setError(hostText(err?.message ?? String(err)))\n    } finally {\n      if (mountedRef.current && !quiet && gen === reqGenRef.current) setLoading(false)",
      "      noteReadError(err)\n    } finally {\n      if (mountedRef.current && !quiet && gen === reqGenRef.current) setLoading(false)")
    source = replaceOnce(source,
      "      setError(hostText(err?.message ?? String(err)))\n    } finally {\n      if (mountedRef.current && gen === reqGenRef.current) setLoadingMore(false)",
      "      noteReadError(err)\n    } finally {\n      if (mountedRef.current && gen === reqGenRef.current) setLoadingMore(false)")
    source = replaceOnce(source, '  useEffect(() => {\n    reqGenRef.current += 1', '  // 权限或目标变化在绘制前清旧页，迟到回包沿用原代次检查。\n  useLayoutEffect(() => {\n    setLoadingMore(false)\n    reqGenRef.current += 1')
    source = replaceOnce(source, '  const items = [...uniqueOlder, ...latestItems]', '  const items = [...uniqueOlder, ...latestItems]\n  const displayItems = diagnosticHistory.current.group(toolHistory.current.group(items, { sessionId: page?.sessionId, targetId: taskId }), { sessionId: page?.sessionId, targetId: JSON.stringify([botId, taskId]), fullMessages })')
    source = replaceOnce(source, ': items.map((entry, idx) => {', ': displayItems.map((entry, idx) => {')
    const toolRows = "                return h('div', { key, className: 'bt-tread-steps' },\n                  tools.map((tool, sIdx) => h('div', { key: sIdx, className: 'bt-tread-step', 'data-ok': tool.ok === false ? 'false' : undefined },\n                    h('span', { className: 'bt-tread-step-dot', 'aria-hidden': true }),\n                    h('span', { className: 'bt-tread-step-name' }, tool.label || tool.name || 'tool'))))"
    source = replaceOnce(source, toolRows, '                return h(ToolSteps, { key: toolGroupKey(entry, page?.sessionId, key), entry, scope: { botId, taskId, sessionId: page?.sessionId }, fullMessages })')
    source = replaceOnce(source, "              if (entry.kind === 'steps') {", "              if (entry.kind === 'internal' || entry.kind === 'diagnostic') return h(MessageNote, { key: entry.deckDiagnosticGroupKey ?? key, item: entry, EventLine })\n              if (entry.kind === 'steps') {")
    const anchor = '  const nextCursor = olderCursor.active ? olderCursor.cursor : (page?.cursor ?? null)\n'
    source = replaceOnce(source, anchor, `${anchor}\n  const deckNoteTaskSeen = () => {\n    if (!loading && !error && page !== null) actions.deckTaskPaint?.(botId, taskId, scrollRef.current)\n  }\n  useLayoutEffect(deckNoteTaskSeen, [page, loading, error, botId, taskId])\n`)
    source = replaceOnce(source, "h('div', { className: 'bt-tread-scroll', ref: scrollRef },", "h('div', { className: 'bt-tread-scroll', ref: scrollRef, onScroll: deckNoteTaskSeen },")
    source = replaceOnce(source, "    error ? h('div', { className: 'bt-tread-err', role: 'alert' }, error) : null,", "    h(TaskResourceEntries, { botId, taskId, sessionId: page?.sessionId ?? task.sessionId }),\n    error ? h('div', { className: 'bt-tread-err', role: 'alert' }, error) : null,")
    return "import { TaskResourceEntries } from '@dsbotdeck/resource-entry'\nimport { extraReadFailure } from '@dsbotdeck/extra-read'\nimport { errorCode } from '@dsbotdeck/validation'\n" + TOOL_STEPS_IMPORT + source
  }
  return null
}
