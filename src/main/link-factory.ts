// SPDX-License-Identifier: Apache-2.0
// 手机链路由上游实现，主进程只注入各服务器自己的身份。
import { deviceIdFor, fromBase64Url, generateKeyPair, parsePairingUri, randomToken, RelayTransport, RpcClient, SecureTransport } from '@dsbot/link'
import type { Identity, SavedServer } from '../shared/domain.ts'
import { DeckError, pairingText, relayUrl } from '../shared/validation.ts'

export interface PeerEvent { event: string; data: unknown }
export interface Peer {
  connect(): Promise<void>
  rpc<T = unknown>(method: string, params: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T>
  onEvent(handler: (entry: PeerEvent) => void): () => void
  onClose(handler: () => void): () => void
  probe(timeoutMs?: number): void
  close(): Promise<void>
  reason(): unknown
}
export type PeerFactory = (server: SavedServer, pairingCode?: string) => Peer
export function newIdentity(): Identity {
  const keys = generateKeyPair()
  return { ...keys, deviceId: deviceIdFor(keys.publicKey), accessToken: randomToken() }
}
export function pairingOffer(input: unknown) {
  try {
    const offer = parsePairingUri(pairingText(input))
    return { ...offer, server: relayUrl(offer.server) }
  } catch (error) {
    if (error instanceof DeckError) throw error
    throw new DeckError('bot/invalid', '配对链接无效、版本不受支持或主机公钥不匹配。请重新复制服务器生成的配对码。')
  }
}
export function assertServerIdentity(server: SavedServer): void {
  try {
    // 只用原私钥推导公钥核对完整性，不创建或保存替代设备身份。
    const derived = generateKeyPair(fromBase64Url(server.identity.privateKey))
    if (derived.publicKey !== server.identity.publicKey || deviceIdFor(server.identity.publicKey) !== server.identity.deviceId || deviceIdFor(server.hostKey) !== server.hostDeviceId || !/^[A-Za-z0-9_-]{43}$/.test(server.identity.accessToken)) throw new Error('invalid-identity')
  } catch { throw new DeckError('PEER_IDENTITY_MISMATCH', '配对身份不完整或私钥与公钥不匹配，已停止自动连接；没有生成替代身份或覆盖原记录。') }
}
export const makePeer: PeerFactory = (server, pairingCode) => {
  assertServerIdentity(server)
  const relay = new RelayTransport(server.relayUrl, {
    deviceId: server.identity.deviceId, identityKey: server.identity.publicKey,
    accessToken: server.identity.accessToken, targetDeviceId: server.hostDeviceId,
  })
  const secure = new SecureTransport(relay, server.identity, { deviceId: server.hostDeviceId, identityKey: server.hostKey }, {
    hello: { name: 'DSBotDeck（Windows）', ...(pairingCode === undefined ? {} : { pairingCode }) },
  })
  const client = new RpcClient(secure)
  return {
    connect: () => client.connect(),
    rpc: <T>(method: string, params: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => client.rpc<T>(method, params, options),
    onEvent: handler => client.onEvent(handler), onClose: handler => client.onClose(handler),
    probe: timeoutMs => client.probe(timeoutMs), close: () => client.close(), reason: () => relay.closeReason,
  }
}
