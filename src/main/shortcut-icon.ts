// SPDX-License-Identifier: Apache-2.0
// 仅更新安装器创建且仍指向本程序的开始菜单入口，不新建或覆盖用户的其他快捷方式。
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { record } from '../shared/validation.ts'
export interface ShortcutPort {
  readShortcutLink(file: string): { target?: string; appUserModelId?: string; icon?: string; iconIndex?: number }
  writeShortcutLink(file: string, operation: 'update', details: { target: string; icon: string; iconIndex: number }): boolean
}
export const sameWindowsPath = (a: string, b: string): boolean => path.win32.isAbsolute(a) && path.win32.isAbsolute(b) && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()
export function updateShortcutIcon(file: string, executable: string, icon: string, port: ShortcutPort): 'updated' | 'skipped' {
  const shortcut = port.readShortcutLink(file)
  if (typeof shortcut.target !== 'string' || !sameWindowsPath(shortcut.target, executable) || shortcut.appUserModelId && shortcut.appUserModelId !== 'io.dsbotdeck.desktop') return 'skipped'
  if (shortcut.icon && sameWindowsPath(shortcut.icon, icon) && shortcut.iconIndex === 0) return 'skipped'
  // Electron 的写入类型要求 target；原样保留刚核对的目标，其余启动属性由 update 保留。
  if (!port.writeShortcutLink(file, 'update', { target: shortcut.target, icon, iconIndex: 0 })) throw new Error('shortcut-update-failed')
  return 'updated'
}
export async function syncStartMenuIcon(roots: string[], executable: string, icon: string, port: ShortcutPort): Promise<boolean> {
  let failed = false
  for (const root of new Set(roots)) {
    const file = path.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'DSBotDeck.lnk')
    try {
      const entry = await lstat(file)
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      updateShortcutIcon(file, executable, icon, port)
    } catch (error) {
      if (record(error)?.code !== 'ENOENT') failed = true
    }
  }
  return !failed
}
