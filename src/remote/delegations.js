// SPDX-License-Identifier: Apache-2.0
import { createElement as h, useLayoutEffect, useRef, useState } from 'react'
import { SubagentLineageBar, SubagentReadOnlyBar } from '@dsbot/ui/subagent-viewer.js'
import { PeopleIcon, ChevronRightIcon } from '@dsbot/client/icons.js'
import { call } from '@dsbot/client/api.js'
import { appendDelegationHistory, appendDelegations, delegationList, delegationPage, delegationRequest, DELEGATION_STATUSES } from '../shared/delegation-model.ts'
import { resourceSessions } from '../shared/resource-model.ts'
import { onResourceDenied, ReadState, useResourceContext, useResourceRead } from './resource-read.js'
const SOURCES = { 'live-agent': '当前子 Agent', lifecycle: '委派生命周期', settlement: '历史结算通知' }
const MODES = { continuable: '可继续会话', 'one-shot': '单次委派', external: '外部委派', unknown: '类型未知' }
function Status({ child }) {
  return h('span', { className: 'deck-resource-note', 'data-status': child.status }, DELEGATION_STATUSES[child.status], ' · ', SOURCES[child.statusSource] ?? '没有当前状态证据')
}
function Result({ result, title }) {
  if (!result) return null
  return h('div', { className: 'deck-resource-result' }, h('strong', null, title),
    h('pre', null, result.text ?? '原结果超过读取预算，正文未传输。'),
    result.truncated ? h('p', { className: 'deck-resource-note' }, '内容不完整，完整结果请在服务器查看。') : null)
}
function DelegationHistory({ target, childPath }) {
  const context = useResourceContext('delegations'); const node = useRef(null)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, target, childPath, 'history']), enabled: context.available, node,
    read: async (cursor, signal) => delegationPage(await call('extra-delegation-read', { ...delegationRequest(target, childPath, true), ...(cursor ? { cursor } : {}) }, signal), target, childPath, cursor),
    merge: appendDelegationHistory })
  const page = reader.value
  return h('div', { ref: node, className: 'deck-delegation-history' },
    context.reason ? h('p', { className: 'deck-resource-note' }, context.reason) : null,
    h(ReadState, { reader }), page ? h('div', null,
      h(Status, { child: page.child }),
      h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: reader.reload }, '刷新当前状态'),
      h(Result, { result: page.result, title: page.result?.source === 'lifecycle' ? '委派结算结果' : '历史结算记录（不代表当前运行已结束）' }),
      page.lastTurn ? h('div', null, h('p', { className: 'deck-resource-note' }, `此历史切面的轮次 ${page.lastTurn.turn}：${page.lastTurn.status === 'open' ? '尚未结束' : DELEGATION_STATUSES[page.lastTurn.status]}；轮次状态不等于整个委派状态。`),
        h(Result, { result: page.lastTurn.result, title: '该轮最后回复' })) : null,
      page.history === 'external' ? h('p', { className: 'deck-resource-note' }, '此委派在外部执行，没有可读取的本地子会话过程。') : h('div', null,
        h('ol', { className: 'deck-delegation-events' }, page.events.map(event => h('li', { key: event.seq },
          h('span', { className: 'deck-resource-note' }, `#${event.seq}${event.turn === null ? '' : ` · 轮次 ${event.turn}`}`),
          event.type === 'assistant/message' ? h('pre', null, event.text ?? '此条正文超过预算。') : h('span', null,
            event.type === 'turn/start' ? '轮次开始' : event.type === 'turn/end' ? `轮次结束：${DELEGATION_STATUSES[event.status]}`
              : event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start' ? `调用 ${event.name ?? '工具名未提供'} · ${event.callId}` : `工具结果：${DELEGATION_STATUSES[event.status]} · ${event.callId}`),
          event.truncated ? h('span', { className: 'deck-resource-note' }, '（本条不完整）') : null))),
        page.events.length === 0 ? h('p', { className: 'deck-resource-note' }, '本页没有可公开的过程记录。') : null,
        page.cursor && !page.limited ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => reader.more(page.cursor) }, '更早过程') : null,
        page.limited ? h('p', { className: 'deck-resource-note' }, '已达到 256 条过程记录上限；保留已读内容，更多历史请在服务器查看。') : null)) : null)
}
function Child({ child, onSelect }) {
  return h('button', { type: 'button', className: 'dsb-ft-row deck-delegation-row', onClick: () => onSelect(child) },
    h('span', { className: 'dsb-ft-ico', 'aria-hidden': true }, h(PeopleIcon)),
    h('span', { className: 'deck-delegation-label' }, h('strong', null, child.label ?? child.childId), h(Status, { child })),
    h(ChevronRightIcon))
}
function DelegationList({ target, childPath = [], onSelect }) {
  const context = useResourceContext('delegations'); const node = useRef(null)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, target, childPath, 'list']), enabled: context.available, node,
    read: async (after, signal) => delegationList(await call('extra-delegation-list', { ...delegationRequest(target, childPath), ...(after ? { afterChildId: after } : {}) }, signal), target, childPath, after),
    merge: appendDelegations })
  const page = reader.value
  return h('div', { ref: node, className: 'deck-delegation-list' },
    context.reason ? h('p', { className: 'deck-resource-note' }, context.reason) : null,
    h(ReadState, { reader }), page ? h('div', null,
      h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: reader.reload }, '刷新委派目录'),
      page.items.length === 0 ? h('p', { className: 'deck-resource-note' }, '此父会话没有记录直接子委派。') : null,
      page.items.map(child => h(Child, { key: child.childId, child, onSelect: value => { if (reader.canCopy(page)) onSelect(value) } })),
      page.nextAfterChildId && !page.limited ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => reader.more(page.nextAfterChildId) }, '更多委派') : null,
      page.limited ? h('p', { className: 'deck-resource-note' }, '已达到 512 项目录上限，更多委派请在服务器查看。') : null) : null)
}
function DelegationBrowser({ target }) {
  const [stack, setStack] = useState([]); const [nested, setNested] = useState(false)
  const context = useResourceContext('delegations')
  useLayoutEffect(() => onResourceDenied(() => { setStack([]); setNested(false) }), [])
  const selectDepth = depth => { setStack(value => value.slice(0, depth)); setNested(false) }
  const back = () => selectDepth(stack.length - 1)
  const path = stack.map(child => child.childId)
  const child = stack.at(-1)
  const open = child => { if (context.available) { setStack(value => [...value, child]); setNested(false) } }
  return h('div', { className: 'deck-delegation-browser', onKeyDown: event => {
    if (!child || event.defaultPrevented || event.key !== 'Escape' || event.nativeEvent?.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    if (event.target.closest('input,textarea,select,[contenteditable=true]')) return
    event.preventDefault(); event.stopPropagation(); back()
  } },
    h(SubagentLineageBar, { stack: stack.map(child => ({ sessionId: child.childId, label: child.label, mode: child.mode })), rootLabel: '父会话', onBack: back, onSelectDepth: selectDepth }),
    child ? h('div', { key: JSON.stringify(path), className: 'deck-delegation-detail' },
      h('p', { className: 'deck-resource-note' }, `${MODES[child.mode]} · ${child.childId}`),
      child.lastSettlement ? h('p', { className: 'deck-resource-note' }, `最近历史结算：${DELEGATION_STATUSES[child.lastSettlement.status]}（#${child.lastSettlement.seq}）`) : null,
      h(DelegationHistory, { target, childPath: path }),
      child.mode !== 'external' && path.length < 8 ? h('div', null,
        h('button', { type: 'button', className: 'bt-soft bt-soft-sm', 'aria-expanded': nested, onClick: () => setNested(value => !value) }, nested ? '收起下级委派' : '查看下级委派'),
        nested ? h(DelegationList, { target, childPath: path, onSelect: open }) : null) : null,
      h(SubagentReadOnlyBar, { onBack: back })) : h(DelegationList, { target, onSelect: open }))
}
export function Delegations({ target }) {
  const context = useResourceContext('delegations')
  const sessions = resourceSessions(context.roster, target)
  const [selected, setSelected] = useState(target.sessionId)
  const known = sessions.includes(selected)
  return h('div', null,
    h('label', { className: 'deck-resource-target' }, '父会话 ', h('select', { value: selected, onChange: event => setSelected(event.target.value) },
      !known ? h('option', { value: selected, disabled: true }, '原父会话已不在可选目录中') : null,
      sessions.map(id => h('option', { key: id, value: id }, `${id === target.sessionId ? '当前选中' : '其他已登记会话'} · ${id}`)))),
    h('p', { className: 'deck-resource-note' }, '子 Agent 委派与 Bot 后台任务分别记录；此面板只读，不启动或控制 Agent。父会话最多列出256项。'),
    known ? h(DelegationBrowser, { key: JSON.stringify([selected, context.boundary]), target: { ...target, sessionId: selected } })
      : h('p', { className: 'deck-resource-note' }, '原父会话已不在当前可选范围，请重新选择；没有自动改读其他父会话。'))
}
