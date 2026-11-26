// SPDX-License-Identifier: Apache-2.0
// 保留原头像、名称与尾部内容；独立按钮避免设置入口与详情点击互相覆盖。
import { Children, createElement as h } from 'react'
export function HeaderActions({ botId, name, openSettings, children, ...props }) {
  if (!botId || typeof openSettings !== 'function') return h('button', props, children)
  const parts = Children.toArray(children)
  return h('div', { className: `${props.className} deck-header-pill`, role: 'group', 'aria-label': `${name} 快捷操作`,
    'data-memory': props['data-memory'], 'data-details': props['aria-expanded'] === true ? '' : undefined },
  h('button', { ...props, className: 'deck-header-avatar' }, parts[0]),
  h('button', { type: 'button', className: 'deck-header-name', title: `打开 ${name} 设置`, 'aria-label': `打开 ${name} 设置`,
    onClick: () => openSettings('bots', botId) }, parts[1]),
  h('button', { ...props, className: 'deck-header-tail' }, parts.slice(2)))
}
