// SPDX-License-Identifier: Apache-2.0
// 文件树行、图标、预览与样式来自固定上游；这里只承接远程授权和分页。
import { createElement as h, useEffect, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { SearchIcon } from '@dsbot/client/icons.js'
import { FilePreview as UpstreamPreview } from '@dsbot/ui/file-preview.js'
import { RefreshIcon, TreeBranch } from '@dsbot/ui/right-panel.js'
import { currentResourceSession } from '../shared/resource-model.ts'
import { appendWorkspaceDirectory, workspaceDirectory, workspaceFile, workspaceRoot } from '../shared/workspace-model.ts'
import { workspacePreview, workspaceTreeEntries } from '../shared/workspace-display.ts'
import { WorkspaceEditor, workspaceDrafts } from './workspace-editor.js'
import { ReadState, useResourceContext, useResourceRead } from './resource-read.js'
function FilePreview({ target, root, path, enabled, line }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const [editing, setEditing] = useState(() => workspaceDrafts.get(target, path) !== undefined)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, root.rootId, path]), enabled: enabled && context.available && Date.now() < root.expiresAt, node,
    read: async (_cursor, signal) => workspaceFile(await call('extra-workspace-read', { rootId: root.rootId, path,
      ...(context.roster?.extras?.workspace?.readOnlyPreview === true ? { readOnly: true } : {}) }, signal), root, path) })
  const file = reader.value
  return h('div', { ref: node, className: 'deck-workspace-preview' },
    file ? h('div', { className: 'dsb-ft-bar' },
      h('span', { className: 'deck-resource-note' }, file.redacted ? '只读 · 已遮盖敏感内容' : '服务器当前文件'),
      h('div', { className: 'dsb-ft-actions' },
        !file.redacted && root.writable && context.access.write ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: reader.busy, onClick: () => setEditing(value => !value) }, editing ? '预览' : '编辑') : null,
        h('button', { type: 'button', className: 'bt-icon-btn', disabled: reader.busy, title: '重新读取文件', 'aria-label': '重新读取文件', onClick: reader.reload }, h(RefreshIcon)))) : null,
    editing && enabled && context.available && file ? h(WorkspaceEditor, { target, root, path, onClose: () => { setEditing(false); reader.reload() } })
      : h(UpstreamPreview, { key: JSON.stringify([root.rootId, path, !!file]), file: file ? workspacePreview(file) : null, line, loading: reader.busy, error: reader.error, onRetry: reader.reload }))
}
function DirectoryRows({ root, path = '', depth = 0, expanded, toggle, selected, onOpenFile, filter, showHidden, enabled }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, root.rootId, path]), enabled: enabled && context.available && Date.now() < root.expiresAt, node,
    read: async (cursor, signal) => workspaceDirectory(await call('extra-workspace-list', { rootId: root.rootId, path, ...(cursor ? { cursor } : {}) }, signal), root, path, cursor),
    merge: appendWorkspaceDirectory })
  const page = reader.value
  const entries = page ? workspaceTreeEntries(page).filter(entry => showHidden || !entry.name.startsWith('.')) : []
  return h('div', { ref: node, role: path ? 'group' : undefined, className: 'deck-tree-branch' },
    h(ReadState, { reader }), entries.map(entry => h('div', { key: entry.path },
      // 原行组件承担箭头、缩进、图标、省略号和选中态；展开的目录单独持有分页与取消句柄。
      h(TreeBranch, { entries: [entry], depth, ancestors: new Set(), expanded, childrenByPath: {}, loadingDirs: new Set(),
        selectedPath: selected, filter: entry.kind === 'dir' ? '' : filter, onToggleDir: toggle, onSelectFile: onOpenFile,
        onContextMenu: () => {} }),
      entry.kind === 'dir' && expanded.has(entry.path) && depth < 31 ? h(DirectoryRows, { root, path: entry.path, depth: depth + 1, expanded, toggle, selected, onOpenFile, filter, showHidden, enabled }) : null)),
    page && entries.length === 0 && !reader.busy ? h('p', { className: 'dsb-pv-note' }, page.filtered ? '没有可公开的条目' : '目录为空或条目已隐藏') : null,
    page?.cursor && !page.limited ? h('button', { type: 'button', className: 'dsb-ft-row deck-tree-more', disabled: reader.busy, style: { paddingLeft: `${26 + depth * 14}px` }, onClick: () => reader.more(page.cursor) }, '加载更多…') : null,
    page?.limited ? h('p', { className: 'dsb-pv-note' }, '本目录已显示 4096 项') : null)
}
function Directory({ root, enabled, selected, onOpenFile }) {
  const [expanded, setExpanded] = useState(() => new Set()); const [filter, setFilter] = useState(''); const [showHidden, setShowHidden] = useState(false)
  const [revision, setRevision] = useState(0); const [notice, setNotice] = useState(null)
  const toggle = path => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(path)) {
      for (const item of next) if (item === path || item.startsWith(`${path}/`)) next.delete(item)
    } else if (next.size < 64) next.add(path)
    else { setNotice('最多同时展开 64 个目录，请先收起部分目录。'); return previous }
    setNotice(null); return next
  })
  return h('div', { className: 'dsb-ft' },
    h('div', { className: 'dsb-ft-bar' }, h('span', { className: 'dsb-ft-root' }, '工作区'),
      h('div', { className: 'dsb-ft-actions' },
        h('button', { type: 'button', className: 'bt-soft bt-soft-sm', 'aria-pressed': showHidden, onClick: () => setShowHidden(value => !value) }, showHidden ? '隐藏点文件' : '显示隐藏文件'),
        h('button', { type: 'button', className: 'bt-icon-btn', title: '刷新目录', 'aria-label': '刷新目录', onClick: () => setRevision(value => value + 1) }, h(RefreshIcon)))),
    h('div', { className: 'dsb-ft-search' }, h('span', { className: 'dsb-ft-search-ico', 'aria-hidden': true }, h(SearchIcon)),
      h('input', { type: 'search', className: 'dsb-ft-search-input', value: filter, placeholder: '筛选已展开文件…', 'aria-label': '筛选已展开文件', onChange: event => setFilter(event.target.value) })),
    notice ? h('p', { className: 'dsb-pv-note', role: 'status' }, notice) : null,
    h('div', { className: 'dsb-ft-list', role: 'tree', 'aria-label': '工作区文件' },
      h(DirectoryRows, { key: revision, root, expanded, toggle, selected, onOpenFile, filter, showHidden, enabled })))
}
export function WorkspacePane({ target, initialPath = null, active = true, tab = initialPath ? 'preview' : 'files', onOpenFile, line = null }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const current = currentResourceSession(context.roster, target)
  const established = useRef(null)
  const identity = JSON.stringify([context.boundary, target, current])
  const reader = useResourceRead({ identity, enabled: current && context.available && (active || established.current === identity), node,
    read: async (_cursor, signal) => workspaceRoot(await call('extra-workspace-open', target, signal), target) })
  const [expired, setExpired] = useState(null); const [localFile, setLocalFile] = useState(null)
  const root = reader.value
  if (root) established.current = identity
  useEffect(() => {
    if (!root) return
    const timer = setTimeout(() => setExpired(root.rootId), Math.max(0, Math.min(10 * 60_000, root.expiresAt - Date.now())))
    return () => clearTimeout(timer)
  }, [root])
  const valid = root && expired !== root.rootId && Date.now() < root.expiresAt
  const selected = initialPath ?? localFile
  const open = path => { if (onOpenFile) onOpenFile(path); else setLocalFile(path) }
  return h('div', { ref: node, className: 'dsb-ws-body deck-workspace', hidden: !active },
    context.reason ? h('p', { className: 'dsb-pv-note' }, context.reason) : null,
    !current ? h('p', { className: 'dsb-pv-note' }, '请回到当前会话浏览工作区。') : null,
    h(ReadState, { reader }), root && !valid ? h('div', { className: 'dsb-rp-error' }, '工作区句柄已过期。', h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: reader.reload }, '重新打开')) : null,
    valid ? h('div', { className: 'dsb-ws-pane', hidden: tab !== 'files' || !!localFile }, h(Directory, { key: root.rootId, root, enabled: active && tab === 'files' && !localFile, selected, onOpenFile: open })) : null,
    valid && selected && (tab === 'preview' || localFile) ? h('div', { className: 'dsb-ws-pane' },
      localFile ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setLocalFile(null) }, '返回文件树') : null,
      h(FilePreview, { key: `${root.rootId}:${selected}`, target, root, path: selected, line, enabled: active && context.available && current })) : null)
}
