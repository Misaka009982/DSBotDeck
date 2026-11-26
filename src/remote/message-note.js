// SPDX-License-Identifier: Apache-2.0
// 增补协作与诊断保持原类型和公开正文；缺关联编号不猜测可跳转的 Bot。
import { createElement as h, useContext, useState } from 'react'
import { messageExchange, internalEntries } from '../shared/chat-model.ts'
import { BotMark } from '@dsbot/client/mark.js'
import { t } from '@dsbot/client/i18n.js'
import { diagnosticEntries } from '../shared/diagnostic-history.ts'
import { ResourceContext } from './resource-read.js'
export { DiagnosticHistoryModel } from '../shared/diagnostic-history.ts'
function NoteText({ item }) {
  return h('div', null,
    typeof item.text === 'string' ? h('pre', null, item.text) : null,
    typeof item.detail === 'string' ? h('pre', null, item.detail) : null)
}
function DiagnosticNotes({ entries }) {
  const [open, setOpen] = useState(false)
  return h('details', { className: 'deck-message-note deck-diagnostic-group', 'data-error': '', onToggle: event => {
    if (event.currentTarget === event.target) setOpen(event.currentTarget.open)
  } },
  h('summary', null, entries.length === 1 ? entries[0].title : `失败与重试 · ${entries.length} 条记录`),
  open ? h('ol', { className: 'deck-diagnostic-list' }, entries.map((item, index) => h('li', { key: item.seq ?? `legacy-${index}` },
    h('strong', null, item.title), h(NoteText, { item })))) : null)
}
export function MessageNote({ item, EventLine }) {
  const internal = item.kind === 'internal'
  const context = useContext(ResourceContext)
  const allowed = context.roster?.extras?.schema === 1 && context.roster.extras.fullMessages === true
  const sources = internalEntries(item)
  const pair = internal && allowed ? messageExchange(item, context.roster?.byId) : null
  if (pair && sources.length > 0 && sources.every(source => {
    const current = messageExchange(source, context.roster?.byId)
    return current?.[0] === pair[0] && current[1] === pair[1]
  })) {
    const sender = context.roster.byId[pair[0]]
    const prefix = item.role === 'stopped' ? t('Stopped by') : sources.length > 1 ? t('{count} messages with', { count: sources.length }) : t('Message from')
    if (!context.cached && EventLine) return h(EventLine, { prefix, bots: [sender], whole: true, onOpen: () => context.actions?.openExchange(pair[0], pair[1]) })
    return h('div', { className: 'bt-event', role: 'note' }, h('span', null, prefix), h(BotMark, { bot: sender, size: 16 }), h('span', { className: 'bt-event-name' }, sender.name))
  }
  const entries = diagnosticEntries(item)
  if (entries.length > 0) return h(DiagnosticNotes, { entries })
  return h('details', { className: internal ? 'deck-internal-note' : 'deck-message-note', 'data-error': internal ? undefined : '' },
    h('summary', null, item.title || (internal ? '内部协作记录' : '模型状态'), item.name ? ` · ${item.name}` : ''),
    internal ? h('p', { className: 'deck-tool-limit' }, allowed ? '服务器未提供可验证的原交换来源，或该来源已不可见。' : '当前设备没有完整消息授权，不能打开协作交换。') : null,
    !internal || allowed ? h(NoteText, { item }) : null)
}
