// SPDX-License-Identifier: Apache-2.0
// 以宠物本体的桌面锚点布置透明画布，换边只移动画布，不移动宠物。
import type { Bounds, Point } from './domain.ts'
export const PET_CANVAS = { width: 380, height: 440 }
export type PetBubbleSide = 'above' | 'below'
export interface PetLayout {
  width: number; height: number; size: number; side: PetBubbleSide
  body: Bounds; toolbar: Bounds; lamps: Bounds
  panel: { x: number; width: number; offset: number; maxHeight: number }
}
export interface PetLayoutMessage extends PetLayout { revision: number }
export interface PetPointer extends Point { layoutRevision: number }
export interface PetPlacement { bounds: Bounds; layout: PetLayout; position: Point }
const EDGE = 8
const GAP = 10
const TOOLBAR_RISE = 35
const LAMP_HEIGHT = 138
const RIGHT_SPACE = 64
const rounded = (value: number): number => Math.round(value * 1000) / 1000
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)))
export const petBodySize = (size: number): Pick<Bounds, 'width' | 'height'> => ({ width: rounded(size * 192 / 208), height: rounded(size + 27) })
// 原 position 是旧版 380×440 上方画布的原点；保留该格式，不新增持久化版本。
export function legacyPetAnchor(position: Point, size: number): Point {
  const body = petBodySize(size)
  return { x: rounded(position.x + PET_CANVAS.width - 12 - body.width), y: rounded(position.y + PET_CANVAS.height - 10 - body.height) }
}
export function legacyPetPosition(anchor: Point, size: number): Point {
  const body = petBodySize(size)
  return { x: rounded(anchor.x - PET_CANVAS.width + 12 + body.width), y: rounded(anchor.y - PET_CANVAS.height + 10 + body.height) }
}
export function placePet(anchor: Point, size: number, area: Bounds, previousSide: PetBubbleSide | null = null): PetPlacement {
  const width = Math.min(PET_CANVAS.width, area.width); const height = Math.min(PET_CANVAS.height, area.height)
  const bodySize = petBodySize(size)
  // 预留全部四盏灯，数量改变时不让宠物或工具栏跳位。
  const rise = Math.max(TOOLBAR_RISE, LAMP_HEIGHT - bodySize.height)
  const world = {
    x: rounded(clamp(anchor.x, area.x + EDGE, area.x + area.width - RIGHT_SPACE - bodySize.width)),
    y: rounded(clamp(anchor.y, area.y + EDGE + rise, area.y + area.height - EDGE - bodySize.height)),
  }
  const above = world.y - rise - area.y
  const below = area.y + area.height - world.y - bodySize.height
  // 中线附近保留上一方向，避免拖动时因细小坐标变化反复换边。
  const side = previousSide !== null && Math.abs(above - below) <= 24 ? previousSide : above >= below ? 'above' : 'below'
  const bodyY = side === 'above' ? height - EDGE - bodySize.height : EDGE + rise
  const bounds = {
    x: clamp(Math.ceil(world.x - width + RIGHT_SPACE + bodySize.width), area.x, area.x + area.width - width),
    y: Math.round(clamp(world.y - bodyY, area.y, area.y + area.height - height)), width, height,
  }
  const body = { x: rounded(world.x - bounds.x), y: rounded(world.y - bounds.y), ...bodySize }
  const toolbar = { x: rounded(Math.max(EDGE, body.x + body.width - 56)), y: rounded(body.y - TOOLBAR_RISE), width: 56, height: 29 }
  const lamps = { x: rounded(body.x + body.width + 8), y: rounded(Math.min(body.y, body.y + body.height - LAMP_HEIGHT)), width: 44, height: LAMP_HEIGHT }
  const upperEdge = Math.min(toolbar.y, lamps.y); const lowerEdge = body.y + body.height
  const panel = {
    x: EDGE, width: width - EDGE * 2,
    offset: rounded(side === 'above' ? height - upperEdge + GAP : lowerEdge + GAP),
    maxHeight: rounded(Math.max(0, side === 'above' ? upperEdge - GAP - EDGE : height - lowerEdge - GAP - EDGE)),
  }
  return { bounds, layout: { width, height, size, side, body, toolbar, lamps, panel }, position: legacyPetPosition(world, size) }
}
