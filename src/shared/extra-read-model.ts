// SPDX-License-Identifier: Apache-2.0
// 已核对的增补读取才可回退；拒绝、网络和格式错误保持原失败。
import { DeckError, errorCode, record } from './validation.ts'
import type { ExtraReadMode } from './remote-capabilities.ts'
export type ExtraReadEndpoint = 'extra-messages' | 'extra-task-read'
export type ExtraReadCall = (endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
const missing = new WeakMap<ExtraReadCall, Set<ExtraReadEndpoint>>()
export function resetExtraReads(call: ExtraReadCall): void { missing.delete(call) }
export function extraReadFailure(value: unknown): string {
  switch (errorCode(value)) {
    case 'RPC_ABORTED': return '界面已切换或读取已取消，保留缓存；返回会话后重新同步。'
    case 'bot/refused': return '服务器拒绝读取该会话，请检查当前设备授权；没有降级到其他接口。'
    case 'bot/read-only': return '当前为缓存，恢复连接后可重新读取会话。'
    case 'bot/unavailable': return '会话读取锁定、繁忙或暂不可用，请稍后重试。'
    case 'bot/not-found': return '该会话或增补读取接口不存在，未把错误当作空历史。'
    case 'bot/incompatible': return '服务器会话数据格式不兼容，未把错误当作空历史。'
    default: return '会话读取失败，原历史没有被空回包替代，可重新读取。'
  }
}
export async function readExtraPage(call: ExtraReadCall, endpoint: ExtraReadEndpoint, payload: Record<string, unknown>, fallback: () => Promise<unknown>, mode: ExtraReadMode = 'ready', signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (signal?.aborted) throw new DeckError('RPC_ABORTED', '原会话读取已取消。')
  if (mode === 'incompatible') throw new DeckError('bot/incompatible', '服务器增补读取模块版本不兼容。')
  if (mode === 'legacy' && payload.fullMessages === true) throw new DeckError('bot/refused', '旧服务器没有完整消息读取声明。')
  let unsupported = missing.get(call)
  if (!unsupported) { unsupported = new Set(); missing.set(call, unsupported) }
  let value: unknown
  if (mode === 'legacy' || unsupported.has(endpoint) && payload.fullMessages !== true) value = await fallback()
  else {
    try { value = await call(endpoint, payload, signal) }
    catch (error) {
      const message = record(error)?.message
      // 原服务端没有冒号；只兼容明确指向本端点的两种完整消息，不按包含关系猜测。
      const endpointMissing = message === `Unknown endpoint ${endpoint}` || message === `Unknown endpoint: ${endpoint}`
      if (payload.fullMessages === true || errorCode(error) !== 'bot/not-found' || !endpointMissing) throw error
      // 旧读取结束时若连接标记已重置，不能把缺失判定带入新连接。
      if (missing.get(call) !== unsupported) throw new DeckError('RPC_ABORTED', '原连接读取已失效，没有跨连接降级读取。')
      unsupported.add(endpoint)
      value = await fallback()
    }
  }
  if (signal?.aborted) throw new DeckError('RPC_ABORTED', '原会话读取已取消。')
  const page = record(value)
  if (!page || !Array.isArray(page.items)) throw new DeckError('bot/incompatible', '服务器聊天或任务页格式无效。')
  return page
}
interface DetailJob { start(): void; cancel(): void; ready(): boolean }
export class DetailReadQueue {
  private active = 0
  private readonly pending: DetailJob[] = []
  private readonly limit: number
  constructor(limit = 3) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new RangeError('详情读取并发必须在1到3之间。')
    this.limit = limit
  }
  private drain(): void { while (this.active < this.limit && this.pending.length) { const job = this.pending.shift(); if (job?.ready()) job.start(); else job?.cancel() } }
  read<T>(request: () => Promise<T>, signal: AbortSignal, available: () => boolean = () => true): Promise<T> {
    if (this.pending.length >= 128) return Promise.reject(new DeckError('bot/unavailable', '工具详情排队已达上限，请稍后重新读取。'))
    return new Promise<T>((resolve, reject) => {
      let started = false; let settled = false
      const canceled = () => new DeckError('RPC_ABORTED', '工具详情读取已取消或原目标失效。')
      const ready = () => { try { return !signal.aborted && !settled && available() } catch { return false } }
      const cancel = () => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (!started) { const index = this.pending.indexOf(job); if (index >= 0) this.pending.splice(index, 1) }
        reject(canceled())
      }
      const finish = () => { signal.removeEventListener('abort', cancel); this.active -= 1; this.drain() }
      const job: DetailJob = { ready, cancel, start: () => {
        started = true; this.active += 1
        let value: Promise<T>
        try { value = request() } catch (error) { settled = true; reject(error); finish(); return }
        void value.then(result => {
          if (!settled) { if (ready()) { settled = true; resolve(result) } else cancel() }
          finish()
        }, error => { if (!settled) { settled = true; reject(error) }; finish() })
      } }
      if (!ready()) { cancel(); return }
      signal.addEventListener('abort', cancel, { once: true })
      this.pending.push(job); this.drain()
    })
  }
}
