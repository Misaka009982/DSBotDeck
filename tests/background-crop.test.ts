// SPDX-License-Identifier: Apache-2.0
// 仅验证图片选区几何，不加载图片、不启动界面或改写用户素材。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { backgroundCropRect, backgroundPlacement, moveBackgroundCrop, resizeBackgroundCrop } from '../src/shared/background-crop.ts'
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} ≈ ${expected}`)
test('横竖图片的选区始终匹配当前窗口比例且不越过原图', () => {
  for (const image of [{ width: 2400, height: 1600 }, { width: 900, height: 1800 }]) {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 683, height: 728 }, { width: 2560, height: 1080 }]) {
      for (const zoom of [1, 2.5, 8]) {
        const rect = backgroundCropRect(image, viewport, { cx: 1, cy: 0, zoom })!
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001)
        near(rect.width * image.width / (rect.height * image.height), viewport.width / viewport.height)
        const placement = backgroundPlacement(viewport, rect)
        near(placement.x + rect.x * placement.width, 0)
        near(placement.y + rect.y * placement.height, 0)
        near(placement.width / image.width, placement.height / image.height)
        near(placement.width * rect.width, viewport.width)
        near(placement.height * rect.height, viewport.height)
      }
    }
  }
})
test('拖动限于图片内，缩放保持左上角与比例并限制最大放大倍数', () => {
  const image = { width: 2000, height: 1000 }; const viewport = { width: 1000, height: 500 }
  const rect = backgroundCropRect(image, viewport, { cx: 0.5, cy: 0.5, zoom: 2 })!
  assert.deepEqual(moveBackgroundCrop(rect, 2, 10, -10), { cx: 0.75, cy: 0.25, zoom: 2 })
  const smaller = resizeBackgroundCrop(image, viewport, rect, -0.125, -0.125)
  const resized = backgroundCropRect(image, viewport, smaller)!
  near(resized.x, rect.x); near(resized.y, rect.y); near(resized.width, 0.375)
  const largest = backgroundCropRect(image, viewport, resizeBackgroundCrop(image, viewport, rect, 10, 10))!
  near(largest.x, rect.x); near(largest.y, rect.y); near(largest.x + largest.width, 1)
  const smallest = resizeBackgroundCrop(image, viewport, rect, -10, -10)
  near(smallest.zoom, 8)
})
test('窗口改变比例后保留选区中心及缩放，不修改保存值', () => {
  const image = { width: 2400, height: 1600 }; const crop = { cx: 0.6, cy: 0.4, zoom: 3 }
  for (const viewport of [{ width: 1400, height: 900 }, { width: 700, height: 900 }]) {
    const rect = backgroundCropRect(image, viewport, crop)!
    near(rect.x + rect.width / 2, crop.cx); near(rect.y + rect.height / 2, crop.cy)
    near(rect.width * image.width / (rect.height * image.height), viewport.width / viewport.height)
  }
  assert.deepEqual(crop, { cx: 0.6, cy: 0.4, zoom: 3 })
})
test('图片或窗口尺寸尚未就绪时不产生无效的背景尺寸', () => {
  assert.equal(backgroundCropRect({ width: 0, height: 10 }, { width: 100, height: 100 }, null), null)
  assert.equal(backgroundCropRect({ width: 100, height: 100 }, { width: NaN, height: 100 }, null), null)
  assert.deepEqual(backgroundCropRect({ width: 100, height: 100 }, { width: 100, height: 100 }, null), { x: 0, y: 0, width: 1, height: 1 })
})
