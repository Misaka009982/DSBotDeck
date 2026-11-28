// SPDX-License-Identifier: Apache-2.0
// 文件树行、图标、预览与样式来自固定上游；这里只承接远程授权和分页。
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from '@dsbot/client/icons.js'
import { FilePreview as UpstreamPreview } from '@dsbot/ui/file-preview.js'
import { RefreshIcon, TreeBranch } from '@dsbot/ui/right-panel.js'
import { currentResourceSession } from '../shared/resource-model.ts'
import { appendWorkspaceDirectory, workspaceDirectory, workspaceFile, workspaceRoot } from '../shared/workspace-model.ts'
import { workspacePreview, workspaceSnapshotIdentity, workspaceTreeEntries } from '../shared/workspace-display.ts'
import { WorkspaceEditor, workspaceDrafts } from './workspace-editor.js'
import { ReadState, useResourceContext, useResourceRead } from './resource-read.js'
function FilePreview({ target, root, path, enabled, line }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const [editing, setEditing] = useState(() => workspaceDrafts.get(target, path) !== undefined)
  const reader = useResourceRead({ identity: JSON.stringify([workspaceSnapshotIdentity(context.roster, target, context.selection), root.rootId, path]),
    retain: true, epoch: context.epoch, enabled: enabled && context.available && Date.now() < root.expiresAt, node,
    read: async (_cursor, signal) => workspaceFile(await call('extra-workspace-read', { rootId: root.rootId, path,
      ...(context.roster?.extras?.workspace?.readOnlyPreview === true ? { readOnly: true } : {}) }, signal), root, path) })
  const file = reader.value
  const writable = enabled && context.available && !reader.stale && !reader.busy && !file?.redacted && root.writable && context.access.write
  return h('div', { ref: node, className: 'deck-workspace-preview' },
    file ? h('div', { className: 'dsb-ft-bar' },
      h('span', { className: 'deck-resource-note', role: 'status' }, reader.stale ? '上次读取的缓存 · 可继续阅读，刷新后核对当前版本' : file.redacted ? '只读 · 已遮盖敏感内容' : '服务器当前文件'),
      h('div', { className: 'dsb-ft-actions' },
        !file.redacted && root.writable && context.access.write ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: !writable, onClick: () => setEditing(value => !value) }, editing ? '预览' : '编辑') : null,
        h('button', { type: 'button', className: 'bt-icon-btn', disabled: !enabled || !context.available || reader.busy, title: '重新读取文件', 'aria-label': '重新读取文件', onClick: reader.reload }, h(RefreshIcon)))) : null,
    file && reader.error ? h('p', { className: 'dsb-pv-note', role: 'status' }, '读取暂未完成，继续显示上次内容。') : null,
    editing && writable && file ? h(WorkspaceEditor, { target, root, path, onClose: () => { setEditing(false); reader.reload() } })
      : h(UpstreamPreview, { key: JSON.stringify([root.rootId, path]), file: file ? workspacePreview(file) : null, line,
        loading: reader.busy && !file, error: file ? null : reader.error ?? (!enabled ? '此文件尚未加载，请恢复连接并刷新工作区后读取。' : null),
        onRetry: enabled && context.available ? reader.reload : null }))
}
function DirectoryOrder({ path, descending, onToggle }) {
  const label = `${path || '工作区'}：按文件名${descending ? '正序' : '倒序'}`
  return h('button', { type: 'button', className: 'bt-icon-btn deck-directory-order', title: label, 'aria-label': label,
    'aria-pressed': descending, onClick: () => onToggle(path) }, h(descending ? ArrowDownIcon : ArrowUpIcon))
}
function DirectoryRows({ root, path = '', depth = 0, expanded, toggle, reversed, toggleOrder, selected, onOpenFile, filter, showHidden, enabled }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const reader = useResourceRead({ identity: JSON.stringify([root.rootId, path]), retain: true, epoch: context.epoch,
    enabled: enabled && context.available && Date.now() < root.expiresAt, node,
    read: async (cursor, signal) => workspaceDirectory(await call('extra-workspace-list', { rootId: root.rootId, path, ...(cursor ? { cursor } : {}) }, signal), root, path, cursor),
    merge: appendWorkspaceDirectory })
  const page = reader.value
  useEffect(() => {
    if (enabled && context.available && !reader.busy && !reader.stale && !reader.error && page?.cursor && !page.limited) reader.more(page.cursor)
  }, [page, enabled, context.available, reader.busy, reader.stale, reader.error])
  const descending = reversed.has(path)
  const entries = useMemo(() => page ? workspaceTreeEntries(page, descending).filter(entry => showHidden || !entry.name.startsWith('.')) : [], [page, descending, showHidden])
  return h('div', { ref: node, role: path ? 'group' : undefined, className: 'deck-tree-branch' },
    h(ReadState, { reader, enabled: enabled && context.available }), entries.map(entry => h('div', { key: entry.path },
      // 原行组件继续承担展开和选择；目录旁的排序按钮只改变该目录的子项。
      h('div', { className: 'deck-tree-row' },
        h(TreeBranch, { entries: [entry], depth, ancestors: new Set(), expanded, childrenByPath: {}, loadingDirs: new Set(),
          selectedPath: selected, filter: entry.kind === 'dir' ? '' : filter, onToggleDir: toggle, onSelectFile: onOpenFile,
          onContextMenu: () => {} }),
        entry.kind === 'dir' ? h(DirectoryOrder, { path: entry.path, descending: reversed.has(entry.path), onToggle: toggleOrder }) : null),
      entry.kind === 'dir' && expanded.has(entry.path) && depth < 31 ? h(DirectoryRows, { root, path: entry.path, depth: depth + 1, expanded, toggle, reversed, toggleOrder, selected, onOpenFile, filter, showHidden, enabled }) : null)),
    page && entries.length === 0 && !reader.busy ? h('p', { className: 'dsb-pv-note' }, page.filtered ? '没有可公开的条目' : '目录为空或条目已隐藏') : null,
    page ? h('p', { className: 'dsb-pv-note deck-directory-count', role: 'status' }, `已读取 ${page.entries.length} 项`,
      page.limited ? ' · 达到每目录 4096 项上限' : page.cursor ? reader.stale || reader.error ? ' · 尚未读完，请刷新目录' : ' · 正在继续读取…' : '') : null)
}
function Directory({ root, enabled, selected, onOpenFile }) {
  const [expanded, setExpanded] = useState(() => new Set()); const [filter, setFilter] = useState(''); const [showHidden, setShowHidden] = useState(false)
  const [revision, setRevision] = useState(0); const [notice, setNotice] = useState(null)
  const [reversed, setReversed] = useState(() => new Set())
  const toggleOrder = path => setReversed(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next })
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
        h(DirectoryOrder, { path: '', descending: reversed.has(''), onToggle: toggleOrder }),
        h('button', { type: 'button', className: 'bt-soft bt-soft-sm', 'aria-pressed': showHidden, onClick: () => setShowHidden(value => !value) }, showHidden ? '隐藏点文件' : '显示隐藏文件'),
        h('button', { type: 'button', className: 'bt-icon-btn', disabled: !enabled, title: '刷新目录', 'aria-label': '刷新目录', onClick: () => setRevision(value => value + 1) }, h(RefreshIcon)))),
    h('div', { className: 'dsb-ft-search' }, h('span', { className: 'dsb-ft-search-ico', 'aria-hidden': true }, h(SearchIcon)),
      h('input', { type: 'search', className: 'dsb-ft-search-input', value: filter, placeholder: '筛选已展开文件…', 'aria-label': '筛选已展开文件', onChange: event => setFilter(event.target.value) })),
    notice ? h('p', { className: 'dsb-pv-note', role: 'status' }, notice) : null,
    h('div', { className: 'dsb-ft-list', role: 'tree', 'aria-label': '工作区文件' },
      h(DirectoryRows, { key: revision, root, expanded, toggle, reversed, toggleOrder, selected, onOpenFile, filter, showHidden, enabled })))
}
export function WorkspacePane({ target, initialPath = null, active = true, tab = initialPath ? 'preview' : 'files', onOpenFile, line = null }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const current = currentResourceSession(context.roster, target)
  const established = useRef(null)
  const identity = workspaceSnapshotIdentity(context.roster, target, context.selection)
  const reader = useResourceRead({ identity, retain: true, epoch: context.epoch, enabled: current && context.available && (active || established.current === identity), node,
    read: async (_cursor, signal) => workspaceRoot(await call('extra-workspace-open', target, signal), target) })
  const [expired, setExpired] = useState(null); const [localFile, setLocalFile] = useState(null)
  const root = reader.value
  if (root) established.current = identity
  useEffect(() => {
    if (!root) return
    const timer = setTimeout(() => setExpired(root.rootId), Math.max(0, Math.min(10 * 60_000, root.expiresAt - Date.now())))
    return () => clearTimeout(timer)
  }, [root])
  const valid = root && !reader.stale && !reader.busy && expired !== root.rootId && Date.now() < root.expiresAt
  const selected = initialPath ?? localFile
  const open = path => { if (onOpenFile) onOpenFile(path); else setLocalFile(path) }
  return h('div', { ref: node, className: 'dsb-ws-body deck-workspace', hidden: !active },
    context.reason ? h('p', { className: 'dsb-pv-note' }, root && context.access.state === 'ready' ? '已暂停远程读取，已加载的文件可继续阅读。' : context.reason) : null,
    !current ? h('p', { className: 'dsb-pv-note' }, '请回到当前会话浏览工作区。') : null,
    h(ReadState, { reader, enabled: active && current && context.available }),
    root && !valid ? h('div', { className: 'dsb-pv-note', role: 'status' }, '当前显示工作区缓存；重新连接工作区后才能读取或编辑服务器文件。',
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: !active || !current || !context.available || reader.busy, onClick: reader.reload }, '重新连接工作区')) : null,
    root ? h('div', { className: 'dsb-ws-pane', hidden: tab !== 'files' || !!localFile }, h(Directory, { key: root.rootId, root, enabled: valid && active && tab === 'files' && !localFile, selected, onOpenFile: open })) : null,
    root && selected ? h('div', { className: 'dsb-ws-pane', hidden: tab !== 'preview' && !localFile },
      localFile ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setLocalFile(null) }, '返回文件树') : null,
      h(FilePreview, { key: `${root.rootId}:${selected}`, target, root, path: selected, line, enabled: valid && active && context.available && current && (tab === 'preview' || !!localFile) })) : null)
}
