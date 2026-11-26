// SPDX-License-Identifier: Apache-2.0
// 有公开来源时沿用原交换按钮；缺失来源不制造点了无响应的伪按钮。
import { createElement as h } from 'react'
import { BotMark } from '@dsbot/client/mark.js'
import { botExchangePair } from '../shared/chat-model.ts'
export function PeerEvent({ prefix, other, selfId, sessionId, roster, actions, EventLine }) {
  const pair = botExchangePair(selfId ?? sessionId, other.id, roster.byId)
  if (pair) return h(EventLine, { prefix, bots: [other], whole: true, onOpen: () => actions.openExchange(pair[0], pair[1]) })
  return h('div', { className: 'bt-event', role: 'note' },
    h('span', null, prefix), h(BotMark, { bot: other, size: 16 }), h('span', { className: 'bt-event-name' }, other.name),
    h('span', { className: 'deck-peer-note' }, other.id ? '来源不在当前 Bot 目录，无法打开交换记录' : '服务器未提供发送者编号，暂不能打开交换记录'))
}
