// SPDX-License-Identifier: Apache-2.0
// 只组合上游主题预览卡；选择只写 Deck 本机设置。
import { createElement as h } from 'react'
import { ThemeCard } from '@dsbot/client/appearance-page.js'
export function ThemeGallery({ themes, current, dark, onPick }) {
  return h('div', { className: 'bt-look-themes' }, Object.entries(themes).map(([id, theme]) => h(ThemeCard, { key: id, id, theme, current, dark, pick: onPick })))
}
