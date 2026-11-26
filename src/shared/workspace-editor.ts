// SPDX-License-Identifier: Apache-2.0
// 草稿和单次保存分开；丢失回执只查询原操作，不从文件内容相同推断保存成功。
import { DeckError, record } from './validation.ts'
import { boundedText, resourceFormat, resourceId, resourceTarget } from './resource-model.ts'
import type { ResourceTarget } from './resource-model.ts'
import { WORKSPACE_FILE_BYTES, workspaceFile, workspacePath } from './workspace-model.ts'
import type { WorkspaceFile, WorkspaceRoot } from './workspace-model.ts'
export interface EditFile extends WorkspaceFile { receiptId: string | null }
export interface EditReceipt { rootId: string; receiptId: string; expiresAt: number }
export interface EditSubmission extends EditReceipt { requestId: string; content: string }
export type SaveStatus = 'editing' | 'saving' | 'pending' | 'saved' | 'conflict' | 'failed' | 'unknown'
export function editFile(value: unknown, root: WorkspaceRoot, path: string): EditFile {
  const file = workspaceFile(value, root, path); const receipt = record(value)?.receiptId
  return { ...file, receiptId: file.editable && resourceId(receipt) ? receipt : null }
}
const contentOf = (value: string): string => {
  if (value.includes('\0') || /[\uD800-\uDFFF]/u.test(value) || new TextEncoder().encode(value).length > WORKSPACE_FILE_BYTES) throw new DeckError('bot/invalid', '编辑内容必须为完整 Unicode 文本、不含 NUL，且不超过 256 KiB。')
  return value
}
export const draftKey = (target: ResourceTarget, path: string): string => JSON.stringify([resourceTarget(target), workspacePath(path)])
export class WorkspaceDraft {
  readonly target: ResourceTarget
  readonly path: string
  readonly newline: '\n' | '\r\n'
  baseVersion: string
  baseRootId: string
  baseText: string
  text: string
  status: SaveStatus = 'editing'
  receipt: EditReceipt | null
  submission: EditSubmission | null = null
  comparison: { root: WorkspaceRoot; file: EditFile } | null = null
  constructor(target: ResourceTarget, root: WorkspaceRoot, file: EditFile) {
    if (file.redacted || !file.editable || !file.receiptId || root.sessionId !== target.sessionId || root.rootId !== file.rootId) throw resourceFormat()
    this.target = resourceTarget(target); this.path = workspacePath(file.path)
    this.baseVersion = file.version; this.baseRootId = root.rootId; this.baseText = file.text; this.text = file.text
    this.newline = file.text.includes('\r\n') ? '\r\n' : '\n'
    this.receipt = { rootId: root.rootId, receiptId: file.receiptId, expiresAt: root.expiresAt }
  }
  get dirty(): boolean { return this.text !== this.baseText }
  get unresolved(): boolean { return ['saving', 'pending', 'unknown'].includes(this.status) }
  get retained(): boolean { return this.dirty || this.unresolved }
  edit(text: string): void { this.text = contentOf(text.replace(/\r\n|\r|\n/g, this.newline)) }
  bind(root: WorkspaceRoot, file: EditFile, acceptChanged = false): void {
    if (file.path !== this.path || root.sessionId !== this.target.sessionId || file.rootId !== root.rootId || !file.editable || !file.receiptId || file.redacted) throw resourceFormat()
    if (this.unresolved) throw new DeckError('bot/outcome-unknown', '原保存仍待确认，不能换回执重发。')
    if ((file.version !== this.baseVersion || root.rootId !== this.baseRootId || file.text !== this.baseText) && !acceptChanged) {
      this.status = 'conflict'; this.receipt = null; this.comparison = { root, file }; return
    }
    this.baseVersion = file.version; this.baseRootId = root.rootId; this.baseText = file.text
    this.receipt = { rootId: root.rootId, receiptId: file.receiptId, expiresAt: root.expiresAt }
    this.status = 'editing'; this.comparison = null; this.submission = null
  }
  begin(requestId: string, now = Date.now()): Record<string, unknown> {
    if (this.status !== 'editing' || !this.dirty || !this.receipt || this.receipt.expiresAt <= now || !resourceId(requestId)) throw new DeckError('bot/stale', '当前文件、版本或编辑回执已失效，请重新核对。')
    const content = contentOf(this.text)
    this.submission = { ...this.receipt, requestId, content }; this.receipt = null; this.status = 'saving'
    return { rootId: this.submission.rootId, receiptId: this.submission.receiptId, requestId, content }
  }
  fail(code: string): void {
    if (!this.submission) return
    this.status = code === 'bot/conflict' ? 'conflict' : 'unknown'
  }
  query(): { rootId: string; receiptId: string } {
    if (!this.submission) throw resourceFormat()
    return { rootId: this.submission.rootId, receiptId: this.submission.receiptId }
  }
  result(value: unknown): void {
    const result = record(value); const sent = this.submission
    if (!result || !sent || result.schema !== 1 || result.rootId !== sent.rootId || result.receiptId !== sent.receiptId
      || !['ready', 'pending', 'saved', 'conflict', 'failed', 'unknown'].includes(typeof result.status === 'string' ? result.status : '')
      || result.status !== 'ready' && result.requestId !== sent.requestId || result.status === 'ready' && result.requestId !== null) throw resourceFormat()
    // 已确认成功不能被较早发出的状态查询降回 pending 或 unknown。
    if (this.status === 'saved' && result.status !== 'saved') return
    if (result.status === 'saved') {
      const version = boundedText(result.version, 4096)
      if (!version || this.status === 'saved' && version !== this.baseVersion) throw resourceFormat()
      this.baseVersion = version; this.baseText = sent.content; this.status = 'saved'
    } else this.status = result.status === 'ready' ? 'unknown' : result.status as SaveStatus
  }
}
export function savedChange(value: unknown, draft: WorkspaceDraft): { before: string | null; after: string | null; complete: boolean; redacted: boolean } {
  const page = record(value); const sent = draft.submission
  if (draft.status !== 'saved' || !page || !sent || page.schema !== 1 || page.source !== 'workspace-save'
    || page.rootId !== sent.rootId || page.receiptId !== sent.receiptId || page.requestId !== sent.requestId || page.path !== draft.path || page.version !== draft.baseVersion
    || typeof page.complete !== 'boolean' || page.complete !== (page.before !== null && page.after !== null) || typeof page.redacted !== 'boolean') throw resourceFormat()
  return { before: page.before === null ? null : boundedText(page.before, WORKSPACE_FILE_BYTES * 2), after: page.after === null ? null : boundedText(page.after, WORKSPACE_FILE_BYTES * 2), complete: page.complete, redacted: page.redacted }
}
export class WorkspaceDraftStore {
  private readonly items = new Map<string, WorkspaceDraft>()
  private readonly listeners = new Set<() => void>()
  revision = 0
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  changed(): void { this.revision += 1; for (const listener of this.listeners) listener() }
  get(target: ResourceTarget, path: string): WorkspaceDraft | undefined { return this.items.get(draftKey(target, path)) }
  list(): WorkspaceDraft[] { return [...this.items.values()].filter(item => item.retained) }
  open(target: ResourceTarget, root: WorkspaceRoot, file: EditFile): WorkspaceDraft {
    const key = draftKey(target, file.path); const previous = this.items.get(key)
    if (previous) { if (!previous.unresolved) previous.bind(root, file); this.changed(); return previous }
    if (this.items.size >= 8) throw new DeckError('bot/busy', '已保留八份文件编辑，请先处理或丢弃已有内容。')
    const draft = new WorkspaceDraft(target, root, file); this.items.set(key, draft); this.changed(); return draft
  }
  discard(target: ResourceTarget, path: string): void { this.items.delete(draftKey(target, path)); this.changed() }
  release(target: ResourceTarget, path: string): void { const draft = this.get(target, path); if (draft && !draft.retained) this.discard(target, path) }
}
