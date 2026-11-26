// SPDX-License-Identifier: Apache-2.0
// 原 UI 只接收自身页面命令，不暴露通用 IPC、文件系统或设备身份。
import { contextBridge, ipcRenderer } from 'electron'
import type { ContentCommand, ContentStatus } from '../shared/domain.ts'
const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}
contextBridge.exposeInMainWorld('dsbotContent', {
  version: 1,
  onCommand: (listener: (value: ContentCommand) => void) => subscribe('deck:content-command', listener),
  onStatus: (listener: (value: ContentStatus) => void) => subscribe('deck:content-status', listener),
  drafts: (value: boolean) => ipcRenderer.send('deck:content-drafts', value === true),
  ready: () => ipcRenderer.send('deck:content-ready'),
  selected: (kind: 'bot' | 'room', id: string) => ipcRenderer.send('deck:content-selected', { kind, id }),
  viewed: (kind: 'bot' | 'room', id: string) => ipcRenderer.send('deck:content-viewed', { kind, id }),
  viewedTask: (botId: string, taskId: string) => ipcRenderer.send('deck:content-task-viewed', { botId, taskId }),
})
