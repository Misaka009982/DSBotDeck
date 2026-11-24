// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PET_HIDE_DELAY_MS, PetHover } from '../src/shared/pet-hover.ts'
test('主体悬停不打开面板，只有灯打开', () => {
  const hover = new PetHover(); hover.pointer(null, false, 0)
  assert.equal(hover.color(), null)
  hover.pointer('yellow', false, 1); assert.equal(hover.color(), 'yellow')
})
test('离开两者十秒关闭，重复移开不延长期限', () => {
  const hover = new PetHover(); hover.pointer('green', false, 0)
  hover.pointer(null, false, 10); hover.pointer(null, false, 100)
  assert.equal(hover.closeAt(), 10 + PET_HIDE_DELAY_MS)
  assert.equal(hover.expire(10009), false); assert.equal(hover.expire(10010), true)
})
test('进入气泡取消关闭，重返灯可以切色', () => {
  const hover = new PetHover(); hover.pointer('red', false, 0)
  hover.pointer(null, false, 1); hover.pointer(null, true, 9000)
  assert.equal(hover.closeAt(), null); assert.equal(hover.expire(20000), false)
  hover.pointer('blue', false, 20001); assert.equal(hover.color(), 'blue')
})
