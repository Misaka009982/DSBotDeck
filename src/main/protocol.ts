// SPDX-License-Identifier: Apache-2.0
// 本地 scheme 只服务固定目录和固定服务器，不开放 HTTP 监听端口。
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { entityKey } from '../shared/domain.ts'
import { DeckError, MAX_REQUEST_BYTES, errorCode, record, safeMessage, validEntityId } from '../shared/validation.ts'
import type { ConnectionToken, ServerConnection } from './server-connection.ts'
import type { PeerEvent } from './link-factory.ts'
import { RequestGate } from './request-gate.ts'

export const SCHEME = 'dsbotdeck'
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
const headers = (type: string) => ({ 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' })
export function assetPath(root: string, pathname: string): string | null {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null
  const target = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? target : null
}
export async function staticResponse(root: string, pathname: string, method = 'GET'): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') return new Response('不允许此方法', { status: 405 })
  const target = assetPath(root, pathname)
  if (target === null) return new Response('禁止访问', { status: 403 })
  try {
    const resolvedRoot = await realpath(root); const resolved = await realpath(target)
    const relative = path.relative(resolvedRoot, resolved)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return new Response('禁止访问', { status: 403 })
    const bytes = await readFile(resolved)
    return new Response(method === 'HEAD' ? null : new Uint8Array(bytes), { headers: headers(TYPES[path.extname(target)] ?? 'text/plain; charset=utf-8') })
  } catch { return new Response('本地资源不存在，请先构建客户端。', { status: 404, headers: headers('text/plain; charset=utf-8') }) }
}
async function requestJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new DeckError('bot/invalid', '请求必须使用 JSON。')
  if (request.body === null) throw new DeckError('bot/invalid', '请求体为空。')
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break
      length += next.value.byteLength
      if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new DeckError('bot/invalid', '单次请求过大，请减少附件大小。') }
      parts.push(next.value)
    }
    const bytes = new Uint8Array(length); let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    const value = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    if (!value) throw new DeckError('bot/invalid', '请求不是 JSON 对象。')
    return value
  } finally { reader.releaseLock() }
}
export interface ReadReceipt { key: string; kind: 'bot' | 'room'; id: string; pending: string | null; token: ConnectionToken; taskId?: string; botId?: string }
export const readReceiptKey = (receipt: Pick<ReadReceipt, 'key' | 'botId' | 'taskId'>): string => receipt.taskId ? `task:${receipt.botId}\0${receipt.taskId}` : `chat:${receipt.key}`
export interface ClientProtocol {
  host: string
  root: string
  connection(): ServerConnection
  gate: RequestGate
  active(): boolean
  instance(): string | null
  context(): () => boolean
  renderedTarget(): { kind: 'bot' | 'room'; id: string } | null
  read(receipt: ReadReceipt, instance: string): void
}
function readTarget(endpoint: unknown, payload: unknown, connection: ServerConnection): Omit<ReadReceipt, 'pending' | 'token'> | null {
  const params = record(payload)
  if (!params || params.cursor !== undefined && params.cursor !== null) return null
  if (endpoint === 'chat' && validEntityId(params.botId)) return { key: entityKey('bot', params.botId), kind: 'bot', id: params.botId }
  if (endpoint === 'room-chat' && validEntityId(params.roomId)) return { key: entityKey('room', params.roomId), kind: 'room', id: params.roomId }
  if (endpoint === 'bot-task-read' && validEntityId(params.botId) && validEntityId(params.taskId)) {
    const key = connection.taskKey(params.botId, params.taskId)
    if (key) return { key, kind: key.startsWith('room:') ? 'room' : 'bot', id: key.slice(key.startsWith('room:') ? 5 : 4), botId: params.botId, taskId: params.taskId }
  }
  return null
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: headers('application/json; charset=utf-8') })
export function feedResponse(connection: ServerConnection, signal: AbortSignal, active: () => boolean, selected: () => { kind: 'bot' | 'room'; id: string } | null): Response {
  const encoder = new TextEncoder(); const queue: Uint8Array[] = []; let queued = 0; let ended = false
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let unsubscribe: (() => void) | null = null
  let keepalive: ReturnType<typeof setInterval> | undefined
  const close = () => {
    if (ended) return
    ended = true; unsubscribe?.(); clearInterval(keepalive); signal.removeEventListener('abort', close)
    queue.length = 0; queued = 0
    try { controller?.close() } catch {}
  }
  const write = (chunk: Uint8Array) => {
    if (ended || controller === null) return
    if (chunk.byteLength > 2 * 1024 * 1024 || queued + chunk.byteLength > 2 * 1024 * 1024) { close(); return }
    if (queue.length === 0 && (controller.desiredSize ?? 0) > 0) controller.enqueue(chunk)
    else { queue.push(chunk); queued += chunk.byteLength }
  }
  const event = ({ event, data }: PeerEvent) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(event)) return
    write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    // 当前对象产生完整回复后复读最新一页，待原 Chat 真实布局后再确认蓝灯。
    const notice = record(data); const target = selected()
    if (event === 'notice' && active() && target && ['message', 'group', 'done'].includes(String(notice?.kind))) {
      const same = target.kind === 'room' ? notice?.roomId === target.id : notice?.botId === target.id && notice?.roomId === undefined
      if (same) write(encoder.encode('event: hello\ndata: {}\n\n'))
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      if (signal.aborted) { close(); return }
      signal.addEventListener('abort', close, { once: true })
      unsubscribe = connection.subscribe(event)
      event({ event: connection.view().cached ? 'lost' : 'hello', data: {} })
      keepalive = setInterval(() => write(encoder.encode(':keepalive\n\n')), 15000)
    },
    pull() { const next = queue.shift(); if (next && controller && !ended) { queued -= next.byteLength; controller.enqueue(next) } },
    cancel() { close() },
  })
  return new Response(stream, { headers: headers('text/event-stream; charset=utf-8') })
}
export function clientHandler(options: ClientProtocol): (request: Request) => Promise<Response> {
  return async request => {
    let url: URL
    try { url = new URL(request.url) } catch { return new Response('无效地址', { status: 400 }) }
    if (url.protocol !== `${SCHEME}:` || url.hostname !== options.host || url.username || url.password) return new Response('服务器来源不匹配', { status: 403 })
    const origin = request.headers.get('origin')
    if (origin && origin !== `${SCHEME}://${options.host}`) return new Response('拒绝跨服务器请求', { status: 403 })
    const instance = options.instance()
    const prefix = instance === null ? null : `/${instance}/`
    if (prefix === null || !url.pathname.startsWith(prefix)) return new Response('此界面实例已失效', { status: 403 })
    const pathname = url.pathname.slice(prefix.length - 1)
    const active = options.context()
    if (pathname === '/api/bot/feed') {
      if (request.method !== 'GET') return new Response('不允许此方法', { status: 405 })
      try { return feedResponse(options.connection(), request.signal, options.active, options.renderedTarget) }
      catch { return new Response('该服务器已移除', { status: 404 }) }
    }
    if (pathname !== '/api/bot') return staticResponse(options.root, pathname, request.method)
    if (request.method !== 'POST') return new Response('不允许此方法', { status: 405 })
    try {
      const body = await requestJson(request); const connection = options.connection()
      const target = readTarget(body.endpoint, body.payload, connection)
      const pending = target === null ? null : connection.pendingToken(target.key, target.taskId ?? null)
      const receipt = await options.gate.execute(connection, body.endpoint, body.payload, { active, signal: request.signal })
      let value = receipt.value
      if (body.endpoint === 'folders' && record(value)) value = { ...record(value), picker: 'browse' }
      if (target !== null && instance !== null) options.read({ ...target, pending, token: receipt.token }, instance)
      return json({ ok: true, value })
    } catch (error) { return json({ ok: false, error: { code: errorCode(error) || 'bot/error', message: safeMessage(error) } }) }
  }
}
