// SPDX-License-Identifier: Apache-2.0
import { createElement as h, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { writeClipboard } from '@dsbot/ui/primitives.js'
import { changePage, changeReference } from '../shared/change-model.ts'
import { currentResourceSession, sessionResourceTarget } from '../shared/resource-model.ts'
import { workspacePath } from '../shared/workspace-model.ts'
import { WorkspacePane } from './workspace-pane.js'
import { ReadState, useResourceContext, useResourceRead } from './resource-read.js'
export function ChangeDetail({ reference }) {
  const context = useResourceContext('toolChanges'); const workspace = useResourceContext('workspace'); const node = useRef(null)
  const [index, setIndex] = useState(0); const [currentFile, setCurrentFile] = useState(false); const [copyError, setCopyError] = useState(null)
  const reader = useResourceRead({ identity: JSON.stringify([context.boundary, reference, index]), enabled: context.available && changeReference(reference), node,
    read: async (_cursor, signal) => changePage(await call('extra-tool-change', { sessionId: reference.sessionId, callId: reference.callId, callSeq: reference.callSeq, index }, signal), reference, index) })
  const page = reader.value
  const target = sessionResourceTarget(context.roster, reference?.sessionId)
  let path = null
  if (page?.available && !page.pathRedacted) { try { path = workspacePath(page.path) } catch { /* 历史绝对路径不作为当前工作区访问令牌。 */ } }
  const canOpen = path !== null && target && currentResourceSession(context.roster, target) && workspace.available
  const copy = async () => {
    if (!reader.canCopy(page) || !page?.available) return
    const ok = await writeClipboard(`${page.path}\n\n修改前：\n${page.oldText ?? '旧文本未记录'}\n\n修改后：\n${page.newText}`)
    if (reader.canCopy(page)) setCopyError(ok ? null : '复制失败，请手动选择记录文本。')
  }
  return h('div', { ref: node, className: 'deck-change-detail' },
    context.reason ? h('p', { className: 'deck-resource-note' }, context.reason) : null,
    !changeReference(reference) ? h('p', { className: 'deck-resource-note' }, '缺少调用序号，不能可靠定位这一次修改。') : null,
    h(ReadState, { reader }), page ? h('div', null,
      page.available ? h('div', null,
        h('p', { className: 'deck-resource-note' }, `来源：工具成功结果 · 调用 #${page.callSeq} · 结果 #${page.resultSeq}`),
        h('code', { className: 'deck-change-path' }, page.path),
        page.stopped ? h('p', { className: 'deck-resource-note', role: 'status' }, '此次补丁中途停止；这里只显示已记录的部分修改。') : null,
        !page.oldAvailable ? h('p', { className: 'deck-resource-note' }, '没有记录旧文本，不能据此判断为新建文件或完整差异。') : null,
        page.redacted ? h('p', { className: 'deck-resource-note' }, '记录中的敏感内容已遮盖。') : null,
        h('div', { className: 'deck-change-columns' },
          h('section', null, h('strong', null, '修改前的记录片段'), h('pre', null, page.oldText ?? '（旧文本不可用）')),
          h('section', null, h('strong', null, '修改后的记录片段'), h('pre', null, page.newText === '' ? '（空文本）' : page.newText))),
        h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => { void copy() } }, '复制本段记录'),
        canOpen ? h('button', { type: 'button', className: 'bt-soft', onClick: () => setCurrentFile(value => !value) }, currentFile ? '收起当前文件' : '读取当前工作区中的文件')
          : h('p', { className: 'deck-resource-note' }, '历史路径仅作记录；当前文件请从获授权的工作区目录选择。'),
        copyError ? h('p', { className: 'deck-resource-error' }, copyError) : null) : h('p', { className: 'deck-resource-note' }, page.reason),
      h('div', { className: 'deck-resource-heading' },
        index > 0 ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => { setCurrentFile(false); setCopyError(null); setIndex(value => value - 1) } }, '上一段修改') : null,
        h('span', { className: 'deck-resource-note' }, page.total === null ? '没有可读取的修改片段' : `${index + 1} / ${page.total}`),
        page.nextIndex !== null ? h('button', { type: 'button', className: 'bt-soft', disabled: reader.busy, onClick: () => { setCurrentFile(false); setCopyError(null); setIndex(page.nextIndex) } }, '下一段修改') : null),
      currentFile && canOpen ? h(WorkspacePane, { key: `${reference.sessionId}:${path}`, target, initialPath: path }) : null) : null)
}
