// SPDX-License-Identifier: Apache-2.0
// 只解析输入光标和候选按键，不读取文件、运行命令或发送消息。
export interface ComposerTrigger { kind: 'mention' | 'command'; start: number; end: number; query: string }
interface MenuKey { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean; keyCode?: number }
type MenuKeyAction = { kind: 'move' | 'pick'; index: number } | { kind: 'close' }
function insideCode(text: string): boolean {
  let fence: { mark: string; length: number } | null = null; let inline = 0
  for (const line of text.split('\n')) {
    const marker = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker && !inline) {
      const run = marker[1]
      if (!fence) fence = { mark: run[0], length: run.length }
      else if (fence.mark === run[0] && run.length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (fence) continue
    for (let at = 0; at < line.length; at++) {
      if (line[at] === '\\') { at++; continue }
      if (line[at] !== '`') continue
      let count = 1
      while (line[at + count] === '`') count++
      if (!inline) inline = count
      else if (inline === count) inline = 0
      at += count - 1
    }
  }
  return fence !== null || inline !== 0
}
export function composerTrigger(text: string, start: number, end = start): ComposerTrigger | null {
  if (!Number.isInteger(start) || start < 0 || start > text.length || end !== start) return null
  const prefix = text.slice(0, start)
  if (insideCode(prefix)) return null
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1)
  const command = /^[ \t]*\/([a-z0-9-]*)$/i.exec(line)
  if (command) return { kind: 'command', start: start - command[1].length - 1, end: start + (/^[a-z0-9-]*/i.exec(text.slice(start))?.[0].length ?? 0), query: command[1] }
  const at = prefix.lastIndexOf('@')
  if (at < 0 || at > 0 && /[a-z0-9_./]/i.test(prefix[at - 1])) return null
  const query = prefix.slice(at + 1)
  if (query.length > 128 || /[\r\n@`]/.test(query)) return null
  const tail = /^[^\s@`<>()\[\]{},;:!?，。；：！？]*/.exec(text.slice(start))?.[0] ?? ''
  return { kind: 'mention', start: at, end: query ? start + tail.length : start, query }
}
export function replaceComposerTrigger(text: string, trigger: ComposerTrigger, replacement: string): { text: string; caret: number } {
  let end = trigger.end
  if (trigger.kind === 'mention') {
    const name = replacement.trimEnd()
    if (text.slice(trigger.start).startsWith(name)) end = Math.max(end, trigger.start + name.length)
  }
  if (replacement.endsWith(' ') && text[end] === ' ') end++
  return { text: text.slice(0, trigger.start) + replacement + text.slice(end), caret: trigger.start + replacement.length }
}
export function commandName(text: string): string | null { return /^\/([a-z0-9-]+)$/i.exec(text.trim())?.[1].toLowerCase() ?? null }
export function menuKeyAction(event: MenuKey, count: number, index: number): MenuKeyAction | null {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null
  if (event.key === 'Escape') return { kind: 'close' }
  if (!count) return null
  if (event.key === 'ArrowDown') return { kind: 'move', index: (index + 1) % count }
  if (event.key === 'ArrowUp') return { kind: 'move', index: (index + count - 1) % count }
  return event.key === 'Enter' ? { kind: 'pick', index } : null
}
