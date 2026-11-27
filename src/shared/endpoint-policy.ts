// SPDX-License-Identifier: Apache-2.0
// 复用上游敏感端点分类；标准 Deck 不额外要求设备验证，未知宿主端点仍由服务器最终授权。
// 客户端不提供电脑控制或浏览器接管；computer-shot 仅保留上游已有附件读取及原门禁。
import { BROWSER_ALLOWED } from '@dsbot/browser-policy'
import { GATED } from '@dsbot/gated'
const LOCAL_ONLY = new Set(['folder-pick', 'computer-user-active', 'computer-permission', 'data-move'])
// 仅登记已核对的资源和私聊目标操作；权限和对象归属由服务器逐次校验。
export const EXTRA_READS = new Set(['extra-status', 'extra-messages', 'extra-task-read', 'extra-tool-list', 'extra-tool-detail', 'extra-todos',
  'extra-attachment-status',
  'extra-delegation-list', 'extra-delegation-read', 'extra-tool-change', 'extra-workspace-open', 'extra-workspace-list', 'extra-workspace-read',
  'extra-workspace-save-status', 'extra-workspace-change', 'extra-terminal-list', 'extra-terminal-read'])
export const EXTRA_WRITES = new Set(['extra-attachment-open', 'extra-attachment-chunk', 'extra-attachment-send', 'extra-attachment-discard', 'extra-terminal-create', 'extra-terminal-input', 'extra-terminal-resize', 'extra-terminal-close', 'extra-workspace-save', 'extra-goal-control'])
export const EXTRA_OPERATIONS = new Set([...EXTRA_READS, ...EXTRA_WRITES])
const READ_ONLY = new Set([
  'hello', 'state', 'notices', 'avatar', 'models', 'efforts', 'providers', 'usage', 'usage-summary', 'run-stats',
  'chat', 'room-chat', 'file-text', 'file-download', 'image', 'markdown-image', 'exchange', 'exchange-text',
  'schedules', 'memory-view', 'folders', 'folder-list', 'update-check', 'diagnostics', 'diagnostics-log',
  'bot-task-read', 'bot-task-list', 'avatar-library', 'capabilities', 'secrets', 'connectors', 'im-status',
  'client-error',
])
const TEAM_ACTIONS = new Set([
  'set-prefs', 'set-flags', 'section-save', 'section-order', 'section-delete', 'room-todo', 'resume',
  'stop-member-work', 'bot-task-send', 'goal-draft', 'goal-control', 'task-note', 'task-cancel',
])
export type EndpointPolicy = 'safe' | 'unlock' | 'denied'
export const computerControl = (endpoint: string): boolean => endpoint.startsWith('browser-') || (endpoint.startsWith('computer-') && endpoint !== 'computer-shot')
export function endpointPolicy(endpoint: string, mode: 'phone' | 'browser'): EndpointPolicy {
  if (computerControl(endpoint) || endpoint.startsWith('phone-') || endpoint.startsWith('mcp-') || LOCAL_ONLY.has(endpoint)) return 'denied'
  if (endpoint.startsWith('extra-') && !EXTRA_OPERATIONS.has(endpoint)) return 'denied'
  if (mode === 'browser' && !BROWSER_ALLOWED.has(endpoint) && !EXTRA_OPERATIONS.has(endpoint)) return 'denied'
  if (GATED.has(endpoint)) return 'unlock'
  return BROWSER_ALLOWED.has(endpoint) || READ_ONLY.has(endpoint) || EXTRA_OPERATIONS.has(endpoint) || TEAM_ACTIONS.has(endpoint) ? 'safe' : 'unlock'
}
export const backgroundRead = (endpoint: string): boolean => READ_ONLY.has(endpoint)
export const openingRead = (endpoint: string): boolean => ['hello', 'state', 'notices'].includes(endpoint)
