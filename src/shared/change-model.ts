// SPDX-License-Identifier: Apache-2.0
// 修改证据仅取服务器成功工具结果；不从调用参数或当前文件合成已应用修改。
import { record } from './validation.ts'
import { boundedText, ordinal, resourceFormat, resourceId } from './resource-model.ts'
import type { ToolReference } from './tool-model.ts'
export interface ChangePage {
  available: boolean; sessionId: string; callId: string; callSeq: number; resultSeq: number | null; index: number
  total: number | null; nextIndex: number | null; reason: string | null; digest: string | null
  path: string | null; oldText: string | null; newText: string | null; oldAvailable: boolean; stopped: boolean; redacted: boolean; pathRedacted: boolean
}
export function changeReference(value: ToolReference | null): value is ToolReference & { callSeq: number } {
  return value !== null && resourceId(value.sessionId) && resourceId(value.callId) && ordinal(value.callSeq)
}
export function changePage(value: unknown, reference: ToolReference, index = 0): ChangePage {
  if (!changeReference(reference) || !ordinal(index) || index >= 256) throw resourceFormat()
  const page = record(value)
  if (!page || page.schema !== 1 || page.source !== 'tool-result' || page.sessionId !== reference.sessionId || page.callId !== reference.callId
    || page.callSeq !== reference.callSeq || page.index !== index || typeof page.available !== 'boolean'
    || page.resultSeq !== null && (!ordinal(page.resultSeq) || page.resultSeq <= reference.callSeq)) throw resourceFormat()
  const total = page.total === undefined ? null : page.total
  const nextIndex = page.nextIndex === undefined ? null : page.nextIndex
  if (total !== null && (!ordinal(total) || total < 1 || total > 256 || index >= total || nextIndex !== (index + 1 < total ? index + 1 : null))
    || total === null && nextIndex !== null) throw resourceFormat()
  const base = { sessionId: reference.sessionId, callId: reference.callId, callSeq: reference.callSeq, resultSeq: page.resultSeq as number | null,
    index, total: total as number | null, nextIndex: nextIndex as number | null }
  if (!page.available) return { ...base, available: false, reason: boundedText(page.reason, 1000), digest: null, path: null, oldText: null, newText: null,
    oldAvailable: false, stopped: false, redacted: false, pathRedacted: false }
  if (total === null || !ordinal(page.resultSeq) || page.kind !== 'hunk' || typeof page.digest !== 'string' || !/^[a-f0-9]{64}$/.test(page.digest)
    || typeof page.oldAvailable !== 'boolean' || page.oldAvailable !== (page.oldText !== null)
    || typeof page.stopped !== 'boolean' || typeof page.redacted !== 'boolean' || typeof page.pathRedacted !== 'boolean') throw resourceFormat()
  const path = boundedText(page.path, 4096)
  if (!path || /[\p{Cc}]/u.test(path)) throw resourceFormat()
  return { ...base, available: true, reason: null, path, digest: page.digest,
    oldText: page.oldText === null ? null : boundedText(page.oldText, 64 * 1024), newText: boundedText(page.newText, 64 * 1024),
    oldAvailable: page.oldAvailable, stopped: page.stopped, redacted: page.redacted, pathRedacted: page.pathRedacted }
}
