// SPDX-License-Identifier: Apache-2.0
// 几何回归只使用虚构工作区，不启动 Electron 或访问真实显示器。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Bounds, Point } from '../src/shared/domain.ts'
import { dragBounds } from '../src/shared/pet-geometry.ts'
import { PET_CANVAS, legacyPetAnchor, legacyPetPosition, placePet } from '../src/shared/pet-layout.ts'
import type { PetPlacement } from '../src/shared/pet-layout.ts'
const area = { x: 0, y: 0, width: 1920, height: 1080 }
const bodyAt = (value: PetPlacement): Bounds => ({ ...value.layout.body, x: value.bounds.x + value.layout.body.x, y: value.bounds.y + value.layout.body.y })
const close = (actual: Point, expected: Point) => { assert.ok(Math.abs(actual.x - expected.x) < 0.002); assert.ok(Math.abs(actual.y - expected.y) < 0.002) }
function inside(value: PetPlacement, work: Bounds): void {
  assert.ok(value.bounds.x >= work.x); assert.ok(value.bounds.y >= work.y)
  assert.ok(value.bounds.x + value.bounds.width <= work.x + work.width)
  assert.ok(value.bounds.y + value.bounds.height <= work.y + work.height)
  const { panel, side, height } = value.layout
  const top = side === 'above' ? height - panel.offset - panel.maxHeight : panel.offset
  assert.ok(top >= 7.999); assert.ok(top + panel.maxHeight <= height - 7.999)
  for (const rect of [value.layout.body, value.layout.toolbar, value.layout.lamps]) {
    assert.ok(rect.x >= 0); assert.ok(rect.y >= 0)
    assert.ok(rect.x + rect.width <= value.layout.width + 0.001)
    assert.ok(rect.y + rect.height <= height + 0.001)
  }
}
test('靠近工作区顶部在下方展开，靠近底部在上方展开', () => {
  const upper = placePet({ x: 800, y: 60 }, 112, area)
  const lower = placePet({ x: 800, y: 900 }, 112, area)
  assert.equal(upper.layout.side, 'below'); assert.equal(lower.layout.side, 'above')
  inside(upper, area); inside(lower, area)
})
test('中线附近换边保持同一宠物锚点，防止小幅移动反复闪烁', () => {
  const anchor = { x: 800, y: 488 }
  const above = placePet(anchor, 112, area, 'above')
  const below = placePet(anchor, 112, area, 'below')
  assert.equal(above.layout.side, 'above'); assert.equal(below.layout.side, 'below')
  close(bodyAt(above), anchor); close(bodyAt(below), anchor)
  close(above.position, below.position)
  assert.equal(placePet({ x: 800, y: 483 }, 112, area, 'above').layout.side, 'above')
})
test('拖动用宠物的原生桌面锚点，跨方向后不会累加透明窗口的位移', () => {
  const first = placePet({ x: 600, y: 200 }, 112, area)
  const origin = bodyAt(first); const start = { x: 620, y: 240 }
  const moved = dragBounds(origin, start, { x: 620, y: 840 })
  const next = placePet(moved, 112, area, first.layout.side)
  assert.equal(first.layout.side, 'below'); assert.equal(next.layout.side, 'above')
  close(bodyAt(next), { x: 600, y: 800 })
  const later = placePet(dragBounds(origin, start, { x: 620, y: 890 }), 112, area, next.layout.side)
  close(bodyAt(later), { x: 600, y: 850 })
})
test('原位置记录无需迁移，下方布局仍保存原画布坐标', () => {
  const position = { x: -100, y: -200 }
  const anchor = legacyPetAnchor(position, 112)
  const placed = placePet(anchor, 112, area)
  assert.equal(placed.layout.side, 'below')
  close(bodyAt(placed), anchor); close(placed.position, position)
  close(legacyPetAnchor(placed.position, 112), bodyAt(placed))
  close(legacyPetPosition(anchor, 112), position)
})
test('负坐标副屏、屏幕边缘和较小工作区的气泡保持在本屏工作区', () => {
  const negative = { x: -1920, y: -120, width: 1920, height: 1040 }
  inside(placePet({ x: -1910, y: -60 }, 112, negative), negative)
  inside(placePet({ x: 1900, y: 1050 }, 112, area), area)
  const smaller = { x: 0, y: 0, width: 320, height: 360 }
  const placed = placePet({ x: 200, y: 200 }, 144, smaller)
  assert.equal(placed.bounds.width, smaller.width); assert.equal(placed.bounds.height, smaller.height)
  inside(placed, smaller)
})
test('布局重复计算稳定，最大和最小尺寸都保持控件与气泡间隔', () => {
  for (const size of [72, 112, 144]) {
    for (const y of [100, 700]) {
      const placed = placePet({ x: 700, y }, size, area)
      assert.deepEqual(placePet(bodyAt(placed), size, area, placed.layout.side), placed)
      inside(placed, area)
      assert.ok(placed.layout.panel.maxHeight > 0)
    }
  }
  assert.deepEqual(PET_CANVAS, { width: 380, height: 440 })
})
