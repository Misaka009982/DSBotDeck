// SPDX-License-Identifier: Apache-2.0
import type { ServerView } from '../shared/domain.ts'
import { EXTRA_OPERATIONS, EXTRA_WRITES, backgroundRead, computerControl, endpointPolicy, openingRead } from '../shared/endpoint-policy.ts'
import { DeckError, frozenRequest } from '../shared/validation.ts'
import type { ConnectionToken } from './server-connection.ts'
export interface UnlockRequest { serverAlias: string; endpoint: string; allowed?: () => boolean }
export interface UnlockProvider { verify(request: UnlockRequest): Promise<boolean> }
export interface RequestConnection {
  view(): Pick<ServerView, 'alias' | 'mode'>
  learningApproval?(): boolean
  token(): ConnectionToken | null
  valid(token: ConnectionToken, requireFresh?: boolean): boolean
  call(endpoint: string, payload: unknown, signal?: AbortSignal, token?: ConnectionToken | null): Promise<unknown>
}
export interface RequestContext { active(): boolean; signal?: AbortSignal }
export interface RequestReceipt { value: unknown; token: ConnectionToken }
export class RequestGate {
  // 标准 Deck 不装配额外本机验证器；配对权限和请求上下文仍逐次核对。
  private readonly unlock: UnlockProvider | undefined
  constructor(unlock?: UnlockProvider) { this.unlock = unlock }
  async execute(connection: RequestConnection, endpoint: unknown, payload: unknown, context: RequestContext): Promise<RequestReceipt> {
    const request = frozenRequest(endpoint, payload)
    const server = connection.view()
    const policy = endpointPolicy(request.endpoint, server.mode, connection.learningApproval?.() ?? server.mode === 'phone')
    if (policy === 'denied') {
      if (request.endpoint === 'learning-answer') throw new DeckError('bot/refused', '请先在服务器的已配对设备中开启“允许审批学习提案”。')
      if (computerControl(request.endpoint)) throw new DeckError('bot/refused', '此客户端只提供 DS-Bot 聊天与设置，不提供远程电脑控制或浏览器接管。')
      if (request.endpoint.startsWith('extra-')) throw new DeckError('bot/refused', '该增补操作尚未在此客户端开放，没有发送到服务器。')
      throw new DeckError('bot/refused', server.mode === 'browser' ? '此配对为浏览器权限，敏感操作请用服务器生成的手机配对码重新添加客户端。' : '该操作必须在服务器本机完成；客户端没有绕过远程权限。')
    }
    const token = connection.token()
    const learningWrite = request.endpoint === 'learning-answer'
    let sent = false
    const check = () => {
      const unknown = sent && (EXTRA_WRITES.has(request.endpoint) || learningWrite)
      if (learningWrite && !(connection.learningApproval?.() ?? server.mode === 'phone')) throw new DeckError(unknown ? 'bot/outcome-unknown' : 'bot/refused', unknown ? '学习审批授权已变化，已提交结果待确认；未自动重发。' : '学习审批授权已撤销，未发送操作。')
      if (context.signal?.aborted) throw new DeckError(unknown ? 'bot/outcome-unknown' : 'bot/refused', unknown ? '请求已取消，服务器可能已执行，结果待确认；未自动重发。' : '请求已取消，未自动重发。')
      if (!token || !connection.valid(token, !openingRead(request.endpoint))) throw new DeckError(unknown ? 'bot/outcome-unknown' : 'bot/read-only', unknown ? '连接或状态已变化，操作结果待确认；未自动重发。' : '连接或状态已变化，当前为缓存，操作未发送。')
      if ((!backgroundRead(request.endpoint) || policy === 'unlock') && !context.active()) throw new DeckError(unknown ? 'bot/outcome-unknown' : 'bot/refused', unknown ? '原服务器界面已切换或隐藏，操作结果待确认；未自动重发。' : '原服务器界面已切换或隐藏，操作未发送。')
    }
    check()
    if (policy === 'unlock' && this.unlock) {
      if (!context.active()) throw new DeckError('bot/refused', '请在活动服务器界面操作。')
      const verified = await this.unlock.verify({ serverAlias: server.alias, endpoint: request.endpoint, allowed: () => !context.signal?.aborted && context.active() && token !== null && connection.valid(token) })
      if (!verified) throw new DeckError('bot/refused', '系统验证已取消或不可用，未发送敏感操作。请先配置 Windows Hello。')
    }
    check()
    if (!token) throw new DeckError('bot/read-only', '原连接已经失效。')
    sent = true
    const value = await connection.call(request.endpoint, request.payload, context.signal, token)
    // 资源与学习审批回包重新核对上下文；写入可能已执行，不能把丢失回执说成未发送。
    if (EXTRA_OPERATIONS.has(request.endpoint) || learningWrite) check()
    return { value, token }
  }
}
