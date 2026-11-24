// SPDX-License-Identifier: Apache-2.0
// 原配色只读复用；固定明暗模式不订阅系统变化。
import { allThemes } from '@dsbot/themes'
import type { ThemeMode } from './domain.ts'
interface MediaPort {
  readonly matches: boolean
  addEventListener(event: 'change', listener: () => void): void
  removeEventListener(event: 'change', listener: () => void): void
}
export const isDarkTheme = (mode: ThemeMode, systemDark: boolean): boolean => mode === 'dark' || mode === 'system' && systemDark
export function themeDefinition(name: string) {
  const themes = allThemes()
  return Object.entries(themes).find(([id]) => id === name)?.[1] ?? themes.deepseek
}
export function watchThemeMode(mode: ThemeMode, media: MediaPort, changed: (dark: boolean) => void): () => void {
  const paint = () => changed(isDarkTheme(mode, media.matches))
  paint()
  if (mode !== 'system') return () => {}
  media.addEventListener('change', paint)
  return () => media.removeEventListener('change', paint)
}
