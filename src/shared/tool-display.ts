// SPDX-License-Identifier: Apache-2.0
// 类别来自固定工具名，标题仅用服务端摘要或已完整读取的参数。
import { record } from './validation.ts'
import { DETAIL_PREVIEW_CHARS } from './tool-detail.ts'
export type ToolKind = 'read' | 'write' | 'edit' | 'command' | 'search' | 'tool'
export const TOOL_KINDS = { read: '读取', write: '写入', edit: '编辑', command: '运行命令', search: '搜索', tool: '工具' } as const
const PATH_KEYS = ['file_path', 'path', 'filePath', 'filename']
const COMMAND_KEYS = ['command', 'cmd', 'script']
const READ_KEYS = new Set([...PATH_KEYS, 'offset', 'limit'])
export function toolKind(name: string | null): ToolKind {
  if (['read', 'read_file'].includes(name ?? '')) return 'read'
  if (['write', 'write_file'].includes(name ?? '')) return 'write'
  if (['edit', 'apply_patch', 'str_replace_editor'].includes(name ?? '')) return 'edit'
  if (['bash', 'powershell', 'pwsh', 'shell', 'exec_command', 'run_command'].includes(name ?? '')) return 'command'
  if (['grep', 'rg', 'ffgrep', 'glob', 'find', 'fffind', 'search', 'web_search'].includes(name ?? '')) return 'search'
  return 'tool'
}
function argumentsOf(text: string | null): Record<string, unknown> | null {
  if (text === null || text.length > DETAIL_PREVIEW_CHARS) return null
  try { return record(JSON.parse(text)) } catch { return null }
}
const valueOf = (args: Record<string, unknown> | null, keys: string[]): string | null => {
  for (const key of keys) if (typeof args?.[key] === 'string' && args[key].trim()) return args[key]
  return null
}
export function displayToolPath(value: string, workDir: unknown): string {
  if (typeof workDir !== 'string' || !workDir.trim()) return value
  const path = value.replaceAll('\\', '/'); const root = workDir.replaceAll('\\', '/').replace(/\/+$/, '')
  // 只缩短已明确给出的绝对工作目录；不归一化遍历，不猜测项目根。
  if (!root || !/^(?:\/|[a-z]:\/)/i.test(root) || [path, root].some(text => /[\p{Cc}]/u.test(text) || text.split('/').some(part => part === '.' || part === '..'))) return value
  const insensitive = /^[a-z]:\//i.test(root) || root.startsWith('//')
  const within = insensitive ? path.toLowerCase().startsWith(`${root.toLowerCase()}/`) : path.startsWith(`${root}/`)
  return within ? `${root.slice(root.lastIndexOf('/') + 1)}/${path.slice(root.length + 1)}` : value
}
export function toolPresentation(tool: { name: string | null; label: string | null; description: string | null; filePath: string | null }, text: string | null, workDir?: unknown): { kind: ToolKind; title: string } {
  const kind = toolKind(tool.name); const args = argumentsOf(text)
  const path = ['read', 'write', 'edit', 'search'].includes(kind) ? tool.filePath ?? valueOf(args, PATH_KEYS) : null
  const description = tool.description ?? valueOf(args, ['description', 'justification'])?.trim().replace(/\s+/g, ' ').slice(0, 320)
  const target = path ? displayToolPath(path, workDir) : description || tool.label || tool.name || '工具名未提供'
  return { kind, title: `${TOOL_KINDS[kind]} · ${target}` }
}
export function argumentPresentation(name: string | null, text: string, complete: boolean): { title: string; text: string; compact: boolean; extra: string | null } {
  const args = complete ? argumentsOf(text) : null
  if (args && toolKind(name) === 'command') {
    const key = COMMAND_KEYS.find(key => typeof args[key] === 'string' && args[key].trim())
    if (key) {
      const remaining = Object.fromEntries(Object.entries(args).filter(([name]) => name !== key))
      return { title: '命令', text: args[key] as string, compact: false, extra: Object.keys(remaining).length ? JSON.stringify(remaining, null, 2) : null }
    }
  }
  const compact = args && toolKind(name) === 'read' && Object.keys(args).length > 0
    && Object.entries(args).every(([key, value]) => READ_KEYS.has(key) && (typeof value === 'string' && !/[\r\n]/.test(value) || typeof value === 'number' && Number.isFinite(value)))
  return { title: '参数', text: compact ? Object.entries(args!).map(([key, value]) => `${key}: ${value}`).join(' · ') : text, compact: Boolean(compact), extra: null }
}
