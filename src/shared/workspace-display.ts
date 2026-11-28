// SPDX-License-Identifier: Apache-2.0
// 只适配远程目录/文本到上游呈现，不把服务器路径转换成本机访问。
import type { WorkspaceDirectory, WorkspaceFile } from './workspace-model.ts'
import { currentResourceSession, resourcePermissions } from './resource-model.ts'
import type { ResourceTarget } from './resource-model.ts'
import { record } from './validation.ts'
const fileNames = new Intl.Collator(undefined, { numeric: true })
// 连接与可见性不改变已读文件的归属；目标、授权或已知工作目录变化才释放快照。
export function workspaceSnapshotIdentity(value: unknown, target: ResourceTarget, selection: unknown): string {
  const roster = record(value); const scope = target.scope
  const bot = scope.kind === 'room' ? null : record(record(roster?.byId)?.[scope.botId])
  const task = scope.kind === 'task' ? (Array.isArray(bot?.tasks) ? bot.tasks : []).map(record).find(item => item?.id === scope.taskId) : null
  const roomId = scope.kind === 'room' ? scope.roomId : task?.roomId
  const room = typeof roomId === 'string' ? record(record(roster?.roomsById)?.[roomId]) : null
  return JSON.stringify([target, selection, currentResourceSession(value, target), resourcePermissions(roster?.extras), roster?.readOnly ?? null,
    roster?.workspaceId ?? null, bot?.workDir ?? null, task?.workDir ?? null, roomId ?? null, room?.workDir ?? null])
}
export function workspaceTreeEntries(page: WorkspaceDirectory, descending = false) {
  return page.entries.map(entry => ({ name: entry.name, kind: entry.type === 'directory' ? 'dir' : 'file',
    path: page.path ? `${page.path}/${entry.name}` : entry.name, size: entry.size }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1)
      || (descending ? -1 : 1) * fileNames.compare(a.name, b.name))
}
export function workspacePreview(file: WorkspaceFile) {
  const ext = file.path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? ''
  const languages: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', json: 'json', css: 'css', py: 'python', sh: 'bash', yml: 'yaml', yaml: 'yaml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', md: 'markdown', mdx: 'markdown' }
  const language = Object.hasOwn(languages, ext) ? languages[ext] : ''
  const kind = ['md', 'markdown'].includes(ext) ? 'markdown' : ['csv', 'tsv'].includes(ext) ? 'table' : language ? 'code' : 'text'
  return { path: file.path, name: file.path.split('/').at(-1), kind, language,
    text: file.text, size: new TextEncoder().encode(file.text).byteLength, delimiter: ext === 'tsv' ? '\t' : ',', truncated: false }
}
