// SPDX-License-Identifier: Apache-2.0
// 本机窗口布局请求与DIP几何；不允许修改显示器分辨率或传入任意位置。
import type { Bounds } from './domain.ts'
import { DeckError, record } from './validation.ts'
export type WindowLayoutRequest = { mode: 'left' | 'right' } | { mode: 'custom'; width: number; height: number }
export interface WindowLayoutView { bounds: Bounds; userSize: { width: number; height: number }; sizeRevision: number; workArea: Bounds; minimum: { width: number; height: number }; scaleFactor: number }
export function windowLayoutRequest(value: unknown): WindowLayoutRequest | null {
  if (value === null) return null
  const data = record(value)
  const invalid = () => { throw new DeckError('bot/invalid', '窗口布局方式或宽高无效；只允许本机窗口的左右半屏与整数宽高。') }
  if (!data) return invalid()
  if (data.mode === 'left' || data.mode === 'right') return Object.keys(data).length === 1 ? { mode: data.mode } : invalid()
  if (data.mode !== 'custom' || Object.keys(data).some(key => !['mode', 'width', 'height'].includes(key))) return invalid()
  const { width, height } = data
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 100 || width > 16000 || height < 100 || height > 16000) return invalid()
  return { mode: 'custom', width, height }
}
export function windowLayoutTarget(request: WindowLayoutRequest, current: Bounds, area: Bounds): Bounds {
  if (request.mode === 'custom') return { x: Math.round(current.x + (current.width - request.width) / 2), y: Math.round(current.y + (current.height - request.height) / 2), width: request.width, height: request.height }
  const half = Math.floor(area.width / 2)
  return { x: area.x + (request.mode === 'right' ? half : 0), y: area.y, width: request.mode === 'right' ? area.width - half : half, height: area.height }
}
