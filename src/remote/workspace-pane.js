// SPDX-License-Identifier: Apache-2.0
import { createElement as h, useEffect, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { currentResourceSession } from '../shared/resource-model.ts'
import { appendWorkspaceDirectory, workspaceDirectory, workspaceFile, workspaceRoot } from '../shared/workspace-model.ts'
import { WorkspaceEditor, workspaceDrafts } from './workspace-editor.js'
import { ReadState, useResourceContext, useResourceRead } from './resource-read.js'
function FilePreview({ target, root, path, enabled }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const [editing, setEditing] = useState(() => workspaceDrafts.get(target, path) !== undefined)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, root.rootId, path]), enabled: enabled && context.available && Date.now() < root.expiresAt, node,
    read: async (_cursor, signal) => workspaceFile(await call('extra-workspace-read', { rootId: root.rootId, path,
      ...(context.roster?.extras?.workspace?.readOnlyPreview === true ? { readOnly: true } : {}) }, signal), root, path) })
  const file = reader.value
  return h('div', { ref: node, className: 'deck-workspace-preview' }, h(ReadState, { reader }),
    file ? h('div', null, h('strong', null, file.path),
      h('p', { className: 'deck-resource-note' }, '服务器当前文件 · 完整 UTF-8 文本 · 只读预览', file.redacted ? ' · 已遮盖敏感内容' : ''),
      h('pre', { tabIndex: 0 }, file.text === '' ? '（空文件）' : file.text),
      h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: reader.reload }, '重新读取当前文件'),
      !file.redacted && root.writable && context.access.write ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => setEditing(true) }, '编辑文件') : null) : null,
    editing && context.available ? h(WorkspaceEditor, { target, root, path, onClose: () => setEditing(false) }) : null)
}
function Directory({ target, root, enabled }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const [path, setPath] = useState(''); const [file, setFile] = useState(null)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, root.rootId, path]), enabled: enabled && context.available && Date.now() < root.expiresAt, node,
    read: async (cursor, signal) => workspaceDirectory(await call('extra-workspace-list', { rootId: root.rootId, path, ...(cursor ? { cursor } : {}) }, signal), root, path, cursor),
    merge: appendWorkspaceDirectory })
  const page = reader.value
  const open = next => { setFile(null); setPath(next) }
  return h('div', { ref: node },
    h('div', { className: 'deck-resource-heading' }, h('strong', null, path || '工作区根目录'),
      path ? h('button', { type: 'button', className: 'bt-soft', onClick: () => open(path.split('/').slice(0, -1).join('/')) }, '上一级') : null,
      h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => { setFile(null); reader.reload() } }, '刷新目录')),
    h(ReadState, { reader }), page ? h('div', null,
      h('ul', { className: 'deck-workspace-entries' }, page.entries.map(entry => {
        const next = path ? `${path}/${entry.name}` : entry.name
        return h('li', { key: entry.name }, h('button', { type: 'button', className: 'bt-soft', onClick: () => entry.type === 'directory' ? open(next) : setFile(next), 'aria-pressed': entry.type === 'file' ? file === next : undefined },
          entry.type === 'directory' ? '目录 · ' : '文件 · ', entry.name), entry.size === null || entry.type !== 'file' ? null : h('span', { className: 'deck-resource-note' }, `${entry.size} B`))
      })),
      page.entries.length === 0 ? h('p', { className: 'deck-resource-note' }, page.filtered ? '本目录没有可公开的条目。' : '目录为空。') : null,
      page.filtered ? h('p', { className: 'deck-resource-note' }, '服务器已过滤受保护或不可用的条目。') : null,
      page.cursor && !page.limited ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => reader.more(page.cursor) }, '更多条目') : null,
      page.limited ? h('p', { className: 'deck-resource-note' }, '目录展示达到 4096 项上限。') : null) : null,
    file && page ? h(FilePreview, { key: `${root.rootId}:${file}`, target, root, path: file, enabled }) : null)
}
export function WorkspacePane({ target, initialPath = null }) {
  const context = useResourceContext('workspace'); const node = useRef(null)
  const current = currentResourceSession(context.roster, target)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, target, current]), enabled: current && context.available, node,
    read: async (_cursor, signal) => workspaceRoot(await call('extra-workspace-open', target, signal), target) })
  const [expired, setExpired] = useState(null)
  const root = reader.value
  useEffect(() => {
    if (!root) return
    const timer = setTimeout(() => setExpired(root.rootId), Math.max(0, Math.min(10 * 60_000, root.expiresAt - Date.now())))
    return () => clearTimeout(timer)
  }, [root])
  const valid = root && expired !== root.rootId && Date.now() < root.expiresAt
  return h('div', { ref: node },
    h('p', { className: 'deck-resource-note' }, '浏览当前会话获授权的工作区，单文件最多 256 KiB。文件预览与历史工具修改分别读取。'),
    context.reason ? h('p', { className: 'deck-resource-note' }, context.reason) : null,
    !current ? h('p', { className: 'deck-resource-note' }, '历史会话不能用作当前工作区根；请回到当前会话。') : null,
    h(ReadState, { reader }), root && !valid ? h('p', { className: 'deck-resource-error' }, '工作区句柄已过期。', h('button', { type: 'button', className: 'bt-soft', onClick: reader.reload }, '重新打开工作区')) : null,
    valid ? initialPath ? h(FilePreview, { key: `${root.rootId}:${initialPath}`, target, root, path: initialPath, enabled: context.available && current })
      : h(Directory, { key: root.rootId, target, root, enabled: context.available && current }) : null)
}
