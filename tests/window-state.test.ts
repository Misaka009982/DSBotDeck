// SPDX-License-Identifier: Apache-2.0
// 使用窗口事件替身验证保存时序，不启动 Electron 或接触用户配置。
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { Bounds, WindowState } from '../src/shared/domain.ts'
import { minimumWindowSize, restoreWindowBounds, restoreWindowLayout, WindowStateTracker } from '../src/main/window-state.ts'
import type { WindowDiagnosticRecord, WindowSaveReason } from '../src/main/window-diagnostics.ts'

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
function userResize(window: FixtureWindow, tracker: WindowStateTracker, rectangle: Bounds): void {
  tracker.beginUserResize(rectangle)
  window.rectangle = { ...rectangle }; window.normal = { ...rectangle }; window.emit('resize')
  tracker.finishUserResize()
}
test('用户拖拽实时更新尺寸，停下后的程序resize与移动只记录位置', async () => {
  const window = new FixtureWindow(); const original = { ...window.rectangle, maximized: false }
  const saved: WindowState[] = []; const changes: number[] = []
  const tracker: WindowStateTracker = new WindowStateTracker(window, async state => { saved.push(state) }, undefined, original, undefined, { onSize: () => { changes.push(tracker.userSizeRevision()) } })
  try {
    const resized = { x: 120, y: 150, width: 1280, height: 800 }
    tracker.beginUserResize(resized)
    assert.deepEqual(tracker.userSize(), { width: 1280, height: 800 }); assert.equal(changes.length, 1)
    window.rectangle = resized; window.emit('resize'); tracker.finishUserResize()
    const revision = tracker.userSizeRevision()
    window.rectangle = { ...resized, x: 220, y: 180, width: 1282, height: 801 }
    window.emit('resize'); window.emit('move'); await tracker.flush('before-quit')
    assert.deepEqual(saved, [{ x: 220, y: 180, width: 1280, height: 800, maximized: false }])
    assert.equal(tracker.userSizeRevision(), revision)
  } finally { tracker.dispose() }
})
test('恢复读回尺寸更大时保留用户尺寸，普通关闭和show后事件不重写宽高', async () => {
  const window = new FixtureWindow(); const user = { x: 100, y: 120, width: 1100, height: 720, maximized: false }
  window.rectangle = { ...user, width: 1102, height: 721 }
  const saved: WindowState[] = []
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) }, undefined, user)
  try {
    window.emit('resize'); window.emit('move'); await tracker.flush('close'); await tracker.flush('before-quit')
    assert.deepEqual(tracker.userSize(), { width: 1100, height: 720 }); assert.deepEqual(saved, [])
  } finally { tracker.dispose() }
})
test('窗口设置更新用户尺寸后，后续原生误差和退出不能覆盖这次设定', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) })
  try {
    tracker.setUserBounds({ x: 400, y: 20, width: 800, height: 600 })
    window.rectangle = { x: 400, y: 20, width: 802, height: 601 }; window.emit('resize')
    await tracker.flush('window-layout')
    assert.deepEqual(saved, [{ x: 400, y: 20, width: 800, height: 600, maximized: false }])
    await tracker.flush('before-quit'); assert.equal(saved.length, 1)
  } finally { tracker.dispose() }
})
test('没有保存值时使用创建默认尺寸，不把启动外框偏差作为用户设定', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  window.rectangle = { x: 300, y: 70, width: 1282, height: 901 }
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) }, undefined, null, undefined, { initialSize: { width: 1280, height: 900 } })
  try { await tracker.flush(); assert.deepEqual(saved, [{ x: 300, y: 70, width: 1280, height: 900, maximized: false }]) }
  finally { tracker.dispose() }
})
test('移动缩放后立即最小化，延迟保存仍保留最后的有效位置大小', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) })
  try {
    userResize(window, tracker, { x: -1400, y: 60, width: 1200, height: 800 })
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
    userResize(window, tracker, { x: 960, y: 0, width: 960, height: 1040 }); window.emit('resize')
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
    userResize(window, tracker, { ...window.rectangle, width: 1200 })
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
    userResize(window, tracker, { ...original, width: 1200 })
    const changed = { ...window.rectangle, maximized: false }; const first = tracker.flush()
    userResize(window, tracker, original)
    const second = tracker.flush()
    release(); await Promise.all([first, second]); await tracker.flush()
    assert.deepEqual(saved, [changed, initial])
  } finally { release(); tracker.dispose() }
})
test('恢复观测覆盖每个原生修改边界，诊断不会改变恢复顺序', () => {
  const window = new FixtureWindow(); const reports: WindowDiagnosticRecord[] = []
  const saved = { x: 180, y: 100, width: 720, height: 540, maximized: true }
  restoreWindowLayout(window, saved, { x: 0, y: 0, width: 1920, height: 1040 }, entry => { reports.push(entry) })
  assert.deepEqual(reports.map(entry => entry.event), ['restore-start', 'restore-minimum', 'restore-bounds', 'restore-maximize', 'restore-complete'])
  assert.deepEqual(reports.find(entry => entry.event === 'restore-bounds')?.target, { x: 180, y: 100, width: 720, height: 540 })
  assert.deepEqual(reports[0].minimum, { width: 480, height: 320 })
  assert.deepEqual(window.restoration, ['minimum', 'bounds', 'maximize'])
})
test('记录resize与退出保存原因，明确区分队列写入和同布局跳过', async () => {
  const window = new FixtureWindow(); const reports: WindowDiagnosticRecord[] = []; const reasons: WindowSaveReason[] = []
  const initial = { ...window.rectangle, maximized: false }
  const tracker = new WindowStateTracker(window, async (_state, reason) => { reasons.push(reason) }, undefined, initial, entry => { reports.push(entry) })
  try {
    userResize(window, tracker, { ...window.rectangle, width: 1200 }); window.emit('resize')
    await tracker.flush('before-quit'); await tracker.flush('close')
    assert.deepEqual(reasons, ['before-quit'])
    const written = reports.find(entry => entry.event === 'tracker-write-success')
    assert.equal(written?.reason, 'before-quit'); assert.equal(written?.lastEvent, 'resize')
    assert.deepEqual(written?.captured, { ...window.rectangle, maximized: false })
    assert.ok(reports.some(entry => entry.event === 'tracker-write-skipped' && entry.reason === 'close'))
  } finally { tracker.dispose() }
})
test('观测器抛错仍能保存窗口与释放事件监听', async () => {
  const window = new FixtureWindow(); const saved: WindowState[] = []
  const trace = () => { throw new Error('虚构观测故障') }
  restoreWindowLayout(window, null, { x: 0, y: 0, width: 1920, height: 1040 }, trace)
  const tracker = new WindowStateTracker(window, async state => { saved.push(state) }, undefined, null, trace)
  try { await tracker.flush(); assert.equal(saved.length, 1) }
  finally { tracker.dispose() }
  assert.equal(window.listenerCount('resize'), 0)
})
test('排队后窗口继续变化，日志仍对应原请求的尺寸和触发事件', async () => {
  const window = new FixtureWindow(); const reports: WindowDiagnosticRecord[] = []
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const tracker = new WindowStateTracker(window, async () => { await blocked }, undefined, null, entry => { reports.push(entry) })
  try {
    userResize(window, tracker, { ...window.rectangle, width: 1200 }); window.emit('resize')
    const first = tracker.flush('close')
    userResize(window, tracker, { ...window.rectangle, width: 1300 }); window.emit('move')
    const second = tracker.flush('before-quit')
    release(); await Promise.all([first, second])
    const written = reports.filter(entry => entry.event === 'tracker-write-success')
    assert.deepEqual(written.map(entry => [entry.reason, entry.lastEvent, entry.captured?.width]), [['close', 'resize', 1200], ['before-quit', 'move', 1300]])
    assert.deepEqual(written.map(entry => entry.persisted?.width), [1200, 1300])
  } finally { release(); tracker.dispose() }
})

