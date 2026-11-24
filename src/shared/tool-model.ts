// SPDX-License-Identifier: Apache-2.0
// 只提取上游公开的工具摘要；缺结果不是成功、失败或仍在运行的证据。
import { record } from './validation.ts'
export type ToolOutcome = 'success' | 'failure' | 'unknown'
export interface ToolSummary { name: string | null; label: string | null; outcome: ToolOutcome }
export interface WorkToolNote { tool: string; label: string; current: true }
export function workToolNote(value: unknown, roster: unknown = {}): WorkToolNote | null {
  const names = record(roster) ?? {}
  const rows = Array.isArray(value) ? value : [value]
  const labels: string[] = []
  let tool = ''
  for (const value of rows) {
    const entry = record(value)
    if (!entry || entry.switching === true || typeof entry.tool !== 'string' || !entry.tool.trim()) continue
    tool = entry.tool.trim().slice(0, 160)
    const owner = typeof entry.botId === 'string' ? record(names[entry.botId])?.name ?? entry.botId : null
    const detail = [entry.note, entry.target].filter((part): part is string => typeof part === 'string' && part.trim() !== '').map(part => part.trim().slice(0, 160)).join(' · ')
    const label = tool === 'task' ? '后台任务' : `正在调用 ${tool}`
    labels.push(`${typeof owner === 'string' ? `${owner.slice(0, 80)}：` : ''}${label}${detail ? ` · ${detail}` : ''}`)
  }
  return labels.length ? { tool, label: labels.join('；'), current: true } : null
}
export function preferInputStatus(inputAt: number, value: unknown): boolean {
  const tool = record(value)
  // noteLive 保留首次出现时间；服务器仍报告当前工具时，不让较新的输入覆盖真实状态。
  return !(tool?.current === true && typeof tool.tool === 'string' && tool.tool !== '') && inputAt > (typeof tool?.at === 'number' ? tool.at : 0)
}
function outcomeOf(value: unknown): ToolOutcome {
  if (value === true) return 'success'
  if (value === false) return 'failure'
  return 'unknown'
}
export function toolSummaries(value: unknown): ToolSummary[] {
  const entry = record(value)
  if (!entry || entry.kind !== 'steps' || !Array.isArray(entry.tools)) return []
  const tools: ToolSummary[] = []
  for (const value of entry.tools) {
    const tool = record(value)
    if (!tool) continue
    tools.push({
      name: typeof tool.name === 'string' && tool.name !== '' ? tool.name : null,
      label: typeof tool.label === 'string' && tool.label !== '' ? tool.label : null,
      outcome: outcomeOf(tool.ok),
    })
  }
  return tools
}
