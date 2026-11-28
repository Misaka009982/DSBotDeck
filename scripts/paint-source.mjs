// SPDX-License-Identifier: Apache-2.0
// 不修改上游文件；构建内存中增加结果呈现回调、只读工具摘要，并隐藏不需要的控制入口。
import path from 'node:path'
import { COMPONENT_UI_FILES, composerAttachmentsSource, paintComponents } from './paint-components.mjs'
const slash = value => value.replaceAll('\\', '/')
const TOOL_STEPS_IMPORT = "import { ToolSteps } from '@dsbotdeck/tool-steps'\nimport { ToolHistoryModel, toolGroupKey } from '@dsbotdeck/tool-history'\nimport { DiagnosticHistoryModel, MessageNote } from '@dsbotdeck/message-note'\nimport { groupInternalMessages } from '@dsbotdeck/chat-model'\n"
/** @type {Map<string, [string, string][]>} */
const SCOPE_EDITS = new Map([
  ['ds-bot/src/client/user-message.js', [
    ['function Attachments({ attachments, renderMessageImages }) {', 'export function Attachments({ attachments, renderMessageImages }) {'],
  ]],
  ['app/ui/src/tool-view-shared.js', [
    ['export function MiniCopy({ text }) {', 'export function MiniCopy({ text, onCopy, disabled = false }) {'],
    ['    void writeClipboard(text).then((ok) => {', '    if (disabled) return\n    void Promise.resolve(onCopy ? onCopy(text) : writeClipboard(text)).then((ok) => {'],
    ["    className: 'bt-mini dsb-tool-copy',", "    className: 'bt-mini dsb-tool-copy', disabled,"],
  ]],
  ['ds-bot/src/client/settings.js', [
    ["import { ProvidersPage } from './providers-page.js'", "import { ProvidersPage } from './providers-page.js'\nimport { ModelSettings } from '@dsbotdeck/model-settings'"],
    ["  const advanced = resolvedPage === 'models' && id === 'advanced' && hasSection(dsh, 'models')", "  const advanced = resolvedPage === 'models' && typeof id === 'string' && (id === 'advanced' || id.startsWith('advanced:')) && hasProviders"],
    ["advanced: hasSection(dsh, 'models') ? () => actions.openSettings('models', 'advanced') : null", "advanced: () => actions.openSettings('models', 'advanced')"],
    ["advanced ? h('div', { className: 'bt-dsh-section' }, dsh.renderSlot('settings.section', { close }, { only: 'models' })) : null", "advanced ? h(ModelSettings, { actions, initialProvider: id.startsWith('advanced:') ? id.slice(9) : '', leaving }) : null"],
    ["hasAdvancedModels: hasSection(dsh, 'models')", 'hasAdvancedModels: hasProviders'],
    ["pages: [['computer', 'Computer use'], ['browser', 'Browser'], ['capabilities', 'Capabilities'], ['secrets', 'Secrets']]", "pages: [['browser', 'Browser'], ['capabilities', 'Capabilities'], ['secrets', 'Secrets']]"],
    ["tools: 'computer', guide: 'overview'", "tools: 'capabilities', guide: 'overview'"],
  ]],
  ['ds-bot/src/client/providers-page.js', [
    ["import { ChatGPTSettings } from './chatgpt-settings.js'", "import { ChatGPTSettings } from './chatgpt-settings.js'\nimport { ProviderModelActions } from '@dsbotdeck/model-settings'"],
    ['      !isChatGPT && provider.key?.writable ? h(KeyEditor, { provider, apply, actions }) : null,', '      h(ProviderModelActions, { provider, actions }),\n      !isChatGPT && provider.key?.writable ? h(KeyEditor, { provider, apply, actions }) : null,'],
  ]],
  ['ds-bot/src/client/appearance-page.js', [
    ['function ThemeCard({ id, theme, current, dark, pick, children }) {', 'export function ThemeCard({ id, theme, current, dark, pick, children }) {'],
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
    ["export function ProposalCard({ proposal, initialError = '', onFailure, onResolved, actions }) {", "export function ProposalCard({ proposal, initialError = '', onFailure, onResolved, actions, disabled = false }) {"],
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
    ['    approval.answerable\n', '    approval.answerable === true\n'],
    ['  const canAlways = Boolean(approval.alwaysAllow) && !readOnly', '  const canAlways = false'],
  ]],
])
export const SCOPED_UI_FILES = [...SCOPE_EDITS.keys(), ...COMPONENT_UI_FILES, 'app/ui/src/right-panel.js', 'app/ui/src/workspace-terminal.js']
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`上游 UI 接入结构已变化，请更新只读构建适配；锚点：${before.slice(0, 120)}`)
  return source.replace(before, after)
}
export function paintSource(source, id, root) {
  const name = slash(path.relative(root, id))
  const component = paintComponents(source, name)
  if (component !== null) return component
  // 只读提取原桌面的无传输呈现；本机 watch、文件打开及 PTY 接口不进入远程依赖图。
  if (name === 'app/ui/src/right-panel.js') {
    source = source.replaceAll('\r\n', '\n')
    const first = 'const RefreshIcon = () =>'; const last = 'const WINDOWS_DRIVE_ABS_RE ='
    if (source.split(first).length !== 2 || source.split(last).length !== 2) throw new Error('上游工作区结构已变化，请更新远程适配。')
    return "import { createElement as h } from 'react'\nimport { fileSizeText } from './primitives.js'\nimport { t } from '../../../ds-bot/src/client/i18n.js'\nimport { ChevronRightIcon, DiffIcon, FileIcon, FolderIcon, TerminalIcon } from '../../../ds-bot/src/client/icons.js'\n"
      + source.slice(source.indexOf(first), source.indexOf(last)).replace('const RefreshIcon =', 'export const RefreshIcon =').replace('function TreeBranch(', 'export function TreeBranch(')
  }
  if (name === 'app/ui/src/workspace-terminal.js') {
    source = source.replaceAll('\r\n', '\n')
    const first = 'export function readXtermTheme() {'; const last = 'export function createTerminalKeyHandler('
    if (source.split(first).length !== 2 || source.split(last).length !== 2) throw new Error('上游终端主题结构已变化，请更新远程适配。')
    const font = source.match(/^const DEFAULT_MONO_FONT = .+$/m)?.[0]
    if (!font) throw new Error('上游终端字体结构已变化，请更新远程适配。')
    return font + '\n' + source.slice(source.indexOf(first), source.indexOf(last))
  }
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
      "    const value = await call('state', { since: known.revision, models: known.modelsKey ?? '', live: liveKey, locale: language() })\n    if (order < applied) return",
      "    const value = await call('state', { since: full ? -1 : known.revision, models: known.modelsKey ?? '', live: full ? undefined : liveKey, locale: language() }, signal)\n    if (full && (signal?.aborted || value.unchanged || !Number.isSafeInteger(value.revision) || !Array.isArray(value.bots) || !Array.isArray(value.rooms) || order < applied || value.revision < roster.getSnapshot().revision)) throw new DeckError('bot/stale', '完整目标状态未取得，请重新读取。')\n    if (order < applied) return")
    source = replaceOnce(source,
      '    if (value.unchanged || (value.revision === current.revision && value.modelsKey === current.modelsKey)) {',
      '    if (value.unchanged || (!full && value.revision === current.revision && value.modelsKey === current.modelsKey)) {')
    source = replaceOnce(source, '  const actions = {', '  const actions = {\n    deckRefreshLearning: async signal => { await pull(true, signal); return roster.getSnapshot() },\n    deckRefreshGoals: async signal => { await pull(true, signal); return roster.getSnapshot() },')
    source = replaceOnce(source,
      "      actions.noteLive(part, 'tool', doing?.tool ? { label: workPhrase(doing), state: toolState(doing.tool) } : null)",
      "      const tool = workToolNote(doing)\n      actions.noteLive(part, 'tool', tool ? { ...tool, state: toolState(tool.tool) } : null)")
    source = replaceOnce(source,
      '      setStatus(part, { running: busy })',
      "      setStatus(part, { running: busy })\n      const tool = workToolNote(rooms[room.id], r.byId)\n      actions.noteLive(part, 'tool', tool ? { ...tool, state: toolState(tool.tool) } : null)")
    source = replaceOnce(source,
      '    if (value.capabilityStatuses !== undefined && JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})) changed.capabilityStatuses = value.capabilityStatuses',
      '    if (value.capabilityStatuses !== undefined && JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})) changed.capabilityStatuses = value.capabilityStatuses\n    // 设备授权可以先于团队 revision 变化，不能被原增量早退忽略。\n    if (value.extras !== undefined && JSON.stringify(value.extras) !== JSON.stringify(current.extras ?? null)) changed.extras = value.extras')
    return "import { workToolNote } from '@dsbotdeck/tool-model'\nimport { DeckError } from '@dsbotdeck/validation'\n" + source
  }
  if (name === 'ds-bot/src/client/activity-row.js') {
    source = replaceOnce(source, 'inputAt > (tool?.at ?? 0)', 'preferInputStatus(inputAt, tool)')
    return "import { preferInputStatus } from '@dsbotdeck/tool-model'\n" + source
  }
  if (name === 'ds-bot/src/client/cells.js') {
    source = replaceOnce(source, "import { mdLabels, t } from './i18n.js'", "import { language, mdLabels, t } from './i18n.js'")
    // 已读取的聊天沿用原消息时间；待发送行未开启 clock，不把本机暂记时间当服务器回执。
    source = replaceOnce(source,
      '    const shown = chatRow(row, key, { sessionId, selfId, roster, actions, useUi, openFile, onBtwDelete, renderUserAttachments, renderUserText })',
      '    const shown = chatRow(row, key, { sessionId, selfId, roster, actions, useUi, openFile, onBtwDelete, renderUserAttachments, renderUserText, showTime: clock })')
    source = replaceOnce(source,
      'function chatRow(row, key, { sessionId, selfId, roster, actions, useUi, openFile, onBtwDelete, renderUserAttachments, renderUserText }) {',
      'function chatRow(row, key, { sessionId, selfId, roster, actions, useUi, openFile, onBtwDelete, renderUserAttachments, renderUserText, showTime = false }) {')
    source = replaceOnce(source,
      "    case 'user': return h(EarlierUser, { key, row, sessionId, roster, actions, renderUserAttachments, renderUserText })",
      "    case 'user': return h(EarlierUser, { key, row, sessionId, roster, actions, renderUserAttachments, renderUserText, showTime })")
    source = replaceOnce(source,
      "      const bubbles = h(Bubbles, { key, texts: row.texts, roster, selfId, actions, sessionId: useUi ? sessionId : undefined, msgKey: useUi ? `${sessionId}:${row.time}` : undefined, useUi, fold: FOLD_HUGE, textInteractionSource: true })\n      const speaker = layoutOf(roster.prefs) === 'flat' ? roster.byId[selfId] : undefined",
      "      const speaker = layoutOf(roster.prefs) === 'flat' ? roster.byId[selfId] : undefined\n      const bubbles = h(Bubbles, { key, texts: row.texts, roster, selfId, actions, sessionId: useUi ? sessionId : undefined, msgKey: useUi ? `${sessionId}:${row.time}` : undefined, useUi, fold: FOLD_HUGE, lang: language(), time: showTime && speaker === undefined ? row.time : undefined, textInteractionSource: true })")
    source = replaceOnce(source,
      "fileNames ? h('span', { className: 'bt-uimages', 'data-text-interaction-exclude': '' }, fileNames) : null",
      'fileNames ? h(UserAttachments, { files: row.fileRefs }) : null')
    source = "import { UserAttachments } from '@dsbotdeck/composer-attachments'\nimport { LearningHistoryCard } from '@dsbotdeck/learning-cards'\n" + source
    source = replaceOnce(source, 'function EventLine({ prefix, bots, joiner = t(\'and\'), onOpen, whole = false }) {', 'export function EventLine({ prefix, bots, joiner = t(\'and\'), onOpen, whole = false }) {')
    const anchor = "    case 'divider': return h(PartLine, { key, time: row.time })"
    source = replaceOnce(source, anchor, `    case 'steps': return h(ToolSteps, { key: toolGroupKey(row, sessionId, key), entry: row, scope: { sessionId, roomId: roster.roomsById[sessionId]?.id }, fullMessages: remoteReadMode(roster).fullMessages })\n    case 'internal': return h(MessageNote, { key, item: row, EventLine })\n    case 'diagnostic': return h(MessageNote, { key: row.deckDiagnosticGroupKey ?? key, item: row })\n    case 'deck-learning-settled': return h(LearningHistoryCard, { key: JSON.stringify(['learning', sessionId, row.proposal.id]), sessionId, proposal: row.proposal })\n${anchor}`)
    source = replaceOnce(source, '  let before\n  return rows.flatMap((row, index) => {', '  const toolHistory = useRef(null)\n  if (toolHistory.current === null) toolHistory.current = new ToolHistoryModel()\n  const diagnosticHistory = useRef(null)\n  if (diagnosticHistory.current === null) diagnosticHistory.current = new DiagnosticHistoryModel()\n  const displayRows = diagnosticHistory.current.group(groupInternalMessages(toolHistory.current.group(rows, { sessionId }), roster.byId, remoteReadMode(roster).fullMessages), { sessionId, fullMessages: remoteReadMode(roster).fullMessages })\n  let before\n  return displayRows.flatMap((row, index) => {')
    source = replaceOnce(source, '    const key = rows.length - index', '    const key = displayRows.length - index')
    source = replaceOnce(source,
      '      return h(EventLine, { key, prefix, bots: [other], onOpen: () => { if (selfId && other.id) actions.openExchange(selfId, other.id) }, whole: true })',
      '      return h(PeerEvent, { key, prefix, other, selfId, sessionId, roster, actions, EventLine })')
    return "import { PeerEvent } from '@dsbotdeck/peer-event'\nimport { remoteReadMode } from '@dsbotdeck/remote-capabilities'\n" + TOOL_STEPS_IMPORT + source
  }
  if (name === 'app/ui/src/chat.js') {
    // 只读复用新版原分页合并与群消息投影，不导入依赖本机日志的 Chat/Composer。
    const first = 'const sameItem = (a, b) =>'; const last = 'const userItemKey = item =>'
    if (source.split(first).length !== 2 || source.split(last).length !== 2) throw new Error('上游聊天分页结构已变化，请更新远程适配。')
    const start = source.indexOf(first); const end = source.indexOf(last)
    if (end <= start) throw new Error('上游聊天分页结构已变化，请更新远程适配。')
    return composerAttachmentsSource(source) + source.slice(start, end).replace('const sameItem =', 'export const sameItem =')
  }
  if (name === 'ds-bot/src/client/bot-tasks.js') {
    source = replaceOnce(source, "import { Elapsed } from './cells.js'", "import { Elapsed, EventLine } from './cells.js'")
    source = replaceOnce(source, 'useMemo, useRef, useState', 'useMemo, useRef, useState, useLayoutEffect, useContext')
    source = replaceOnce(source, 'const [showSteps, setShowSteps] = useState(false)', 'const [showSteps, setShowSteps] = useState(true)')
    source = replaceOnce(source, 'export function TaskReaderView({ bot, task, actions }) {', 'export function TaskReaderView({ bot, task, actions, fullMessages = false }) {')
    source = replaceOnce(source, '  const scrollRef = useRef(null)', '  const scrollRef = useRef(null)\n  const toolHistory = useRef(null)\n  if (toolHistory.current === null) toolHistory.current = new ToolHistoryModel()\n  const diagnosticHistory = useRef(null)\n  if (diagnosticHistory.current === null) diagnosticHistory.current = new DiagnosticHistoryModel()')
    source = replaceOnce(source, '  }, [botId, taskId, showSteps])', '  }, [botId, taskId, showSteps, fullMessages])')
    source = replaceOnce(source, '  const canAlways = Boolean(toolApproval?.alwaysAllow) && !readOnly', '  const canAlways = false')
    source = replaceOnce(source, '  const taskId = task?.id\n  const active = isActiveTask(task)', `  const taskId = task?.id
  const active = isActiveTask(task)
  const { cached, epoch } = useContext(ResourceContext)
  const deckAvailable = useRef(false); deckAvailable.current = !cached
  const deckReadScope = useRef(null); const deckFresh = useRef(false)`)
    source = replaceOnce(source, '  const loadLatest = useCallback(async (quiet = false, gen = reqGenRef.current, { force = false } = {}) => {', `  const noteReadError = err => {
    deckFresh.current = false
    if (errorCode(err) === 'RPC_ABORTED') { setError(''); return }
    if (errorCode(err) === 'bot/refused') {
      setPage(null); setOlder([]); setOlderCursor({ active: false, cursor: null })
    }
    setError(extraReadFailure(err))
  }
  const loadLatest = useCallback(async (quiet = false, gen = reqGenRef.current, { force = false } = {}) => {`)
    source = replaceOnce(source, "    if (!botId || !taskId || typeof readTask !== 'function') return", "    if (!deckAvailable.current || !botId || !taskId || typeof readTask !== 'function') return")
    source = replaceOnce(source, '          setPage(next)\n          setError(\'\')', '          deckFresh.current = true\n          setPage(next)\n          setError(\'\')')
    source = replaceOnce(source,
      "          setError(hostText(err?.message ?? String(err)))\n        }\n        if (mountedRef.current && !isQuiet",
      "          noteReadError(err)\n        }\n        if (mountedRef.current && !isQuiet")
    source = replaceOnce(source,
      "      setError(hostText(err?.message ?? String(err)))\n    } finally {\n      if (mountedRef.current && gen === reqGenRef.current) setLoadingMore(false)",
      "      noteReadError(err)\n    } finally {\n      if (mountedRef.current && gen === reqGenRef.current) setLoadingMore(false)")
    source = replaceOnce(source, `  useEffect(() => {
    reqGenRef.current += 1
    inFlightRef.current = false
    pendingReloadRef.current = false
    const gen = reqGenRef.current
    setOlder([])
    setOlderCursor({ active: false, cursor: null })
    setPage(null)
    void loadLatest(false, gen)
  }, [loadLatest])`, `  // 切服只暂停读取；目标或授权范围改变才清历史，切回已结束任务也会补读。
  useLayoutEffect(() => {
    const scope = JSON.stringify([botId, taskId, showSteps, fullMessages])
    const changed = deckReadScope.current !== scope
    deckReadScope.current = scope; deckFresh.current = false
    const gen = ++reqGenRef.current
    inFlightRef.current = false; pendingReloadRef.current = false; setLoadingMore(false); setError('')
    if (changed) { setPage(null); setOlder([]); setOlderCursor({ active: false, cursor: null }) }
    if (cached) setLoading(false)
    else void loadLatest(!changed && page !== null, gen)
    return () => { reqGenRef.current += 1 }
  }, [loadLatest, cached, epoch])`)
    source = replaceOnce(source, '    if (active) {\n      wasActiveRef.current = true', '    if (active && !cached) {\n      wasActiveRef.current = true')
    source = replaceOnce(source, '  }, [active, loadLatest])', '  }, [active, loadLatest, cached, epoch])')
    source = replaceOnce(source, "    if (!nextCursor || loadingMore || !botId || !taskId || typeof readTask !== 'function') return", "    if (!deckAvailable.current || !nextCursor || loadingMore || !botId || !taskId || typeof readTask !== 'function') return")
    source = replaceOnce(source, '  const items = [...uniqueOlder, ...latestItems]', '  const items = [...uniqueOlder, ...latestItems]\n  const displayItems = diagnosticHistory.current.group(toolHistory.current.group(items, { sessionId: page?.sessionId, targetId: taskId }), { sessionId: page?.sessionId, targetId: JSON.stringify([botId, taskId]), fullMessages })')
    source = replaceOnce(source, ': items.map((entry, idx) => {', ': displayItems.map((entry, idx) => {')
    const toolRows = "                return h('div', { key, className: 'bt-tread-steps' },\n                  tools.map((tool, sIdx) => h('div', { key: sIdx, className: 'bt-tread-step', 'data-ok': tool.ok === false ? 'false' : undefined },\n                    h('span', { className: 'bt-tread-step-dot', 'aria-hidden': true }),\n                    h('span', { className: 'bt-tread-step-name' }, tool.label || tool.name || 'tool'))))"
    source = replaceOnce(source, toolRows, '                return h(ToolSteps, { key: toolGroupKey(entry, page?.sessionId, key), entry, scope: { botId, taskId, sessionId: page?.sessionId }, fullMessages })')
    source = replaceOnce(source, "              if (entry.kind === 'steps') {", "              if (entry.kind === 'internal' || entry.kind === 'diagnostic') return h(MessageNote, { key: entry.deckDiagnosticGroupKey ?? key, item: entry, EventLine })\n              if (entry.kind === 'steps') {")
    const anchor = '  const nextCursor = olderCursor.active ? olderCursor.cursor : (page?.cursor ?? null)\n'
    source = replaceOnce(source, anchor, `${anchor}\n  const deckNoteTaskSeen = () => {\n    if (deckAvailable.current && deckFresh.current && !loading && !error && page !== null) actions.deckTaskPaint?.(botId, taskId, scrollRef.current)\n  }\n  useLayoutEffect(deckNoteTaskSeen, [page, loading, error, botId, taskId])\n`)
    source = replaceOnce(source, "h('div', { className: 'bt-tread-scroll', ref: scrollRef },", "h('div', { className: 'bt-tread-scroll', ref: scrollRef, onScroll: deckNoteTaskSeen },")
    source = replaceOnce(source, "    error ? h('div', { className: 'bt-tread-err', role: 'alert' }, error) : null,", "    h(TaskResourceEntries, { botId, taskId, sessionId: page?.sessionId ?? task.sessionId }),\n    error ? h('div', { className: 'bt-tread-err', role: 'alert' }, error) : null,")
    return "import { ResourceContext } from '@dsbotdeck/resource-read'\nimport { TaskResourceEntries } from '@dsbotdeck/resource-entry'\nimport { extraReadFailure } from '@dsbotdeck/extra-read'\nimport { errorCode } from '@dsbotdeck/validation'\n" + TOOL_STEPS_IMPORT + source
  }
  return null
}
