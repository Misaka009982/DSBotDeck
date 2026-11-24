// SPDX-License-Identifier: Apache-2.0
// 不修改上游文件；构建内存中增加结果呈现回调、只读工具摘要，并隐藏不需要的控制入口。
import path from 'node:path'
const slash = value => value.replaceAll('\\', '/')
const TOOL_STEPS_IMPORT = "import { ToolSteps } from '@dsbotdeck/tool-steps'\n"
/** @type {Map<string, [string, string][]>} */
const SCOPE_EDITS = new Map([
  ['ds-bot/src/client/settings.js', [
    ["pages: [['computer', 'Computer use'], ['browser', 'Browser'], ['capabilities', 'Capabilities'], ['secrets', 'Secrets']]", "pages: [['browser', 'Browser'], ['capabilities', 'Capabilities'], ['secrets', 'Secrets']]"],
    ["tools: 'computer', guide: 'overview'", "tools: 'capabilities', guide: 'overview'"],
  ]],
  ['ds-bot/src/client/bot-settings.js', [
    ['    h(BotComputerCard, { bot, roster, actions, run, Card, Row }),\n', ''],
  ]],
  ['ds-bot/src/client/details-drawer.js', [
    ["    ...(bot ? ['browser'] : []),\n    ...(bot && roster.computer?.enabled === true ? ['computer'] : []),\n", ''],
  ]],
  ['ds-bot/src/client/settings-overview.js', [
    ["onOpen: () => actions.openSettings('computer'), value: capabilities.length", "onOpen: () => actions.openSettings('capabilities'), value: capabilities.length"],
    ["      roster.computer?.enabled ? h(Chip, null, t('Computer use')) : null,\n", ''],
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
  if (['app/ui/src/chat.js', 'ds-bot/src/client/bot-tasks.js', 'ds-bot/src/client/cells.js'].includes(name)) source = source.replaceAll('\r\n', '\n')
  if (name === 'ds-bot/src/client/cells.js') {
    const anchor = "    case 'divider': return h(PartLine, { key, time: row.time })"
    source = replaceOnce(source, anchor, `    case 'steps': return h(ToolSteps, { key, entry: row })\n${anchor}`)
    return TOOL_STEPS_IMPORT + source
  }
  if (name === 'app/ui/src/chat.js') {
    source = replaceOnce(source, "call('chat', { botId,", "call('chat', { botId, steps: true,")
    source = replaceOnce(source, "call('room-chat', { roomId,", "call('room-chat', { roomId, steps: true,")
    const feed = '  useEffect(() => feed.on((event, data) => {\n'
    source = replaceOnce(source, feed, `  // 保留原读取上下文，工具变化只合并刷新可见且非缓存的聊天。\n  useEffect(() => {\n    const read = loadRef.current\n    const generation = gen.current\n    const available = () => gen.current === generation && loadRef.current === read && document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached')\n    const latest = () => { if (ready.current && available()) void read(undefined, undefined, true) }\n    const dispose = watchToolSteps(feed, { botId, roomId, sessionId: part }, latest, available)\n    document.addEventListener('visibilitychange', latest)\n    return () => { dispose(); document.removeEventListener('visibilitychange', latest) }\n  }, [feed, botId, roomId, part])\n\n${feed}`)
    const anchor = '  const onScroll = () => {\n'
    source = replaceOnce(source, anchor, `  // 本地远程壳只在成功布局最新一页后确认对应结果。\n  useLayoutEffect(() => {\n    if (!view.loading && !view.failed && view.sessionId !== null) team.deckPaint?.(bot?.id, room?.id, scroller.current)\n  }, [view.items, view.loading, view.failed, view.sessionId])\n\n${anchor}`)
    source = replaceOnce(source, '    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX\n', '    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX\n    if (follow.current && !view.loading && !view.failed) team.deckPaint?.(bot?.id, room?.id, node)\n')
    return "import { watchToolSteps } from '@dsbotdeck/tool-refresh'\n" + source
  }
  if (name === 'ds-bot/src/client/bot-tasks.js') {
    source = replaceOnce(source, 'useMemo, useRef, useState', 'useMemo, useRef, useState, useLayoutEffect')
    source = replaceOnce(source, 'const [showSteps, setShowSteps] = useState(false)', 'const [showSteps, setShowSteps] = useState(true)')
    const toolRows = "                return h('div', { key, className: 'bt-tread-steps' },\n                  tools.map((tool, sIdx) => h('div', { key: sIdx, className: 'bt-tread-step', 'data-ok': tool.ok === false ? 'false' : undefined },\n                    h('span', { className: 'bt-tread-step-dot', 'aria-hidden': true }),\n                    h('span', { className: 'bt-tread-step-name' }, tool.label || tool.name || 'tool'))))"
    source = replaceOnce(source, toolRows, '                return h(ToolSteps, { key, entry })')
    const anchor = '  const nextCursor = olderCursor.active ? olderCursor.cursor : (page?.cursor ?? null)\n'
    source = replaceOnce(source, anchor, `${anchor}\n  const deckNoteTaskSeen = () => {\n    if (!loading && !error && page !== null) actions.deckTaskPaint?.(botId, taskId, scrollRef.current)\n  }\n  useLayoutEffect(deckNoteTaskSeen, [page, loading, error, botId, taskId])\n`)
    source = replaceOnce(source, "h('div', { className: 'bt-tread-scroll', ref: scrollRef },", "h('div', { className: 'bt-tread-scroll', ref: scrollRef, onScroll: deckNoteTaskSeen },")
    return TOOL_STEPS_IMPORT + source
  }
  return null
}
