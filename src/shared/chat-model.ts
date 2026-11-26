// SPDX-License-Identifier: Apache-2.0
// 交换目标只取当前服务器公开目录；错误说明不回显服务端正文或凭据。
import { DeckError, errorCode, record, validEntityId } from './validation.ts'
export function botExchangePair(selfId: unknown, peerId: unknown, directory: unknown): [string, string] | null {
  const table = record(directory)
  const lookup = (id: unknown) => validEntityId(id) && table && Object.hasOwn(table, id) ? record(table[id]) : null
  const self = lookup(selfId); const peer = lookup(peerId)
  if (!self || !peer) return null
  const left = self.id; const right = peer.id
  const canonical = (id: string) => table !== null && Object.hasOwn(table, id) && record(table[id])?.id === id
  return validEntityId(left) && validEntityId(right) && left !== right && canonical(left) && canonical(right) ? [left, right] : null
}
export function messageExchange(value: unknown, directory: unknown): [string, string] | null {
  const item = record(value); const exchange = record(item?.exchange); const table = record(directory)
  if (!item || item.kind !== 'internal' || !exchange || exchange.schema !== 1 || !validEntityId(exchange.id)
    || !validEntityId(exchange.from) || !validEntityId(exchange.to) || !table) return null
  const sender = Object.hasOwn(table, exchange.from) ? record(table[exchange.from]) : null
  const receiver = Object.hasOwn(table, exchange.to) ? record(table[exchange.to]) : null
  const owner = typeof item.sessionId === 'string' && Object.hasOwn(table, item.sessionId) ? record(table[item.sessionId]) : null
  if (sender?.id !== exchange.from || receiver?.id !== exchange.to || owner?.id !== exchange.to || sender.private === true || receiver.private === true) return null
  return botExchangePair(exchange.from, exchange.to, directory)
}
export function exchangeFailure(value: unknown): string {
  switch (errorCode(value)) {
    case 'bot/refused': return '服务器拒绝读取 Bot 交换记录，请检查当前配对设备的完整消息授权。'
    case 'bot/read-only': return '当前为缓存或连接未就绪，恢复连接后可重新读取交换记录。'
    case 'bot/not-found': return '此 Bot 或交换记录已不存在，无法读取。'
    case 'bot/incompatible': return '服务器返回的交换记录格式不兼容，请核对服务端版本。'
    default: return 'Bot 交换记录读取失败，可重新读取；没有把失败当作空记录。'
  }
}
export function exchangeRows(value: unknown): Record<string, unknown>[] {
  const invalid = () => new DeckError('bot/incompatible', '服务器交换记录格式无效。')
  if (!Array.isArray(value)) throw invalid()
  return value.map(item => {
    const row = record(item)
    if (!row || typeof row.text !== 'string') throw invalid()
    return row
  })
}
