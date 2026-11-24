// SPDX-License-Identifier: Apache-2.0
// 主题在本机统一应用；保留服务器的消息布局和动效，不改服务器配色设置。
import { useLayoutEffect, useState } from 'react'
import { effectsOf, themeCss } from '@dsbot/themes'
import { isDarkTheme, themeDefinition, watchThemeMode } from '../shared/theme-model.ts'
export function useDeckTheme(appearance, prefs, paint) {
  const name = appearance?.theme ?? 'deepseek'
  const mode = appearance?.themeMode ?? 'system'
  const [dark, setDark] = useState(() => isDarkTheme(mode, matchMedia('(prefers-color-scheme: dark)').matches))
  useLayoutEffect(() => {
    const theme = themeDefinition(name)
    const style = document.createElement('style')
    style.textContent = themeCss(theme)
    document.head.append(style)
    const stop = watchThemeMode(mode, matchMedia('(prefers-color-scheme: dark)'), dark => {
      document.body.toggleAttribute('data-ds-dark-theme', dark)
      setDark(dark)
      const palette = dark ? theme.dark : theme.light
      paint?.(palette.bg, palette.text)
    })
    return () => { stop(); style.remove() }
  }, [name, mode, paint])
  useLayoutEffect(() => {
    document.body.dataset.btEffects = effectsOf(prefs)
    if (prefs?.motion) document.body.dataset.btMotion = prefs.motion
    else delete document.body.dataset.btMotion
  }, [prefs?.effects, prefs?.motion])
  return dark
}
