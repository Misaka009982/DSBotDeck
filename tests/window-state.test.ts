// SPDX-License-Identifier: Apache-2.0
// 使用窗口事件替身验证保存时序，不启动 Electron 或接触用户配置。
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { Bounds, WindowState } from '../src/shared/domain.ts'
import { restoreWindowBounds, WindowStateTracker } from '../src/main/window-state.ts'

class FixtureWindow extends EventEmitter {
  rectangle: Bounds = { x: 100, y: 120, width: 1100, height: 720 }
  normal: Bounds = { ...this.rectangle }
  minimized = false
  maximized = false
  fullScreen = false
  destroyed = false
  isDestroyed() { return this.destroyed }
  isMinimized() { return this.minimized }
  isMaximized() { return this.maximized }
  isFullScreen() { return this.fullScreen }
  getBounds() { return { ...this.rectangle } }
  getNormalBounds() { return { ...this.normal } }
}
test('移动缩放后立即最小化，延迟保存仍保留最后的有效位置大小', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) })
  try {
    window.rectangle = { x: -1400, y: 60, width: 1200, height: 800 }
    window.emit('move'); window.emit('resize')
    window.minimized = true; window.rectangle = { x: -32000, y: -32000, width: 160, height: 28 }
    window.emit('resize')
    await tracker.flush()
    assert.deepEqual(saved, [{ x: -1400, y: 60, width: 1200, height: 800, maximized: false }])
  } finally { tracker.dispose() }
})
test('最大化保留还原矩形，最小化退出不丢失最大化标记，取消最大化可更新', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) })
  try {
    window.maximized = true; window.rectangle = { x: 0, y: 0, width: 1920, height: 1040 }
    window.emit('maximize'); window.minimized = true
    await tracker.flush()
    assert.deepEqual(saved[0], { ...window.normal, maximized: true })
    window.minimized = false; window.maximized = false; window.rectangle = { ...window.normal, x: 240 }
    window.emit('unmaximize'); await tracker.flush()
    assert.deepEqual(saved[1], { ...window.rectangle, maximized: false })
  } finally { tracker.dispose() }
})
test('退出刷新等待持久化，后续窗口事件与销毁不污染已捕获值', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const tracker = new WindowStateTracker(window, async state => { await blocked; saved.push(state) })
  try {
    const pending = tracker.flush(); tracker.dispose()
    let finished = false
    void pending.then(() => { finished = true })
    await Promise.resolve(); assert.equal(finished, false)
    window.destroyed = true; window.rectangle = { x: 0, y: 0, width: 1, height: 1 }; window.emit('resize')
    release(); await pending
    assert.deepEqual(saved, [{ x: 100, y: 120, width: 1100, height: 720, maximized: false }])
    assert.equal(window.listenerCount('resize'), 0)
  } finally { release(); tracker.dispose() }
})
test('全屏临时尺寸不覆盖普通布局，保存失败后可以重试', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []; let fail = true
  const tracker = new WindowStateTracker(window, async state => { if (fail) throw new Error('fixture-write-failed'); saved.push(state) })
  try {
    window.fullScreen = true; window.rectangle = { x: 0, y: 0, width: 1920, height: 1080 }; window.emit('resize')
    await assert.rejects(tracker.flush(), /fixture-write-failed/)
    fail = false; await tracker.flush()
    assert.deepEqual(saved, [{ x: 100, y: 120, width: 1100, height: 720, maximized: false }])
  } finally { tracker.dispose() }
})
test('贴靠保存当前矩形，不退回贴靠前的普通尺寸', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) })
  try {
    window.rectangle = { x: 960, y: 0, width: 960, height: 1040 }; window.emit('resize')
    await tracker.flush()
    assert.deepEqual(saved[0], { ...window.rectangle, maximized: false })
  } finally { tracker.dispose() }
})
test('恢复窗口保留负坐标屏幕，断开屏幕或缩小工作区后移回可见范围', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 }
  const saved = { x: -1800, y: 80, width: 1200, height: 800 }
  assert.deepEqual(restoreWindowBounds(saved, left), saved)
  assert.deepEqual(restoreWindowBounds(saved, { x: 0, y: 0, width: 1366, height: 768 }), { x: 0, y: 0, width: 1200, height: 768 })
  assert.deepEqual(restoreWindowBounds(null, { x: 0, y: 0, width: 800, height: 600 }), { x: 0, y: 0, width: 800, height: 600 })
  assert.deepEqual(restoreWindowBounds(null, left), { x: -1600, y: 70, width: 1280, height: 900 })
})
