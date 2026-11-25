// SPDX-License-Identifier: Apache-2.0
// 使用窗口事件替身验证保存时序，不启动 Electron 或接触用户配置。
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { Bounds, WindowState } from '../src/shared/domain.ts'
import { minimumWindowSize, restoreWindowBounds, restoreWindowLayout, WindowStateTracker } from '../src/main/window-state.ts'

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
  minimum = { width: 0, height: 0 }
  restoration: string[] = []
  setMinimumSize(width: number, height: number) { this.minimum = { width, height }; this.restoration.push('minimum') }
  setBounds(rectangle: Bounds, _animate: boolean) { this.rectangle = { ...rectangle }; this.normal = { ...rectangle }; this.restoration.push('bounds') }
  maximize() { this.normal = { ...this.rectangle }; this.maximized = true; this.rectangle = { x: 0, y: 0, width: 1920, height: 1040 }; this.restoration.push('maximize') }
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
    await tracker.flush()
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
test('半屏贴靠小于原960宽度时不扩张，缩放后的屏幕使用同一最小尺寸', () => {
  for (const area of [
    { x: 0, y: 0, width: 1366, height: 728 },
    { x: -1536, y: 0, width: 1536, height: 824 },
    { x: 0, y: 0, width: 854, height: 440 },
  ]) {
    const half = Math.floor(area.width / 2)
    const right = { x: area.x + area.width - half, y: area.y, width: half, height: area.height }
    assert.deepEqual(restoreWindowBounds(right, area), right)
    assert.ok(minimumWindowSize(area).width <= half)
    const corner = { ...right, y: area.y + area.height / 2, height: area.height / 2 }
    assert.deepEqual(restoreWindowBounds(corner, area), corner)
  }
})
test('恢复窗口保留负坐标屏幕，断开屏幕或缩小工作区后移回可见范围', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 }
  const saved = { x: -1800, y: 80, width: 1200, height: 800 }
  assert.deepEqual(restoreWindowBounds(saved, left), saved)
  assert.deepEqual(restoreWindowBounds(saved, { x: 0, y: 0, width: 1366, height: 768 }), { x: 0, y: 0, width: 1200, height: 768 })
  assert.deepEqual(restoreWindowBounds(null, { x: 0, y: 0, width: 800, height: 600 }), { x: 0, y: 0, width: 800, height: 600 })
  assert.deepEqual(restoreWindowBounds(null, left), { x: -1600, y: 70, width: 1280, height: 900 })
})
test('创建完成后先恢复矩形再最大化，销毁窗口不再恢复', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const saved = { x: 180, y: 100, width: 720, height: 540, maximized: true }
  const window = new FixtureWindow()
  restoreWindowLayout(window, saved, area)
  assert.deepEqual(window.restoration, ['minimum', 'bounds', 'maximize'])
  assert.deepEqual(window.normal, { x: 180, y: 100, width: 720, height: 540 })
  assert.deepEqual(window.minimum, { width: 480, height: 320 })
  const closed = new FixtureWindow(); closed.destroyed = true
  restoreWindowLayout(closed, saved, area)
  assert.deepEqual(closed.restoration, [])
})
test('多轮默认创建再恢复不累计临时尺寸，单轮不重复写入并识别已存布局', async () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  for (const maximized of [false, true]) {
    for (const hasPersistedState of [false, true]) {
      let previous: WindowState = { x: 180, y: 100, width: 720, height: 540, maximized }
      const original = { ...previous }; const saved: WindowState[] = []
      for (let cycle = 0; cycle < 12; cycle++) {
        const window = new FixtureWindow()
        // 替身模拟构造阶段的临时尺寸，不声称已复现 Windows 的实际边框误差。
        window.rectangle = { x: 300, y: 70, width: 1296, height: 936 }
        restoreWindowLayout(window, previous, area)
        const tracker = new WindowStateTracker(window, async state => { saved.push(state) }, undefined, hasPersistedState ? previous : null)
        try {
          await tracker.flush(); await tracker.flush()
          const rectangle = maximized ? window.getNormalBounds() : window.getBounds()
          assert.deepEqual({ ...rectangle, maximized }, original)
          previous = saved.at(-1) ?? previous
          assert.deepEqual(previous, original)
        } finally { tracker.dispose() }
      }
      assert.deepEqual(saved, hasPersistedState ? [] : Array.from({ length: 12 }, () => ({ ...original })))
    }
  }
})
test('同一布局的排队刷新只保存一次，成功后才记录已保存状态', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const initial = { ...window.rectangle, maximized: false }
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const tracker = new WindowStateTracker(window, async state => { await blocked; saved.push(state) }, undefined, initial)
  try {
    await tracker.flush(); assert.equal(saved.length, 0)
    window.rectangle = { ...window.rectangle, width: 1200 }
    const first = tracker.flush(); const second = tracker.flush()
    release(); await Promise.all([first, second]); await tracker.flush()
    assert.deepEqual(saved, [{ ...window.rectangle, maximized: false }])
  } finally { release(); tracker.dispose() }
})
test('排队写入后又回到原布局，不能因旧保存值相同而漏掉恢复', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const original = { ...window.rectangle }; const initial = { ...original, maximized: false }
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const tracker = new WindowStateTracker(window, async state => { await blocked; saved.push(state) }, undefined, initial)
  try {
    window.rectangle = { ...original, width: 1200 }
    const changed = { ...window.rectangle, maximized: false }; const first = tracker.flush()
    window.rectangle = original
    const second = tracker.flush()
    release(); await Promise.all([first, second]); await tracker.flush()
    assert.deepEqual(saved, [changed, initial])
  } finally { release(); tracker.dispose() }
})
