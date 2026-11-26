// SPDX-License-Identifier: Apache-2.0
// 分类标签只管理本机面板，不写服务器偏好或重挂聊天。
export const SETTINGS_TABS = [
  { id: 'window', label: '窗口' }, { id: 'theme', label: '主题与语言' }, { id: 'icon', label: '图标' },
  { id: 'background', label: '背景' }, { id: 'pet', label: '宠物' },
] as const
export type SettingsTabId = typeof SETTINGS_TABS[number]['id']
export function settingsTabKey(current: SettingsTabId, key: string): SettingsTabId | null {
  if (key === 'Home') return SETTINGS_TABS[0].id
  if (key === 'End') return SETTINGS_TABS.at(-1)!.id
  const direction = ['ArrowRight', 'ArrowDown'].includes(key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(key) ? -1 : 0
  if (!direction) return null
  const index = SETTINGS_TABS.findIndex(tab => tab.id === current)
  return SETTINGS_TABS[(index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length].id
}
