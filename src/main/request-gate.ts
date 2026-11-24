// SPDX-License-Identifier: Apache-2.0
import type { ServerView } from '../shared/domain.ts'
import { backgroundRead, computerControl, endpointPolicy, openingRead } from '../shared/endpoint-policy.ts'
import { DeckError, frozenRequest } from '../shared/validation.ts'
import type { ConnectionToken } from './server-connection.ts'
export interface UnlockRequest { serverAlias: string; endpoint: string; allowed?: () => boolean }
export interface UnlockProvider { verify(request: UnlockRequest): Promise<boolean> }
export interface RequestConnection {
  view(): Pick<ServerView, 'alias' | 'mode'>
  token(): ConnectionToken | null
  valid(token: ConnectionToken, requireFresh?: boolean): boolean
  call(endpoint: string, payload: unknown, signal?: AbortSignal, token?: ConnectionToken | null): Promise<unknown>
}
export interface RequestContext { active(): boolean; signal?: AbortSignal }
export interface RequestReceipt { value: unknown; token: ConnectionToken }
export class RequestGate {
  private readonly unlock: UnlockProvider
  constructor(unlock: UnlockProvider) { this.unlock = unlock }
  async execute(connection: RequestConnection, endpoint: unknown, payload: unknown, context: RequestContext): Promise<RequestReceipt> {
    const request = frozenRequest(endpoint, payload)
    const server = connection.view()
    const policy = endpointPolicy(request.endpoint, server.mode)
    if (policy === 'denied') {
      if (computerControl(request.endpoint)) throw new DeckError('bot/refused', '此客户端只提供 DS-Bot 聊天与设置，不提供远程电脑控制或浏览器接管。')
      throw new DeckError('bot/refused', server.mode === 'browser' ? '此配对为浏览器权限，敏感操作请用服务器生成的手机配对码重新添加客户端。' : '该操作必须在服务器本机完成；客户端没有绕过远程权限。')
    }
    const token = connection.token()
    const check = () => {
      if (context.signal?.aborted) throw new DeckError('bot/refused', '请求已取消，未自动重发。')
      if (!token || !connection.valid(token, !openingRead(request.endpoint))) throw new DeckError('bot/read-only', '连接或状态已变化，当前为缓存，操作未发送。')
      if ((!backgroundRead(request.endpoint) || policy === 'unlock') && !context.active()) throw new DeckError('bot/refused', '原服务器界面已切换或隐藏，操作未发送。')
    }
    check()
    if (policy === 'unlock') {
      if (!context.active()) throw new DeckError('bot/refused', '请在活动服务器界面操作。')
      const verified = await this.unlock.verify({ serverAlias: server.alias, endpoint: request.endpoint, allowed: () => !context.signal?.aborted && context.active() && token !== null && connection.valid(token) })
      if (!verified) throw new DeckError('bot/refused', '系统验证已取消或不可用，未发送敏感操作。请先配置 Windows Hello。')
    }
    check()
    if (!token) throw new DeckError('bot/read-only', '原连接已经失效。')
    return { value: await connection.call(request.endpoint, request.payload, context.signal, token), token }
  }
}
