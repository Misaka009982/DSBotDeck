// SPDX-License-Identifier: Apache-2.0
// 快捷布局纯几何与请求校验，不改变系统分辨率或访问真实窗口。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { windowLayoutRequest, windowLayoutTarget } from '../src/shared/window-layout.ts'
import { SETTINGS_TABS, settingsTabKey } from '../src/shared/settings-model.ts'

test('左右半屏使用所在显示器工作区，奇数宽度不重叠且无缺口', () => {
  const area = { x: -1365, y: 40, width: 1365, height: 728 }
  const current = { x: -1200, y: 80, width: 800, height: 600 }
  const left = windowLayoutTarget({ mode: 'left' }, current, area)
  const right = windowLayoutTarget({ mode: 'right' }, current, area)
  assert.deepEqual(left, { x: -1365, y: 40, width: 682, height: 728 })
  assert.deepEqual(right, { x: -683, y: 40, width: 683, height: 728 })
  assert.equal(left.x + left.width, right.x); assert.equal(right.x + right.width, area.x + area.width)
})
test('自定义为窗口DIP宽高，先保留本体中心，由统一恢复负责工作区限制', () => {
  const current = { x: 200, y: 120, width: 1000, height: 720 }
  assert.deepEqual(windowLayoutTarget({ mode: 'custom', width: 800, height: 600 }, current, { x: 0, y: 0, width: 1920, height: 1040 }), { x: 300, y: 180, width: 800, height: 600 })
  assert.deepEqual(current, { x: 200, y: 120, width: 1000, height: 720 })
})
test('快捷窗口IPC只接受固定方式和有预算的整数，不接受位置路径或显示器命令', () => {
  assert.equal(windowLayoutRequest(null), null)
  assert.deepEqual(windowLayoutRequest({ mode: 'left' }), { mode: 'left' })
  assert.deepEqual(windowLayoutRequest({ mode: 'right' }), { mode: 'right' })
  assert.deepEqual(windowLayoutRequest({ mode: 'custom', width: 1280, height: 720 }), { mode: 'custom', width: 1280, height: 720 })
  for (const input of [{ mode: 'custom', width: '1280', height: 720 }, { mode: 'custom', width: NaN, height: 720 }, { mode: 'custom', width: 100.5, height: 720 }, { mode: 'custom', width: 16001, height: 720 }, { mode: 'custom', width: 800, height: 99 }, { mode: 'left', x: 0 }, { mode: 'left', width: 800 }, { mode: 'display-resolution' }, { mode: 'right', path: 'C:/fixtures' }]) assert.throws(() => windowLayoutRequest(input), /窗口/)
})
test('设置分类固定五类，键盘切换标签而不是滚动到长页面锚点', () => {
  assert.deepEqual(SETTINGS_TABS.map(tab => tab.id), ['window', 'theme', 'icon', 'background', 'pet'])
  assert.equal(settingsTabKey('window', 'ArrowRight'), 'theme')
  assert.equal(settingsTabKey('window', 'ArrowLeft'), 'pet')
  assert.equal(settingsTabKey('background', 'Home'), 'window')
  assert.equal(settingsTabKey('theme', 'End'), 'pet')
  assert.equal(settingsTabKey('theme', 'Enter'), null)
})
