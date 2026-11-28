// SPDX-License-Identifier: Apache-2.0
// 复用原 team 的标签状态与 BotPanel，只给 workspace.render 接远程资源。
import { createElement as h, useLayoutEffect, useRef, useState } from 'react'
import { buildWorkspaceTabs } from '@dsbot/ui/right-panel.js'
import { currentResourceSession, moduleAccess, sessionResourceTarget } from '../shared/resource-model.ts'
import { workspaceSnapshotIdentity } from '../shared/workspace-display.ts'
import { workspacePath } from '../shared/workspace-model.ts'
import { WorkspacePane } from './workspace-pane.js'
import { TerminalPane } from './terminal-pane.js'
export function useRemoteWorkspace({ team, roster, shown, cached, epoch }) {
  const { actions, hooks } = team
  const ui = hooks.useUi(value => value)
  const [opened, setOpened] = useState(null)
  const original = useRef(null); const live = useRef(null)
  if (!original.current) original.current = { openFiles: actions.openFiles, openFile: actions.openFile, newTerminal: actions.newTerminal,
    canOpenFiles: actions.canOpenFiles, canOpenTerminal: actions.canOpenTerminal }
  live.current = { roster, shown, cached }
  const available = (target, module) => !!target && !live.current.cached
    && moduleAccess(live.current.roster?.extras, module).state !== 'missing'
    && (module === 'terminals' || currentResourceSession(live.current.roster, target))
  const open = (target, module) => {
    if (!available(target, module)) return
    setOpened({ target, selection: live.current.shown })
    actions.toggleDetails(target.scope.kind === 'room' ? target.scope.roomId : target.scope.botId, true)
    if (module === 'workspace') original.current.openFiles()
    else actions.setRightPanelTab('terminal')
  }
  useLayoutEffect(() => {
    const current = () => sessionResourceTarget(live.current.roster, live.current.shown)
    actions.canOpenFiles = () => available(current(), 'workspace')
    actions.canOpenTerminal = () => available(current(), 'terminals')
    actions.openFiles = () => open(current(), 'workspace')
    actions.newTerminal = () => open(current(), 'terminals')
    actions.openFile = input => {
      const target = current()
      if (!available(target, 'workspace') || input?.sessionId && input.sessionId !== target.sessionId) return
      try {
        const path = workspacePath(typeof input === 'string' ? input : input?.path)
        setOpened({ target, selection: live.current.shown })
        original.current.openFile({ path, sessionId: target.sessionId, line: input?.line })
      } catch { actions.notice('请从当前工作区文件树选择文件。') }
    }
    return () => { Object.assign(actions, original.current) }
  }, [actions])
  useLayoutEffect(() => { setOpened(null) }, [shown])
  const target = opened?.selection === shown ? opened.target : sessionResourceTarget(roster, shown)
  const panel = ui.rightPanel
  const tabs = buildWorkspaceTabs(panel).filter(tab => ['files', 'preview', 'terminal'].includes(tab.id))
  const boundary = target ? workspaceSnapshotIdentity(roster, target, shown) : null
  const workspace = {
    tabs, active: panel?.tab ?? null,
    onSelect: id => actions.setRightPanelTab(id), onCloseTab: id => actions.closeWorkspaceTab(id),
    render: (tab, visible) => target ? h('div', { key: boundary, className: 'dsb-ws-body' },
      tabs.some(item => item.id === 'files' || item.id === 'preview') ? h(WorkspacePane, { target, active: visible && ['files', 'preview'].includes(tab), tab,
        initialPath: panel?.fileSessionId && panel.fileSessionId !== target.sessionId ? null : panel?.file,
        line: panel?.fileLine,
        onOpenFile: path => original.current.openFile({ path, sessionId: target.sessionId }) }) : null,
      visible && tab === 'terminal' ? h(TerminalPane, { key: JSON.stringify([epoch, cached]), target }) : null) : null,
  }
  return { workspace, openWorkspace: open }
}
