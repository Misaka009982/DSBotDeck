// SPDX-License-Identifier: Apache-2.0
// 文件仅来自用户选取的 Blob；分片传输固定原目标，发送未知只查询同一回执。
import { DeckError, errorCode, record } from './validation.ts'
export const ATTACHMENT_LIMITS = { maxFiles: 8, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024, chunkBytes: 192 * 1024 } as const
export interface AttachmentTarget { scope: { kind: 'bot'; botId: string } | { kind: 'room'; roomId: string }; sessionId: string }
export interface AttachmentFile { name: string; size: number; type: string; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } }
export interface AttachmentMeta { name: string; size: number; mime: string; kind: 'image' | 'file' }
export type AttachmentCall = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
export type AttachmentPhase = 'draft' | 'uploading' | 'sending' | 'unknown' | 'sent' | 'failed'
const images = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export function attachmentMetadata(file: AttachmentFile): AttachmentMeta {
  if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 200 || /[\\/\p{Cc}]/u.test(file.name)
    || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > ATTACHMENT_LIMITS.maxFileBytes) throw new DeckError('bot/invalid', '文件名无效或单个文件超过 16 MiB。')
  const mime = typeof file.type === 'string' && file.type.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream'
  const kind = images.has(mime) ? 'image' : 'file'
  if (kind === 'image' && file.size === 0) throw new DeckError('bot/invalid', '空图片不能发送。')
  return { name: file.name, size: file.size, mime, kind }
}
export function attachmentCapability(extras: unknown): boolean {
  const root = record(extras); const value = record(root?.attachments)
  return root?.schema === 1 && value?.schema === 1 && Object.entries(ATTACHMENT_LIMITS).every(([key, limit]) => typeof value[key] === 'number' && value[key] >= limit)
}
export function attachmentTarget(roster: unknown, sessionId: string): AttachmentTarget | null {
  const root = record(roster); const bot = record(record(root?.byId)?.[sessionId]); const room = record(record(root?.roomsById)?.[sessionId])
  if (bot && typeof bot.id === 'string' && (bot.sessionId ?? bot.id) === sessionId) return { scope: { kind: 'bot', botId: bot.id }, sessionId }
  if (room && typeof room.id === 'string' && (room.sessionId ?? room.id) === sessionId) return { scope: { kind: 'room', roomId: room.id }, sessionId }
  return null
}
export const attachmentKey = (target: AttachmentTarget): string => JSON.stringify(target.scope)
export function attachmentBase64(bytes: Uint8Array): string {
  let value = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(value)
}
export class AttachmentBatch {
  readonly target: AttachmentTarget
  files: AttachmentFile[] = []
  phase: AttachmentPhase = 'draft'
  requestId: string | null = null
  text = ''
  sentBytes = 0
  message: string | null = null
  private busy = false
  constructor(target: AttachmentTarget) { this.target = structuredClone(target) }
  get locked(): boolean { return this.busy || ['uploading', 'sending', 'unknown'].includes(this.phase) }
  get size(): number { return this.files.reduce((sum, file) => sum + file.size, 0) }
  add(files: AttachmentFile[]): void {
    if (this.locked) throw new DeckError('bot/refused', '这条消息仍在处理或待确认，请先核对发送结果。')
    const next = [...this.files, ...files]; next.forEach(attachmentMetadata)
    if (next.length > ATTACHMENT_LIMITS.maxFiles || next.reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_LIMITS.maxTotalBytes) throw new DeckError('bot/invalid', '每条消息最多 8 个附件，合计不超过 32 MiB。')
    this.files = next; this.phase = 'draft'; this.message = null
  }
  remove(index: number): void { if (!this.locked) { this.files = this.files.filter((_file, at) => at !== index); this.phase = 'draft'; this.message = null } }
  accept(value: unknown): string {
    const answer = record(value)
    if (answer?.schema !== 1 || answer.requestId !== this.requestId || answer.sessionId !== this.target.sessionId || !Array.isArray(answer.received)
      || answer.received.length !== this.files.length || answer.received.some((count, index) => !Number.isSafeInteger(count) || count < 0 || count > this.files[index].size)
      || !['uploading', 'sending', 'sent', 'unknown', 'failed', 'discarded'].includes(String(answer.status))) throw new DeckError('bot/incompatible', '附件回执无效，请核对原消息，未自动重发。')
    const status = String(answer.status)
    if (this.phase === 'sent') return 'sent'
    if (status === 'sent') { this.phase = 'sent'; this.message = '服务器已确认发送。' }
    else if (status === 'failed' || status === 'discarded') { this.phase = 'failed'; this.message = '服务器确认消息未发送，附件保留，可重新发送。' }
    else if (status === 'unknown' || this.phase === 'unknown' || this.phase === 'sending') { this.phase = 'unknown'; this.message = '发送结果待确认，请查询原回执或核对聊天记录；不会自动重发。' }
    return status
  }
  private settled(): boolean { return this.phase === 'sent' || this.phase === 'failed' }
  async send(call: AttachmentCall, text: string, requestId: string, usable: () => boolean, signal: AbortSignal, changed: () => void): Promise<void> {
    if (this.locked || this.phase === 'sent' || this.files.length === 0) throw new DeckError('bot/refused', '此附件消息不能重复提交。')
    const check = () => { if (signal.aborted || !usable()) throw new DeckError('RPC_ABORTED', '已停止附件传输，原文件仍保留。') }
    check()
    if (text.length > 128 * 1024) throw new DeckError('bot/invalid', '附带的文字过长，请缩短后发送。')
    const previousRequest = this.phase === 'draft' ? this.requestId : null
    this.busy = true; this.phase = 'uploading'; this.text = text; this.sentBytes = 0; this.message = null; changed()
    let submitted = false
    try {
      // 用户重试未提交的上传时先释放原暂存；失效表示暂存已过期，不重放发送。
      if (previousRequest) {
        try {
          const cleared = record(await call('extra-attachment-discard', { requestId: previousRequest }, signal))
          if (cleared?.requestId !== previousRequest || cleared.sessionId !== this.target.sessionId || !['discarded', 'failed'].includes(String(cleared.status))) {
            submitted = true
            throw new DeckError('bot/stale', '原附件状态与预期不符，请先核对原消息。')
          }
        } catch (error) { if (errorCode(error) !== 'bot/stale' || submitted) throw error }
      }
      check(); this.requestId = requestId
      const status = this.accept(await call('extra-attachment-open', { requestId, ...this.target, files: this.files.map(attachmentMetadata) }, signal))
      if (status !== 'uploading') throw new DeckError('bot/stale', '附件编号已被使用，未重复提交。')
      for (const [index, file] of this.files.entries()) for (let offset = 0; offset < file.size; offset += ATTACHMENT_LIMITS.chunkBytes) {
        check()
        const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + ATTACHMENT_LIMITS.chunkBytes)).arrayBuffer())
        check()
        if (bytes.length !== Math.min(ATTACHMENT_LIMITS.chunkBytes, file.size - offset)) throw new DeckError('bot/invalid', '所选文件读取不完整，请重新选择。')
        const value = await call('extra-attachment-chunk', { requestId, index, offset, data: attachmentBase64(bytes) }, signal)
        if (this.accept(value) !== 'uploading' || (record(value)?.received as number[])[index] !== offset + bytes.length) throw new DeckError('bot/incompatible', '服务器未确认完整分片，消息尚未发送。')
        this.sentBytes += bytes.length; changed()
      }
      check(); submitted = true; this.phase = 'sending'; changed()
      const result = this.accept(await call('extra-attachment-send', { requestId, text }, signal))
      if (result !== 'sent') throw new DeckError('bot/refused', this.message ?? '发送结果待确认。')
    } catch (error) {
      if (!this.settled()) {
        this.phase = submitted ? 'unknown' : 'draft'
        this.message = submitted ? '发送结果待确认，请查询原回执；不会自动重发。' : '附件传输未完成，消息尚未发送，原文件已保留。'
      }
      throw error
    } finally { this.busy = false; changed() }
  }
  async query(call: AttachmentCall, signal: AbortSignal, changed: () => void): Promise<void> {
    if (this.busy || !this.requestId) return
    this.busy = true; changed()
    try { this.accept(await call('extra-attachment-status', { requestId: this.requestId }, signal)) }
    finally { this.busy = false; changed() }
  }
}
