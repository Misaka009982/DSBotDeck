// SPDX-License-Identifier: Apache-2.0
// 宠物不接触远程身份或任意 RPC，只接收公开任务与发送本机交互。
import { contextBridge, ipcRenderer } from 'electron'
import type { LocalAssetsView, Point, Selection, Snapshot } from '../shared/domain.ts'
const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}
contextBridge.exposeInMainWorld('dsbotPet', {
  version: 1,
  onSnapshot: (listener: (value: Snapshot) => void) => subscribe('deck:pet-snapshot', listener),
  onPointer: (listener: (value: Point) => void) => subscribe('deck:pet-pointer', listener),
  onAssets: (listener: (value: LocalAssetsView | null) => void) => subscribe('deck:pet-assets', listener),
  ready: () => ipcRenderer.send('deck:pet-ready'),
  regions: (value: unknown) => ipcRenderer.send('deck:pet-regions', value),
  dragStart: () => ipcRenderer.send('deck:pet-drag-start'),
  dragEnd: () => ipcRenderer.send('deck:pet-drag-end'),
  select: (value: Selection) => ipcRenderer.invoke('deck:pet-action', { action: 'select', args: value }),
  settings: () => ipcRenderer.invoke('deck:pet-action', { action: 'settings' }),
  open: () => ipcRenderer.invoke('deck:pet-action', { action: 'open' }),
})
