// SPDX-License-Identifier: Apache-2.0
import type { Bounds, Point } from './domain.ts'
import { finite, record } from './validation.ts'
export interface PetRegions { body: Bounds | null; controls: Bounds[] }
export type PetRegion = 'body' | 'controls' | 'none'
function rectangle(value: unknown): Bounds | null {
  const item = record(value)
  if (!item || !finite(item.x) || !finite(item.y) || !finite(item.width) || !finite(item.height)) return null
  if (item.width <= 0 || item.height <= 0 || item.width > 1024 || item.height > 1024 || item.x < 0 || item.y < 0 || item.x > 1024 || item.y > 1024) return null
  return { x: item.x, y: item.y, width: item.width, height: item.height }
}
export function petRegions(value: unknown): PetRegions | null {
  const item = record(value)
  if (!item || !Array.isArray(item.controls) || item.controls.length > 16) return null
  const controls = item.controls.map(rectangle)
  if (controls.some(control => control === null)) return null
  return { body: item.body === null ? null : rectangle(item.body), controls: controls.filter((control): control is Bounds => control !== null) }
}
export function contains(rectangle: Bounds, point: Point): boolean {
  return point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height
}
export function petRegion(regions: PetRegions, point: Point): PetRegion {
  if (regions.controls.some(control => contains(control, point))) return 'controls'
  return regions.body && contains(regions.body, point) ? 'body' : 'none'
}
export function petToolbarVisible(body: Bounds | null, toolbar: Bounds | null, point: Point, shown: boolean): boolean {
  if (!body) return false
  if (contains(body, point)) return true
  if (!shown || !toolbar) return false
  // 已从主体打开后，跨过主体与按钮之间的小空隙时保持可点。
  const left = Math.min(body.x, toolbar.x); const top = Math.min(body.y, toolbar.y)
  return contains({ x: left, y: top, width: Math.max(body.x + body.width, toolbar.x + toolbar.width) - left, height: Math.max(body.y + body.height, toolbar.y + toolbar.height) - top }, point)
}
export const petInteractive = (region: PetRegion, locked: boolean): boolean => region === 'controls' || region === 'body' && !locked
export function dragBounds(origin: Bounds, start: Point, current: Point): Bounds {
  return { ...origin, x: Math.round(origin.x + current.x - start.x), y: Math.round(origin.y + current.y - start.y) }
}
