// SPDX-License-Identifier: Apache-2.0
import { createElement as h, useContext, useState } from 'react'
import { currentResourceSession, moduleAccess, resourceId } from '../shared/resource-model.ts'
import { ResourceContext, ResourcePanel } from './resource-read.js'
import { Delegations } from './delegations.js'
import { FolderIcon, TerminalIcon } from '@dsbot/client/icons.js'
import './resource-pane.css'
export function ResourceEntries({ target }) {
  const context = useContext(ResourceContext)
  const [opened, setOpened] = useState(null)
  if (!target || !resourceId(target.sessionId)) return null
  const delegations = moduleAccess(context.roster?.extras, 'delegations')
  const workspace = moduleAccess(context.roster?.extras, 'workspace')
  const terminals = moduleAccess(context.roster?.extras, 'terminals')
  const identity = JSON.stringify([target, context.epoch, context.selection])
  const selected = opened?.identity === identity ? opened.module : null
  const toggle = module => setOpened(selected === module ? null : { identity, module })
  const showFiles = workspace.state !== 'missing' && currentResourceSession(context.roster, target)
  if (delegations.state === 'missing' && !showFiles && terminals.state === 'missing') return null
  return h('div', { className: 'deck-resource-entry' },
    h('div', { className: 'deck-resource-actions', role: 'group', 'aria-label': '当前会话资源' },
      delegations.state !== 'missing' ? h('button', { type: 'button', className: 'bt-soft', 'aria-expanded': selected === 'delegations', onClick: () => toggle('delegations') }, '委派过程') : null,
      showFiles ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => context.openWorkspace?.(target, 'workspace') }, h(FolderIcon), '文件') : null,
      terminals.state !== 'missing' ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => context.openWorkspace?.(target, 'terminals') }, h(TerminalIcon), '终端') : null),
    selected === 'delegations' ? h(ResourcePanel, { key: JSON.stringify([identity, context.cached, delegations.state]), title: '委派过程', onClose: () => setOpened(null) }, h(Delegations, { target })) : null)
}
export function TaskResourceEntries({ botId, taskId, sessionId }) {
  return resourceId(botId) && resourceId(taskId) && resourceId(sessionId)
    ? h(ResourceEntries, { target: { scope: { kind: 'task', botId, taskId }, sessionId } }) : null
}
