// SPDX-License-Identifier: Apache-2.0
// 使用真实页面生命周期，只替换 Electron 窗口边界；本机不运行。
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import type { IpcMainEvent } from 'electron'
import type { ContentViews } from '../src/main/content-views.ts'
import type { ClientProtocol } from '../src/main/protocol.ts'
import { readReceiptKey } from '../src/main/protocol.ts'
import { RequestGate } from '../src/main/request-gate.ts'
import { command, record, validEntityId } from '../src/shared/validation.ts'
const source = stripTypeScriptTypes(await readFile(new URL('../src/main/content-views.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '').replace('export class ContentViews', 'class ContentViews')
class Contents extends EventEmitter {
  mainFrame = {}; closed = false; url = ''; sent: { channel: string; value: any }[] = []
  isDestroyed() { return this.closed }
  close() { this.closed = true }
  setZoomFactor() {}
  setWindowOpenHandler() {}
  focus() {}
  async loadURL(url: string) { this.url = url }
  send(channel: string, value: unknown) { this.sent.push({ channel, value }) }
}
function fixture() {
  const all: View[] = []; const handlers = new Map<string, ClientProtocol>()
  class View {
    webContents = new Contents(); visible = false
    constructor() { all.push(this) }
    setVisible(value: boolean) { this.visible = value }
    setBounds() {}
    setBackgroundColor() {}
  }
  class Window extends EventEmitter {
    visible = true; minimized = false
    isDestroyed() { return false }
    isFocused() { return true }
    isVisible() { return this.visible }
    isMinimized() { return this.minimized }
    contentView = { addChildView() {}, removeChildView() {} }
    getContentBounds() { return { width: 1000, height: 700 } }
  }
  const window = new Window()
  let current = 'server-a'; let sequence = 0
  const selected = new Map<string, { serverId: string; kind: string; id: string }>()
  const acknowledged: unknown[] = []
  const manager = {
    activeServer: () => current, setNavigation() {},
    currentSelection: () => selected.get(current) ?? null,
    noteSelection: (serverId: string, value: { kind: string; id: string }) => selected.set(serverId, { serverId, ...value }),
    connection: (id: string) => ({
      view: () => ({ mode: 'phone', cached: false, state: 'ready', alias: id, error: null, lastSyncAt: 1 }),
      valid: () => true, acknowledge: (...args: unknown[]) => acknowledged.push({ id, args }),
    }),
    appearanceSettings: () => ({ language: 'system', theme: 'deepseek', themeMode: 'system' }),
  }
  const session = { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    protocol: { handle: (_scheme: string, options: ClientProtocol) => handlers.set(options.host, options), unhandle() {} } }) }
  const ViewManager = runInNewContext(`${source}\nContentViews`, {
    WebContentsView: View, randomUUID: () => `view-${++sequence}`, session, shell: { openExternal: async () => {} },
    path, command, record, validEntityId, readReceiptKey, SCHEME: 'dsbotdeck', clientHandler: (options: ClientProtocol) => options,
  }) as new (...args: unknown[]) => ContentViews
  const views = new ViewManager(window, manager, 'fixture-dist', new RequestGate(), () => {})
  const event = (view: View) => ({ sender: view.webContents, senderFrame: view.webContents.mainFrame }) as unknown as IpcMainEvent
  const select = (id: string) => { current = id; views.sync() }
  const ready = (view: View) => views.ready(event(view))
  const status = (view: View) => view.webContents.sent.filter(item => item.channel === 'deck:content-status').at(-1)?.value
  return { views, all, handlers, window, event, select, ready, status, acknowledged }
}
test('切换三台服务器保留各自页面和实例，切回不重建也不沿用旧导航上下文', t => {
  const f = fixture(); t.after(() => f.views.close())
  f.select('server-a'); const a = f.all[0]; f.ready(a)
  assert.equal(f.status(a).active, true)
  const firstEpoch = f.status(a).viewEpoch
  const original = f.handlers.get('server-a'); assert.ok(original)
  const context = original.context(); const instance = original.instance()
  assert.equal(context(), true)
  f.select('server-b'); f.ready(f.all[1])
  assert.equal(f.status(a).active, false); assert.equal(a.visible, false); assert.equal(context(), false)
  f.select('server-c'); f.ready(f.all[2])
  assert.equal(f.all.length, 3); assert.equal(f.status(f.all[2]).active, true)
  assert.equal(f.all.some(view => view.webContents.closed), false)
  f.select('server-a')
  assert.equal(f.all.length, 3); assert.equal(a.visible, true); assert.equal(original.instance(), instance)
  assert.equal(f.status(a).active, true); assert.ok(f.status(a).viewEpoch > firstEpoch)
  assert.equal(context(), false); assert.equal(original.context()(), true)
  assert.equal(f.status(f.all[2]).active, false)
  f.views.remove('server-b'); assert.equal(f.all[1].webContents.closed, true); assert.equal(a.webContents.closed, false)
})
test('最小化、隐藏和本机浮层通知暂停，恢复后仍是原页面；后台不能确认已读', t => {
  const f = fixture(); t.after(() => f.views.close())
  f.select('server-a'); const a = f.all[0]; f.ready(a)
  f.views.selected(f.event(a), { kind: 'bot', id: 'bot-a' })
  const options = f.handlers.get('server-a'); assert.ok(options)
  const instance = options.instance(); assert.ok(instance)
  options.read({ key: 'bot:bot-a', kind: 'bot', id: 'bot-a', pending: 'pending-a', token: {} as never }, instance)
  f.views.setOverlay(true); assert.equal(f.status(a).active, false); assert.equal(a.visible, false)
  f.views.viewed(f.event(a), { kind: 'bot', id: 'bot-a' }); assert.equal(f.acknowledged.length, 0)
  f.views.setOverlay(false); assert.equal(f.status(a).active, true)
  f.window.minimized = true; f.window.emit('minimize')
  assert.equal(f.status(a).active, false); assert.equal(a.visible, false)
  f.window.minimized = false; f.window.emit('restore')
  assert.equal(f.status(a).active, true); assert.equal(a.visible, true)
  f.window.visible = false; f.window.emit('hide'); assert.equal(f.status(a).active, false)
  f.window.visible = true; f.views.sync(); assert.equal(f.status(a).active, true)
  assert.equal(f.all.length, 1); assert.equal(a.webContents.closed, false)
  f.views.viewed(f.event(a), { kind: 'bot', id: 'bot-a' }); assert.equal(f.acknowledged.length, 1)
})