class NativeFixtureWindow extends FixtureWindow {
  transform: (rectangle: Bounds) => Bounds
  constructor(transform: (rectangle: Bounds) => Bounds) { super(); this.transform = transform }
  override setBounds(rectangle: Bounds, animate: boolean) { super.setBounds(this.transform({ ...rectangle }), animate) }
}
test('实机日志中的坐标相关1至2DIP边框偏差，连续重开不再进入保存反馈', async () => {
  const area = { x: 0, y: 0, width: 2752, height: 1152 }
  for (const maximized of [false, true]) {
    let previous: WindowState = { x: 1376, y: 0, width: 1376, height: 1152, maximized }
    const original = { ...previous }; const saved: WindowState[] = []
    for (let cycle = 0; cycle < 12; cycle++) {
      // 模拟日志已证实的API非对称，不声称复制Windows内部的边框换算实现。
      const window = new NativeFixtureWindow(rectangle => ({ ...rectangle, width: rectangle.width + (rectangle.x % 4 === 2 ? 1 : 2), height: rectangle.height + 1 }))
      restoreWindowLayout(window, previous, area)
      const tracker = new WindowStateTracker(window, async state => { saved.push(state); previous = state }, undefined, previous)
      try {
        window.emit('move'); await tracker.flush('close'); await tracker.flush('before-quit')
        assert.deepEqual({ ...(maximized ? window.normal : window.rectangle), maximized }, original)
        assert.deepEqual(previous, original)
      } finally { tracker.dispose() }
    }
    assert.deepEqual(saved, [])
  }
})
test('恢复以当前测得的坐标和边框差值校准，不固定扣两个像素', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 }
  const target = { x: -1700, y: 80, width: 720, height: 540, maximized: false }
  for (const [x, y, width, height] of [[0, 0, 0, 0], [1, 0, 1, 1], [-1, 2, 8, 6]]) {
    const window = new NativeFixtureWindow(rectangle => ({ x: rectangle.x + x, y: rectangle.y + y, width: rectangle.width + width, height: rectangle.height + height }))
    restoreWindowLayout(window, target, area)
    assert.deepEqual(window.rectangle, { x: target.x, y: target.y, width: target.width, height: target.height })
    assert.ok(window.restoration.filter(event => event === 'bounds').length <= 5)
  }
})
test('原生最小外框暂不可达到时保留最接近值，后续重开不继续增长', async () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  let previous: WindowState = { x: 100, y: 120, width: 480, height: 320, maximized: false }
  const saved: WindowState[] = []
  for (let cycle = 0; cycle < 12; cycle++) {
    const window: NativeFixtureWindow = new NativeFixtureWindow(rectangle => ({ ...rectangle, width: Math.max(window.minimum.width, rectangle.width) + 2, height: Math.max(window.minimum.height, rectangle.height) + 1 }))
    restoreWindowLayout(window, previous, area)
    assert.ok(window.restoration.filter(event => event === 'bounds').length <= 5)
    const tracker = new WindowStateTracker(window, async state => { previous = state; saved.push(state) }, undefined, previous)
    try { window.emit('move'); await tracker.flush('before-quit') }
    finally { tracker.dispose() }
    assert.deepEqual(window.rectangle, { x: 100, y: 120, width: 482, height: 321 })
    assert.deepEqual(previous, { x: 100, y: 120, width: 480, height: 320, maximized: false })
  }
  assert.equal(saved.length, 0)
})
test('不可精确表示的尺寸有有限校准，等距时不选择更大的外框', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const window = new NativeFixtureWindow(rectangle => ({ ...rectangle, width: Math.ceil(rectangle.width / 2) * 2 }))
  const target = { x: 100, y: 120, width: 721, height: 540, maximized: false }
  const reports: WindowDiagnosticRecord[] = []
  restoreWindowLayout(window, target, area, entry => { reports.push(entry) })
  assert.equal(window.rectangle.width, 720)
  assert.ok(window.restoration.filter(event => event === 'bounds').length <= 5)
  assert.ok(reports.some(entry => entry.event === 'restore-unmatched'))
})
test('校准请求和目标分开记录，恢复完成后才最大化且不修改原保存对象', () => {
  const target = { x: 100, y: 120, width: 720, height: 540, maximized: true }
  const original = { ...target }; const reports: WindowDiagnosticRecord[] = []
  const window = new NativeFixtureWindow(rectangle => ({ ...rectangle, width: rectangle.width + 2, height: rectangle.height + 1 }))
  restoreWindowLayout(window, target, { x: 0, y: 0, width: 1920, height: 1040 }, entry => { reports.push(entry) })
  const correction = reports.find(entry => entry.event === 'restore-correction')
  assert.deepEqual(correction?.target, { x: 100, y: 120, width: 720, height: 540 })
  assert.deepEqual(correction?.requested, { x: 100, y: 120, width: 718, height: 539 })
  assert.equal(correction?.attempt, 2)
  assert.deepEqual(window.normal, { x: 100, y: 120, width: 720, height: 540 })
  assert.equal(window.restoration.at(-1), 'maximize'); assert.deepEqual(target, original)
})
