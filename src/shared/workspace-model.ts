// SPDX-License-Identifier: Apache-2.0
// 工作区读取依赖服务器根句柄；客户端不接收绝对路径作为读取目标。
import { DeckError, record } from './validation.ts'
import { boundedText, ordinal, resourceFormat, resourceId } from './resource-model.ts'
import type { ResourceTarget } from './resource-model.ts'
export const WORKSPACE_FILE_BYTES = 256 * 1024
export interface WorkspaceRoot { rootId: string; sessionId: string; expiresAt: number; maxFileBytes: number; pageSize: number; writable: boolean }
export interface WorkspaceCursor { digest: string; offset: number }
export interface WorkspaceEntry { name: string; type: 'file' | 'directory'; size: number | null }
export interface WorkspaceDirectory { rootId: string; path: string; entries: WorkspaceEntry[]; filtered: boolean; cursor: WorkspaceCursor | null; limited: boolean }
export interface WorkspaceFile { rootId: string; path: string; version: string; text: string; redacted: boolean; editable: boolean }
export function workspacePath(value: unknown, allowRoot = false): string {
  if (allowRoot && value === '') return ''
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[\\:\p{Cc}]/u.test(value) || value.startsWith('~')
    || value.split('/').some(part => !part || part.length > 255 || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new DeckError('bot/invalid', '只能读取当前工作区内有效的相对路径。')
  return value
}
export function workspaceRoot(value: unknown, target: ResourceTarget): WorkspaceRoot {
  const root = record(value)
  if (!root || root.schema !== 1 || !resourceId(root.rootId) || root.sessionId !== target.sessionId || !ordinal(root.expiresAt)
    || !ordinal(root.maxFileBytes) || root.maxFileBytes === 0 || root.maxFileBytes > WORKSPACE_FILE_BYTES
    || !ordinal(root.pageSize) || root.pageSize === 0 || root.pageSize > 64 || typeof root.writable !== 'boolean') throw resourceFormat()
  return { rootId: root.rootId, sessionId: target.sessionId, expiresAt: root.expiresAt, maxFileBytes: root.maxFileBytes, pageSize: root.pageSize, writable: root.writable }
}
export function workspaceDirectory(value: unknown, root: WorkspaceRoot, path: string, cursor?: WorkspaceCursor): WorkspaceDirectory {
  workspacePath(path, true)
  const page = record(value); const next = record(page?.cursor)
  if (!page || page.schema !== 1 || page.rootId !== root.rootId || page.path !== path || !Array.isArray(page.entries) || page.entries.length > root.pageSize
    || typeof page.filtered !== 'boolean' || page.cursor !== null && (!next || !resourceId(next.digest) || !ordinal(next.offset)
      || next.offset !== (cursor?.offset ?? 0) + page.entries.length || page.entries.length === 0 || cursor && next.digest !== cursor.digest)) throw resourceFormat()
  const entries = page.entries.map(value => {
    const item = record(value)
    if (!item || typeof item.name !== 'string' || item.name.includes('/') || typeof item.type !== 'string' || !['file', 'directory'].includes(item.type) || item.size !== undefined && !ordinal(item.size)) throw resourceFormat()
    workspacePath(path ? `${path}/${item.name}` : item.name)
    return { name: item.name, type: item.type as WorkspaceEntry['type'], size: typeof item.size === 'number' ? item.size : null }
  })
  if (new Set(entries.map(item => item.name)).size !== entries.length) throw resourceFormat()
  return { rootId: root.rootId, path, entries, filtered: page.filtered, cursor: next ? { digest: next.digest as string, offset: next.offset as number } : null, limited: false }
}
export function appendWorkspaceDirectory(previous: WorkspaceDirectory | null, next: WorkspaceDirectory): WorkspaceDirectory {
  if (!previous) return next
  const seen = new Set(previous.entries.map(item => item.name))
  if (previous.rootId !== next.rootId || previous.path !== next.path || next.entries.some(item => seen.has(item.name))) throw resourceFormat()
  const entries = [...previous.entries, ...next.entries]
  return { ...next, entries: entries.slice(0, 4096), filtered: previous.filtered || next.filtered, limited: entries.length > 4096 || entries.length === 4096 && next.cursor !== null }
}
export function workspaceFile(value: unknown, root: WorkspaceRoot, path: string): WorkspaceFile {
  workspacePath(path)
  const file = record(value)
  if (!file || file.schema !== 1 || file.rootId !== root.rootId || file.path !== path || file.complete !== true || file.encoding !== 'utf-8'
    || typeof file.redacted !== 'boolean' || typeof file.editable !== 'boolean' || file.redacted && file.editable
    || file.editable && (!root.writable || !resourceId(file.receiptId))) throw resourceFormat()
  const text = boundedText(file.text, WORKSPACE_FILE_BYTES * 2)
  if (text.includes('\0') || new TextEncoder().encode(text).byteLength > (file.redacted ? WORKSPACE_FILE_BYTES * 2 : root.maxFileBytes)) throw resourceFormat()
  const version = boundedText(file.version, 4096)
  if (!version) throw resourceFormat()
  // 本轮只接读取；不把服务器编辑回执缓存到客户端，也不开放保存端点。
  return { rootId: root.rootId, path, version, text, redacted: file.redacted, editable: file.editable }
}
