// SPDX-License-Identifier: Apache-2.0
// 气泡间连续工具只占一条总数；单项展开直接读参数和输出，不执行命令。
import { createElement as h, useContext, useRef, useState } from 'react'
import { hostText } from '@dsbot/client/i18n.js'
import { toolGroupRows } from '../shared/tool-history.ts'
import { toolCallKey } from '../shared/tool-model.ts'
import { toolPresentation } from '../shared/tool-display.ts'
import { ChangeDetail } from './change-detail.js'
import { ResourceContext } from './resource-read.js'
import { moduleAccess } from '../shared/resource-model.ts'
import { ToolDetailField, useDetailAvailability, useToolDetail } from './tool-detail.js'
import './tool-steps.css'
const OUTCOMES = {
  success: { text: '成功', hint: '服务器确认该工具执行成功。' },
  failure: { text: '失败', hint: '服务器确认该工具失败，不等于整个任务失败。' },
  unknown: { text: '未确认', hint: '服务器没有提供该工具的结果；不代表仍在运行或已经失败。' },
}
function ToolCall({ tool, index, scope, fullMessages, available, allowed, onDenied }) {
  const [open, setOpen] = useState(false); const [changeOpen, setChangeOpen] = useState(false)
  const { roster } = useContext(ResourceContext)
  const changes = moduleAccess(roster?.extras, 'toolChanges')
  const node = useRef(null)
  const argumentsReader = useToolDetail({ tool, scope, field: 'arguments', fullMessages, enabled: available && open, node, allowed, onDenied })
  const outputReader = useToolDetail({ tool, scope, field: 'output', fullMessages, enabled: available && open, node, allowed, onDenied })
  const args = argumentsReader.value
  const completeArgs = args?.available && !args.previewLimited && args.offset === 0 && args.nextOffset === null ? args.text : null
  const view = toolPresentation({ ...tool, label: tool.label ? hostText(tool.label) : null }, completeArgs, roster?.byId?.[tool.reference?.sessionId ?? scope.sessionId]?.workDir)
  const status = tool.outcome !== 'unknown' ? tool.outcome : outputReader.value?.outcome ?? args?.outcome ?? 'unknown'
  const outcome = OUTCOMES[status]
  return h('details', { ref: node, className: 'deck-tool-call', 'data-outcome': status, onToggle: event => {
    if (event.currentTarget !== event.target) return
    setOpen(event.currentTarget.open)
    if (!event.currentTarget.open) setChangeOpen(false)
  } },
    h('summary', { className: 'bt-tread-step deck-tool-call-heading', title: `${view.title} · ${tool.name ?? '工具名未提供'} · ${outcome.text}` },
      h('span', { className: 'deck-tool-chevron', 'aria-hidden': true }, '›'),
      h('span', { className: 'bt-tread-step-name' }, h('strong', { className: 'deck-tool-description' }, view.title)),
      status !== 'success' ? h('span', { className: 'deck-tool-outcome', title: outcome.hint }, outcome.text) : null),
    open ? h('div', { className: 'deck-tool-call-body' },
      h('div', { className: 'deck-tool-meta' }, h('code', { className: 'deck-tool-name' }, tool.name ?? '工具名未提供'),
        h('span', null, `调用 ${index + 1} · ${tool.turn === null ? '轮次未提供' : `轮次 ${tool.turn}`} · ${outcome.text}`)),
      !available ? h('p', { className: 'deck-tool-limit' }, '缓存或隐藏期间不读取工具正文。')
        : !tool.reference ? h('p', { className: 'deck-tool-limit' }, '服务器只提供名称和状态，缺少调用编号，参数与输出暂不能读取。')
          : h('div', null,
            h(ToolDetailField, { reader: argumentsReader, field: 'arguments', name: tool.name }),
            h(ToolDetailField, { reader: outputReader, field: 'output', name: tool.name }),
            ['write', 'edit', 'apply_patch'].includes(tool.name) && changes.state !== 'missing' ? h('details', { className: 'deck-tool-output', open: changeOpen,
              onToggle: event => { if (event.currentTarget === event.target) setChangeOpen(event.currentTarget.open) } },
              h('summary', null, '已记录的文件修改'), changeOpen ? h(ChangeDetail, { reference: tool.reference }) : null) : null)) : null)
}
export function ToolSteps({ entry, scope = {}, fullMessages = false }) {
  const [open, setOpen] = useState(false); const [denied, setDenied] = useState(null)
  const denial = useRef(false)
  const context = useContext(ResourceContext)
  const visible = useDetailAvailability(); const available = visible && !context.cached
  const tools = toolGroupRows(entry, scope.sessionId)
  if (tools.length === 0) return null
  const clearDenial = () => { denial.current = false; setDenied(null) }
  const onDenied = message => { denial.current = true; setDenied(message) }
  return h('details', { className: 'bt-tread-steps deck-tool-steps', onToggle: event => {
    if (event.currentTarget !== event.target) return
    setOpen(event.currentTarget.open)
    if (!event.currentTarget.open) clearDenial()
  } },
    h('summary', { className: 'deck-tool-heading', title: '展开或收起服务器公开的工具记录。' },
      h('span', { className: 'deck-tool-chevron', 'aria-hidden': true }, '›'), h('span', null, `用了 ${tools.length} 个工具`)),
    open ? denied ? h('p', { className: 'deck-tool-error', role: 'alert' }, denied,
      h('button', { type: 'button', className: 'bt-soft', disabled: !available, onClick: clearDenial }, '重新展开工具列表'))
      : h('div', { className: 'deck-tool-list' }, tools.map((tool, index) => h(ToolCall, {
        key: JSON.stringify([tool.reference ? toolCallKey(tool.reference) : ['legacy', index], fullMessages, context.epoch, context.selection]),
        tool, index, scope, fullMessages, available, allowed: () => !denial.current, onDenied,
      })), h('p', { className: 'deck-tool-limit' }, '详情受服务器密钥保护，按需读取且保持只读；不代表每个字段都被遮盖，展开不会执行命令。')) : null)
}
