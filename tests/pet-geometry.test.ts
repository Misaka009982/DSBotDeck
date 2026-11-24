// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { dragBounds, petInteractive, petRegion, petRegions, petToolbarVisible } from '../src/shared/pet-geometry.ts'
test('锁定只穿透主体，控件重叠时优先保留交互', () => {
  const regions = petRegions({ body: { x: 200, y: 300, width: 100, height: 100 }, controls: [{ x: 200, y: 310, width: 20, height: 20 }] })!
  assert.equal(petRegion(regions, { x: 210, y: 320 }), 'controls')
  assert.equal(petRegion(regions, { x: 250, y: 350 }), 'body')
  assert.equal(petInteractive('body', true), false)
  assert.equal(petInteractive('controls', true), true)
  assert.equal(petInteractive('none', false), false)
  assert.equal(petInteractive('body', false), true)
})
test('桌面拖动只使用同一套原生桌面坐标，不缩放 renderer screenX', () => {
  assert.deepEqual(dragBounds({ x: -400, y: 300, width: 380, height: 440 }, { x: -100, y: 640 }, { x: 20, y: 690 }), { x: -280, y: 350, width: 380, height: 440 })
})
test('工具栏仅由主体悬停打开，移向按钮跨过间隙不消失，离开后隐藏', () => {
  const body = { x: 260, y: 300, width: 100, height: 130 }
  const toolbar = { x: 300, y: 265, width: 60, height: 25 }
  assert.equal(petToolbarVisible(body, toolbar, { x: 320, y: 275 }, false), false)
  assert.equal(petToolbarVisible(body, toolbar, { x: 280, y: 330 }, false), true)
  assert.equal(petToolbarVisible(body, toolbar, { x: 320, y: 295 }, true), true)
  assert.equal(petToolbarVisible(body, toolbar, { x: 320, y: 275 }, true), true)
  assert.equal(petToolbarVisible(body, toolbar, { x: 200, y: 275 }, true), false)
  assert.equal(petToolbarVisible(null, toolbar, { x: 320, y: 275 }, true), false)
  assert.equal(petRegion({ body, controls: [] }, { x: 320, y: 275 }), 'none')
})
test('无效或超大命中区域拒绝接收', () => {
  assert.equal(petRegions({ body: null, controls: [{ x: -1, y: 0, width: 1, height: 1 }] }), null)
  assert.equal(petRegions({ body: null, controls: [{ x: 0, y: 0, width: 999999, height: 1 }] }), null)
})
