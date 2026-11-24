// SPDX-License-Identifier: Apache-2.0
import type { AppearanceSettings, Bounds, ContentCommand, EntityKind, Point, SavedClient, SavedServer, Selection } from './domain.ts'
import { defaultAppearance } from './domain.ts'

export const MAX_SERVERS = 32
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024
export class DeckError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'DeckError'; this.code = code }
}
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export const text = (value: unknown, limit = 160): string => typeof value === 'string' ? value.slice(0, limit) : ''
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export function validServerId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) && value !== 'shell' && value !== 'pet'
}
export function validEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value)
}
export function selection(value: unknown): Selection | null {
  const item = record(value)
  if (!item || !validServerId(item.serverId) || !validEntityId(item.id) || (item.kind !== 'bot' && item.kind !== 'room')) return null
  return { serverId: item.serverId, id: item.id, kind: item.kind }
}
export function command(value: unknown): ContentCommand | null {
  const item = record(value)
  if (!item) return null
  if (item.action === 'chat' && (item.kind === 'bot' || item.kind === 'room') && validEntityId(item.id)) return { action: 'chat', kind: item.kind, id: item.id }
  if (item.action === 'settings') {
    const page = text(item.page, 80)
    if (page && !/^[a-z0-9-]+$/.test(page)) return null
    if (item.id !== undefined && !validEntityId(item.id)) return null
    return { action: 'settings', ...(page ? { page } : {}), ...(typeof item.id === 'string' ? { id: item.id } : {}) }
  }
  if (item.action === 'new-bot' || item.action === 'new-room') return { action: item.action }
  return null
}
export function point(value: unknown): Point | null {
  const item = record(value)
  return item && finite(item.x) && finite(item.y) && Math.abs(item.x) <= 100000 && Math.abs(item.y) <= 100000 ? { x: Math.round(item.x), y: Math.round(item.y) } : null
}
export function bounds(value: unknown): Bounds | null {
  const item = record(value)
  const origin = point(value)
  return origin && item && finite(item.width) && finite(item.height) && item.width >= 100 && item.width <= 16000 && item.height >= 100 && item.height <= 16000
    ? { ...origin, width: Math.round(item.width), height: Math.round(item.height) } : null
}
export function relayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new DeckError('bot/invalid', '中转地址无效。')
  let url: URL
  try { url = new URL(value) } catch { throw new DeckError('bot/invalid', '中转地址无效。') }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new DeckError('bot/invalid', '中转地址必须为不含账号、查询参数和片段的 ws:// 或 wss:// 地址。')
  }
  return url.toString()
}
export function pairingText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || value.trim() === '') throw new DeckError('bot/invalid', '请粘贴 DS-Bot 配对链接。')
  const input = value.trim()
  if (input.startsWith('dsbot://pair')) return input
  try {
    const url = new URL(input)
    if (['http:', 'https:'].includes(url.protocol)) {
      const embedded = new URLSearchParams(url.hash.slice(1)).get('pair')
      if (embedded?.startsWith('dsbot://pair')) return embedded
    }
  } catch {}
  throw new DeckError('bot/invalid', '这不是 DS-Bot 配对链接；请使用手机配对码或浏览器配对链接。')
}
export function frozenRequest(endpoint: unknown, payload: unknown): { endpoint: string; payload: unknown } {
  if (typeof endpoint !== 'string' || !/^[a-z][a-z0-9-]{0,100}$/.test(endpoint)) throw new DeckError('bot/invalid', '请求端点无效。')
  let encoded: string
  try { encoded = JSON.stringify({ endpoint, payload: payload ?? null }) } catch { throw new DeckError('bot/invalid', '请求必须为 JSON 数据。') }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES) throw new DeckError('bot/invalid', '请求过大，请减少单次附件大小。')
  const decoded = record(JSON.parse(encoded))
  if (!decoded) throw new DeckError('bot/invalid', '请求无效。')
  return { endpoint, payload: decoded.payload ?? null }
}
export function errorCode(error: unknown): string {
  const value = record(error)
  return text(value?.code, 100)
}
export function safeMessage(error: unknown): string {
  const code = errorCode(error)
  if (code === 'NOT_PAIRED' || code === 'PAIRING_REJECTED') return '配对已被撤销或配对码被拒绝，请在服务器重新配对。'
  if (code === 'RPC_TIMEOUT') return '远程请求超时；操作是否执行尚待确认，不会自动重发。'
  if (['TRANSPORT_CLOSED', 'SERVER_UNREACHABLE', 'HOST_OFFLINE', 'HOST_UNREACHABLE'].includes(code)) return '远程链路暂不可用，已保留缓存。'
  if (error instanceof DeckError) return error.message
  if (code === 'bot/refused' || code === 'bot/invalid' || code === 'bot/read-only' || code === 'bot/not-found') {
    return text(record(error)?.message, 1000) || '服务器拒绝了该操作。'
  }
  return '操作未完成；请检查服务器状态。没有自动重发请求。'
}

