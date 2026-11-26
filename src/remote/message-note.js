// SPDX-License-Identifier: Apache-2.0
// 增补协作与诊断保持原类型和公开正文；缺关联编号不猜测可跳转的 Bot。
import { createElement as h, useContext } from 'react'
import { messageExchange } from '../shared/chat-model.ts'
import { ResourceContext } from './resource-read.js'
export function MessageNote({ item }) {
  const internal = item.kind === 'internal'
  const context = useContext(ResourceContext)
  const allowed = context.roster?.extras?.schema === 1 && context.roster.extras.fullMessages === true
  const pair = internal && allowed ? messageExchange(item, context.roster?.byId) : null
  return h('details', { className: 'deck-message-note', 'data-error': internal ? undefined : '' },
    h('summary', null, item.title || (internal ? '内部协作记录' : '模型状态'), item.name ? ` · ${item.name}` : ''),
    internal ? pair ? h('button', { type: 'button', className: 'bt-soft', disabled: context.cached, onClick: () => context.actions?.openExchange(pair[0], pair[1]) }, '查看原 Bot 交换记录')
      : h('p', { className: 'deck-tool-limit' }, allowed ? '服务器未提供可验证的原交换来源，或该来源已不可见。' : '当前设备没有完整消息授权，不能打开协作交换。') : null,
    typeof item.text === 'string' ? h('pre', null, item.text) : null,
    typeof item.detail === 'string' ? h('pre', null, item.detail) : null)
}
