// SPDX-License-Identifier: Apache-2.0
// 详情仅接受原调用的已脱敏分页；说明只能从真实参数取得，不推测执行目的。
import { DeckError, errorCode, record } from './validation.ts'
import type { ToolOutcome, ToolReference } from './tool-model.ts'
export type ToolDetailField = 'arguments' | 'output'
export const MAX_DETAIL_CHARS = 2 * 1024 * 1024
export const DETAIL_PAGE_CHARS = 32768
export const DETAIL_PREVIEW_CHARS = 128 * 1024
export type ToolDetailPage = { available: false; outcome: ToolOutcome; reason: string } | { available: true; outcome: ToolOutcome; text: string; offset: number; totalChars: number; digest: string; nextOffset: number | null }
export type ToolDetailPreview = Extract<ToolDetailPage, { available: false }> | (Extract<ToolDetailPage, { available: true }> & { previewLimited: boolean })
const outcome = (status: unknown): ToolOutcome => status === 'success' ? 'success' : status === 'failed' ? 'failure' : 'unknown'
export function detailPage(value: unknown, reference: ToolReference, field: ToolDetailField, offset = 0, digest?: string): ToolDetailPage {
  const entry = record(value)
  const invalid = () => new DeckError('bot/incompatible', '服务器工具详情格式或关联信息无效。')
  if (!entry || typeof entry.available !== 'boolean') throw invalid()
  if (!entry.available) {
    if (typeof entry.reason !== 'string' || entry.reason.length > 1000) throw invalid()
    return { available: false, outcome: outcome(entry.status), reason: entry.reason }
  }
  const total = entry.totalChars; const text = entry.text; const next = entry.nextOffset; const hash = entry.digest
  if (next !== null && typeof next !== 'number') throw invalid()
  if (entry.redacted !== true || entry.sessionId !== reference.sessionId || entry.callId !== reference.callId || entry.field !== field
    || entry.offset !== offset || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total > MAX_DETAIL_CHARS
    || typeof text !== 'string' || text.length > DETAIL_PAGE_CHARS || offset + text.length > total
    || next !== null && (text.length < DETAIL_PAGE_CHARS - 1 || /[\uD800-\uDBFF]$/.test(text))
    || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || digest !== undefined && hash !== digest
    || (next === null ? offset + text.length !== total : typeof next !== 'number' || !Number.isSafeInteger(next) || next !== offset + text.length || next <= offset || next >= total)) throw invalid()
  return { available: true, outcome: outcome(entry.status), text, offset, totalChars: total, digest: hash, nextOffset: next }
}
export function appendDetailPage(previous: ToolDetailPreview | null, page: ToolDetailPage): ToolDetailPreview {
  if (!page.available) return page
  if (previous?.available) {
    if (previous.previewLimited) throw new DeckError('bot/unavailable', '工具详情已达到显示上限，不再追加读取。')
    if (previous.nextOffset === null || page.offset !== previous.nextOffset || page.digest !== previous.digest || page.totalChars !== previous.totalChars) {
      throw new DeckError('bot/incompatible', '工具详情关联、版本或分页格式已变化。')
    }
  } else if (page.offset !== 0) throw new DeckError('bot/incompatible', '工具详情必须从首段开始读取。')
  // 仅保留已读取的开头，不补换行；显示预算与服务端总量校验分开。
  const joined = (previous?.available ? previous.text : '') + page.text
  let end = Math.min(joined.length, DETAIL_PREVIEW_CHARS)
  if (end < joined.length && /[\uD800-\uDBFF]/.test(joined[end - 1])) end -= 1
  return { ...page, offset: 0, text: joined.slice(0, end), previewLimited: joined.length > end || end >= DETAIL_PREVIEW_CHARS && page.nextOffset !== null }
}
export function keepDetailOnFailure(value: unknown): boolean { return errorCode(value) === 'RPC_TIMEOUT' }
export function detailPurpose(text: string): { description: string | null; command: string | null } {
  let args: Record<string, unknown> | null
  try { args = record(JSON.parse(text)) } catch { args = null }
  const description = [args?.description, args?.justification].find(value => typeof value === 'string' && value.trim())
  const command = [args?.command, args?.cmd].find(value => typeof value === 'string' && value.trim())
  return { description: typeof description === 'string' ? description.trim().replace(/\s+/g, ' ').slice(0, 320) : null, command: typeof command === 'string' ? command : null }
}
export function toolDetailFailure(value: unknown): string {
  switch (errorCode(value)) {
    case 'HTTP_401':
    case 'HTTP_403':
    case 'bot/refused': return '服务器拒绝或撤销了本次读取，请检查当前设备授权；没有退回其他接口。'
    case 'bot/read-only': return '当前为缓存，连接恢复后可重新读取工具详情。'
    case 'bot/not-found': return '此调用或工具详情接口不存在；旧服务器可能只提供摘要。'
    case 'bot/unavailable': return '工具详情繁忙、锁定或暂不可用，请稍后重新读取。'
    case 'bot/stale': return '工具详情版本已变化，请重新读取首段。'
    case 'bot/incompatible': return '服务器工具详情格式或关联信息不兼容，未展示正文。'
    default: return '工具详情读取失败，可重新读取；没有把失败当作空输出。'
  }
}
