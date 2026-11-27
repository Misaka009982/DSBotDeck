// SPDX-License-Identifier: Apache-2.0
// 只读截取固定上游的呈现组件，避免导入本机 Session、工具执行和插件注册。
export const COMPONENT_UI_FILES = ['app/ui/src/composer-menus.js', 'app/ui/src/tool-card.js', 'app/ui/src/builtin-tool-views.js']
export function componentPart(source, first, last) {
  const text = source.replaceAll('\r\n', '\n')
  if (text.split(first).length !== 2 || text.split(last).length !== 2 || text.indexOf(first) >= text.indexOf(last)) throw new Error(`上游组件结构已变化：${first}`)
  return text.slice(text.indexOf(first), text.indexOf(last))
}
function constant(source, name) {
  const rows = source.replaceAll('\r\n', '\n').split('\n').filter(line => line.startsWith(`const ${name} = `))
  if (rows.length !== 1) throw new Error(`上游组件常量结构已变化：${name}`)
  return rows[0] + '\n'
}
function replace(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`上游组件结构已变化：${before}`)
  return source.replace(before, after)
}
export function composerAttachmentsSource(source) {
  let body = componentPart(source, 'function ComposerAttachments({', 'const keepComposerFocus =')
  body = replace(body, 'function ComposerAttachments({ items, onRemove, onPutBackPaste }) {', 'export function ComposerAttachments({ items, onRemove, onPutBackPaste }) {')
  return "import { createElement as h } from 'react'\nimport { fileExtension, fileSizeText } from './primitives.js'\nimport { PasteCard } from '../../../ds-bot/src/client/paste-card.js'\nimport { CloseIcon, FileIcon } from '../../../ds-bot/src/client/icons.js'\nimport { t } from '../../../ds-bot/src/client/i18n.js'\n" + body
}
export function paintComponents(source, name) {
  if (name === 'app/ui/src/composer-menus.js') {
    const first = 'const keepFocus = event => event.preventDefault()'
    if (source.split(first).length !== 2) throw new Error('上游候选菜单结构已变化。')
    const normalized = source.replaceAll('\r\n', '\n')
    let body = normalized.slice(normalized.indexOf(first))
    // 保留 Deck 的 combobox 活跃项引用与输入焦点，上游负责目录行和滚动呈现。
    body = replace(body, 'export function ComposerMenu({ items, activeIndex, label, onHover, onSelect }) {', 'export function ComposerMenu({ items, activeIndex, label, onHover, onSelect, id }) {')
    body = replace(body, '    ref: listRef,', '    ref: listRef, id,')
    body = replace(body, "        role: 'option',", "        role: 'option', id: id ? `${id}-${index}` : undefined, tabIndex: -1,")
    return "import { createElement as h, Fragment, useEffect, useRef } from 'react'\nimport { BotMark } from '../../../ds-bot/src/client/mark.js'\n" + body
  }
  if (name === 'app/ui/src/tool-card.js') {
    let body = componentPart(source, 'export function clipLongText(', 'export function formatToolDuration(')
    body = replace(body, 'export function CodeSection({ label, text, error = false }) {', 'export function CodeSection({ label, text, error = false, unfolded = false, onCopy, disabled = false }) {')
    body = replace(body, 'const clipped = useMemo(() => clipLongText(text), [text])', "const clipped = useMemo(() => unfolded ? { shown: text, folded: false, lines: 0 } : clipLongText(text), [text, unfolded])")
    body = replace(body, '    void writeClipboard(text).then((ok) => {', '    if (disabled) return\n    void Promise.resolve(onCopy ? onCopy(text) : writeClipboard(text)).then((ok) => {')
    body = replace(body, "        className: 'bt-mini dsb-tool-copy',", "        className: 'bt-mini dsb-tool-copy', disabled,")
    return "import { createElement as h, useMemo, useState } from 'react'\nimport { writeClipboard } from './primitives.js'\nimport { CheckIcon, CopyIcon } from '../../../ds-bot/src/client/icons.js'\nimport { t } from '../../../ds-bot/src/client/i18n.js'\n" + constant(source, 'FOLD_LINES') + constant(source, 'FOLD_CHARS') + body
  }
  if (name === 'app/ui/src/builtin-tool-views.js') {
    const compute = componentPart(source, 'function splitLineTokens(', '// Defensive narrowing of DSH `SearchMeta`')
    let view = componentPart(source, 'function DiffFileView(', 'function DiffToolView(')
    view = replace(view, 'function DiffFileView({ diff, computed, cwd }) {', 'export function DiffFileView({ diff, computed, cwd, onCopy, disabled = false }) {')
    view = replace(view, 'h(MiniCopy, { text: unifiedText })', 'h(MiniCopy, { text: unifiedText, onCopy, disabled })')
    return "import { createElement as h, useMemo, useState } from 'react'\nimport { t } from '../../../ds-bot/src/client/i18n.js'\nimport { MiniCopy, shortPath } from './tool-view-shared.js'\n" + constant(source, 'DIFF_FOLD_LINES') + constant(source, 'MAX_LCS_CELLS') + compute + view
  }
  return null
}
