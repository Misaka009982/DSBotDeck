// SPDX-License-Identifier: Apache-2.0
// 界面边界静态契约；不启动 Electron 或访问真实服务器。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
const source = (name: string) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')
test('Deck 设置独立于服务器，整栏折叠仍有展开入口和视口重测', async () => {
  const shell = await source('renderer/app.js')
  assert.ok(shell.includes('dsbotdeck.sidebar-rail')); assert.ok(shell.includes('展开侧栏'))
  assert.ok(shell.includes('Deck 设置')); assert.ok(shell.includes('h(DeckSettings,'))
  assert.ok(shell.includes('ResizeObserver')); assert.ok(shell.includes('api.viewport('))
  assert.ok(shell.includes('settingsCommand(entity)'))
  assert.ok(shell.includes("button('服务器设置'"))
})
test('Bot 顶部名称调用原参数页，本机背景只透明底层不加载远程素材', async () => {
  const remote = await source('remote/app.js')
  assert.ok(remote.includes('actions.openSettings(settings.page, settings.id)'))
  assert.ok(remote.includes('actions: headerActions'))
  assert.ok(remote.includes('status.localBackground'))
  const views = await source('main/content-views.ts')
  assert.ok(views.includes("view.setBackgroundColor('#00000000')"))
  assert.ok(views.includes('localBackground: this.localBackground()'))
})
test('本机界面语言传到原词典与隔离视图，不写服务器设置', async () => {
  const remote = await source('remote/app.js'); const locale = await source('renderer/deck-locale.js')
  assert.ok(remote.includes("useDeckLocale(status.uiLanguage ?? 'zh')"))
  assert.ok(locale.includes('installLocale(createLocale(tag))'))
  assert.ok(locale.includes('useLayoutEffect')); assert.equal(locale.includes('set-prefs'), false)
  const views = await source('main/content-views.ts')
  assert.ok(views.includes('uiLanguage: this.manager.appearanceSettings().language'))
})
test('宠物设置集中 Deck，灯和快捷入口透明，原命中/十秒规则不变', async () => {
  const pet = await source('renderer/pet.js'); const css = await source('renderer/pet.css')
  assert.ok(pet.includes('h(PetSprite,')); assert.ok(pet.includes('api.settings'))
  assert.equal(pet.includes('api.prefs'), false)
  assert.ok(pet.includes('api.dragStart')); assert.ok(pet.includes('hover.pointer'))
  assert.ok(css.includes('.deck-pet-tools,.deck-pet-lamps{background:transparent;border:0;box-shadow:none}'))
})