function savedServer(value: unknown): SavedServer {
  const item = record(value)
  const identity = record(item?.identity)
  const strings = ['deviceId', 'publicKey', 'privateKey', 'accessToken']
  if (!item || !validServerId(item.id) || !identity || strings.some(key => typeof identity[key] !== 'string' || text(identity[key], 257).length < 8 || text(identity[key], 257).length > 256)) {
    throw new DeckError('vault/corrupt', '加密配置中的服务器身份不完整；未重建或覆盖原记录。')
  }
  if (!validEntityId(item.hostDeviceId) || typeof item.hostKey !== 'string' || item.hostKey.length > 256 || (item.mode !== 'phone' && item.mode !== 'browser')) {
    throw new DeckError('vault/corrupt', '加密配置中的主机身份无效；未覆盖原记录。')
  }
  return {
    id: item.id, alias: text(item.alias, 80) || '远程 DS-Bot', relayUrl: relayUrl(item.relayUrl),
    hostDeviceId: item.hostDeviceId, hostKey: item.hostKey, mode: item.mode,
    identity: { deviceId: String(identity.deviceId), publicKey: String(identity.publicKey), privateKey: String(identity.privateKey), accessToken: String(identity.accessToken) },
    paired: item.paired === true, autoConnect: item.autoConnect === true,
    unfollowed: Array.isArray(item.unfollowed) ? item.unfollowed.filter((key): key is string => typeof key === 'string' && key.length <= 300) : [],
  }
}
export function localPath(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 4096 || !/^[a-z]:[\\/]/i.test(value) || /[\u0000-\u001f]/.test(value) || value.slice(2).includes(':')) throw new DeckError('bot/invalid', '只能选择本机磁盘路径，不能使用网络地址或设备路径。')
  return value
}
export function petSkin(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || value === '.' || value === '..' || /[\\/:\u0000-\u001f]/.test(value)) throw new DeckError('bot/invalid', '宠物编号无效。')
  return value
}
export function savedAppearance(value: unknown): AppearanceSettings {
  const defaults = defaultAppearance()
  if (value === undefined) return defaults
  const entry = record(value)
  if (!entry) throw new DeckError('bot/invalid', 'Deck 外观设置无效。')
  const language = entry.language ?? defaults.language
  if (language !== 'zh' && language !== 'zh-TW' && language !== 'en' && language !== 'ja' && language !== 'ko' && language !== 'es' && language !== 'fr' && language !== 'de' && language !== 'system') throw new DeckError('bot/invalid', '界面语言无效。')
  const opacity = entry.opacity ?? defaults.opacity; const blur = entry.blur ?? defaults.blur; const fit = entry.fit ?? defaults.fit
  if (!finite(opacity) || opacity < 0 || opacity > 1 || !finite(blur) || blur < 0 || blur > 24 || (fit !== 'cover' && fit !== 'contain')) throw new DeckError('bot/invalid', '背景透明度、模糊或布局无效。')
  return { language, iconPath: localPath(entry.iconPath), backgroundPath: localPath(entry.backgroundPath), petLibraryPath: localPath(entry.petLibraryPath), opacity, blur, fit }
}
export function savedClient(value: unknown): SavedClient {
  const item = record(value)
  const pet = record(item?.pet)
  if (!item || item.version !== 1 || !Array.isArray(item.servers) || item.servers.length > MAX_SERVERS || !pet) {
    throw new DeckError('vault/corrupt', '客户端加密配置格式无效；未重置原文件。')
  }
  const servers = item.servers.map(savedServer)
  if (new Set(servers.map(server => server.id)).size !== servers.length) throw new DeckError('vault/corrupt', '配置中存在重复服务器身份；未重置原文件。')
  const chosen = selection(item.selected)
  const size = pet.size ?? 112
  if (!finite(size) || size < 72 || size > 144) throw new DeckError('bot/invalid', '宠物显示尺寸无效。')
  return {
    version: 1, servers,
    selected: chosen && servers.some(server => server.id === chosen.serverId) ? chosen : null,
    pet: { enabled: pet.enabled === true, locked: pet.locked === true, alwaysOnTop: pet.alwaysOnTop !== false, position: point(pet.position), skin: petSkin(pet.skin), size },
    appearance: savedAppearance(item.appearance), window: bounds(item.window),
  }
}
export const kindOf = (value: unknown): EntityKind | null => value === 'bot' || value === 'room' ? value : null
