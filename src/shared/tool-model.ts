// SPDX-License-Identifier: Apache-2.0
// 只提取上游公开的工具摘要；缺结果不是成功、失败或仍在运行的证据。
import { record, validEntityId } from './validation.ts'
export type ToolOutcome = 'success' | 'failure' | 'unknown'
export interface ToolSummary { name: string | null; label: string | null; outcome: ToolOutcome }
export interface ToolReference { sessionId: string; callId: string; callSeq?: number; parentCallId?: string }
export interface ToolCall extends ToolSummary { turn: number | null; description: string | null; filePath: string | null; reference: ToolReference | null }
export interface WorkToolNote { tool: string; label: string; current: true }
// 有调用序号时以其区分重复编号；旧协议缺序号才沿用原编号身份。
export function toolCallKey(reference: ToolReference): string { return JSON.stringify([reference.sessionId, reference.callId, reference.callSeq ?? null]) }
export function toolCalls(value: unknown, fallbackSessionId?: string): ToolCall[] {
  const entry = record(value)
  if (!entry || entry.kind !== 'steps' || !Array.isArray(entry.tools)) return []
  const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : fallbackSessionId
  const id = (value: unknown): value is string => validEntityId(value) && value.length <= 200
  return entry.tools.flatMap(value => {
    const tool = record(value)
    if (!tool) return []
    const summary = toolSummaries({ kind: 'steps', tools: [tool] })[0]
    const part = typeof tool.sessionId === 'string' ? tool.sessionId : sessionId
    const seq = tool.callSeq
    const reference = id(part) && id(tool.callId) && (seq == null || Number.isSafeInteger(seq) && typeof seq === 'number' && seq >= 0)
      ? { sessionId: part, callId: tool.callId, ...(typeof seq === 'number' ? { callSeq: seq } : {}), ...(id(tool.parentCallId) ? { parentCallId: tool.parentCallId } : {}) } : null
    const turn = Number.isSafeInteger(tool.turn) && typeof tool.turn === 'number' && tool.turn >= 0 ? tool.turn
      : Number.isSafeInteger(entry.turn) && typeof entry.turn === 'number' && entry.turn >= 0 ? entry.turn : null
    const filePath = typeof tool.filePath === 'string' && tool.filePath.trim() && tool.filePath.length <= 1024 && !/[\p{Cc}]/u.test(tool.filePath) ? tool.filePath : null
    return [{ ...summary, turn, description: typeof tool.description === 'string' && tool.description.trim() ? tool.description.trim().replace(/\s+/g, ' ').slice(0, 320) : null, filePath, reference }]
  })
}
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
