// SPDX-License-Identifier: Apache-2.0
// 主窗口只拿公开快照和有名操作，不能指定任意 IPC 通道。
import { contextBridge, ipcRenderer } from 'electron'
import type { BackgroundCrop, ContentCommand, LocalAssetsView, LocalMark, Selection, Snapshot, UiLanguage } from '../shared/domain.ts'
const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}
const invoke = (action: string, args: unknown = null) => ipcRenderer.invoke('deck:shell-action', { action, args })
contextBridge.exposeInMainWorld('dsbotDeck', {
  version: 1,
  snapshot: (): Promise<Snapshot> => ipcRenderer.invoke('deck:shell-snapshot'),
  onSnapshot: (listener: (value: Snapshot) => void) => subscribe('deck:shell-snapshot', listener),
  onViewError: (listener: (value: string | null) => void) => subscribe('deck:view-error', listener),
  onAssets: (listener: (value: LocalAssetsView) => void) => subscribe('deck:local-assets', listener),
  onSettings: (listener: () => void) => subscribe('deck:open-settings', listener),
  assets: () => invoke('assets'),
  rasterIcon: (revision: string, png: string) => invoke('icon-raster', { revision, png }),
  builtinIcon: (look: LocalMark, png: string) => invoke('builtin-icon', { look, png }),
  chooseAsset: (kind: 'icon' | 'background' | 'pets') => invoke('choose-asset', { kind }),
  resetAsset: (kind: 'icon' | 'background' | 'pets') => invoke('reset-asset', { kind }),
  refreshAssets: () => invoke('refresh-assets'),
  appearance: (patch: { opacity?: number; blur?: number; fit?: 'cover' | 'contain'; language?: UiLanguage; backgroundCrop?: BackgroundCrop | null }) => invoke('appearance', patch),
  pair: (uri: string, alias: string, repairId?: string) => invoke('pair', { uri, alias, repairId }),
  connect: (serverId: string) => invoke('connect', { serverId }),
  disconnect: (serverId: string) => invoke('disconnect', { serverId }),
  rename: (serverId: string, alias: string) => invoke('rename', { serverId, alias }),
  forget: (serverId: string) => invoke('forget', { serverId }),
  select: (value: Selection) => invoke('select', value),
  navigate: (serverId: string, value: ContentCommand) => invoke('navigate', { serverId, command: value }),
  follow: (serverId: string, key: string, followed: boolean) => invoke('follow', { serverId, key, followed }),
  pet: (patch: { enabled?: boolean; locked?: boolean; alwaysOnTop?: boolean; skin?: string | null; size?: number; mark?: LocalMark | null }) => invoke('pet', patch),
  reopen: (serverId: string) => invoke('reopen', { serverId }),
  quit: () => invoke('quit'),
  viewport: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('deck:viewport', bounds),
  overlay: (open: boolean) => ipcRenderer.send('deck:overlay', open),
  theme: (color: string, ink: string) => ipcRenderer.send('deck:theme', { color, ink }),
})
