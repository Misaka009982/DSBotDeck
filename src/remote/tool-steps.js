// SPDX-License-Identifier: Apache-2.0
// 工具摘要只读显示，不执行命令、不提供电脑或浏览器接管。
import { createElement as h } from 'react'
import { hostText } from '@dsbot/client/i18n.js'
import { toolSummaries } from '../shared/tool-model.ts'
import './tool-steps.css'
const OUTCOMES = {
  success: { text: '成功', hint: '服务器确认该工具执行成功。' },
  failure: { text: '失败', hint: '服务器确认该工具失败，不等于整个任务失败。' },
  unknown: { text: '未确认', hint: '服务器没有提供该工具的结果；不代表仍在运行或已经失败。' },
}
export function ToolSteps({ entry }) {
  const tools = toolSummaries(entry)
  if (tools.length === 0) return null
  const turn = Number.isSafeInteger(entry.turn) && entry.turn >= 0 ? entry.turn : null
  return h('details', { className: 'bt-tread-steps deck-tool-steps' },
    h('summary', { className: 'deck-tool-heading', title: '展开或收起服务器公开的工具摘要。' },
      h('span', { className: 'deck-tool-chevron', 'aria-hidden': true }, '›'),
      h('span', null, `用了 ${tools.length} 个工具`),
      turn === null ? null : h('span', { className: 'deck-tool-count' }, `轮次 ${turn}`)),
    h('div', { className: 'deck-tool-list' }, tools.map((tool, index) => {
      const outcome = OUTCOMES[tool.outcome]
      return h('div', { key: `${tool.name ?? 'missing'}:${index}`, className: 'bt-tread-step', 'data-outcome': tool.outcome },
        h('span', { className: 'bt-tread-step-dot', 'aria-hidden': true }),
        h('div', { className: 'bt-tread-step-name' },
          h('code', { className: 'deck-tool-name' }, tool.name ?? '工具名未提供'),
          tool.label && tool.label !== tool.name ? h('span', { className: 'deck-tool-label' }, hostText(tool.label)) : null),
        h('span', { className: 'deck-tool-outcome', title: outcome.hint }, outcome.text))
    })),
    h('p', { className: 'deck-tool-limit' }, '当前服务器未提供调用参数和完整输出。“未确认”表示没有返回明确结果。'))
}
