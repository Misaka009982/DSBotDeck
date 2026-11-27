// SPDX-License-Identifier: Apache-2.0
// 只将已读取的前后文本交给原版差异组件；缺旧文本时不推定为新增文件。
import { createElement as h, useMemo } from 'react'
import { writeClipboard } from '@dsbot/ui/primitives.js'
import { computeLineDiff, DiffFileView } from '@dsbot/ui/builtin-tool-views.js'
import { CodeSection } from '@dsbot/ui/tool-card.js'
export function RecordedChange({ path, before, after, canCopy, disabled = false, fragment = false }) {
  const complete = typeof before === 'string' && typeof after === 'string'
  const computed = useMemo(() => complete ? computeLineDiff(before, after) : null, [before, after, complete])
  const copy = async text => {
    if (disabled || !canCopy()) return false
    const ok = await writeClipboard(text)
    return canCopy() && ok
  }
  return h('div', { className: 'deck-recorded-change' },
    fragment ? h('p', { className: 'deck-resource-note' }, '行号相对于本段已记录文本。') : null,
    computed ? h(DiffFileView, { key: path, diff: { path }, computed, onCopy: copy, disabled }) : h('div', null,
      typeof before === 'string' ? h(CodeSection, { label: '修改前', text: before, onCopy: copy, disabled }) : h('p', { className: 'deck-resource-note' }, '旧文本不可用，不能计算完整差异。'),
      typeof after === 'string' ? h(CodeSection, { label: '修改后', text: after, onCopy: copy, disabled }) : h('p', { className: 'deck-resource-note' }, '新文本不可用。')))
}
