// SPDX-License-Identifier: Apache-2.0
// 只定义主题目录和明暗监听回归，不启动窗口或读取真实系统设置。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { allThemes, themeCss } from '@dsbot/themes'
import type { ThemeMode } from '../src/shared/domain.ts'
import { isDarkTheme, themeDefinition, watchThemeMode } from '../src/shared/theme-model.ts'

class FixtureMedia {
  matches = false
  readonly listeners = new Set<() => void>()
  addEventListener(_event: 'change', listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_event: 'change', listener: () => void): void { this.listeners.delete(listener) }
  change(dark: boolean): void { this.matches = dark; for (const listener of this.listeners) listener() }
}
test('Deck 原样复用上游每套主题的浅色和深色，不另存配色副本', () => {
  const themes = allThemes()
  assert.deepEqual(Object.keys(themes).sort(), ['deepseek', 'fei', 'mono', 'moonlight', 'paper'])
  for (const [name, theme] of Object.entries(themes)) {
    assert.deepEqual(themeDefinition(name), theme)
    const css = themeCss(themeDefinition(name), undefined)
    assert.ok(css.includes(theme.light.bg)); assert.ok(css.includes(theme.dark.bg))
    assert.ok(css.includes('body[data-ds-dark-theme]'))
  }
  assert.deepEqual(themeDefinition('missing-theme'), themes.deepseek)
  assert.deepEqual(themeDefinition('__proto__'), themes.deepseek)
})
test('固定浅色或深色不随系统明暗变化，也不注册系统监听', () => {
  const modes: ThemeMode[] = ['light', 'dark']
  for (const mode of modes) for (const systemDark of [false, true]) {
    const media = new FixtureMedia(); media.matches = systemDark
    const painted: boolean[] = []
    const stop = watchThemeMode(mode, media, dark => painted.push(dark))
    assert.equal(media.listeners.size, 0)
    assert.deepEqual(painted, [mode === 'dark'])
    media.change(!systemDark)
    assert.deepEqual(painted, [mode === 'dark'])
    assert.equal(isDarkTheme(mode, systemDark), mode === 'dark')
    stop()
  }
})
test('跟随系统立即应用当前明暗，变化时更新且退出释放监听', () => {
  const media = new FixtureMedia(); const painted: boolean[] = []
  const stop = watchThemeMode('system', media, dark => painted.push(dark))
  assert.equal(media.listeners.size, 1); assert.deepEqual(painted, [false])
  media.change(true); media.change(false)
  assert.deepEqual(painted, [false, true, false])
  stop(); assert.equal(media.listeners.size, 0)
  media.change(true); assert.deepEqual(painted, [false, true, false])
  assert.equal(isDarkTheme('system', true), true); assert.equal(isDarkTheme('system', false), false)
})
