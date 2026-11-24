// SPDX-License-Identifier: Apache-2.0
// 只提取上游公开的工具摘要；缺结果不是成功、失败或仍在运行的证据。
import { record } from './validation.ts'
export type ToolOutcome = 'success' | 'failure' | 'unknown'
export interface ToolSummary { name: string | null; label: string | null; outcome: ToolOutcome }
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
