// SPDX-License-Identifier: Apache-2.0
// 只适配远程目录/文本到上游呈现，不把服务器路径转换成本机访问。
import type { WorkspaceDirectory, WorkspaceFile } from './workspace-model.ts'
export function workspaceTreeEntries(page: WorkspaceDirectory) {
  return page.entries.map(entry => ({ name: entry.name, kind: entry.type === 'directory' ? 'dir' : 'file',
    path: page.path ? `${page.path}/${entry.name}` : entry.name, size: entry.size }))
}
export function workspacePreview(file: WorkspaceFile) {
  const ext = file.path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? ''
  const languages: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', json: 'json', css: 'css', py: 'python', sh: 'bash', yml: 'yaml', yaml: 'yaml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', md: 'markdown', mdx: 'markdown' }
  const language = Object.hasOwn(languages, ext) ? languages[ext] : ''
  const kind = ['md', 'markdown'].includes(ext) ? 'markdown' : ['csv', 'tsv'].includes(ext) ? 'table' : language ? 'code' : 'text'
  return { path: file.path, name: file.path.split('/').at(-1), kind, language,
    text: file.text, size: new TextEncoder().encode(file.text).byteLength, delimiter: ext === 'tsv' ? '\t' : ',', truncated: false }
}
