// SPDX-License-Identifier: Apache-2.0
// 使用替身和临时目录，不修改真实 Windows 快捷方式。
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { sameWindowsPath, syncStartMenuIcon, updateShortcutIcon } from '../src/main/shortcut-icon.ts'
import type { ShortcutPort } from '../src/main/shortcut-icon.ts'
const executable = 'C:\\Apps\\DSBotDeck\\DSBotDeck.exe'
const icon = 'C:\\Data\\DSBotDeck\\appearance\\deck-new.ico'
test('只更新本程序的开始菜单图标，不改变目标、参数或创建快捷方式', () => {
  const writes: unknown[] = []
  const port: ShortcutPort = {
    readShortcutLink: () => ({ target: 'c:/apps/DSBotDeck/DSBotDeck.exe', appUserModelId: 'io.dsbotdeck.desktop', icon: executable, iconIndex: 0 }),
    writeShortcutLink: (...args) => { writes.push(args); return true },
  }
  assert.equal(updateShortcutIcon('fixture.lnk', executable, icon, port), 'updated')
  assert.deepEqual(writes, [['fixture.lnk', 'update', { icon, iconIndex: 0 }]])
  assert.equal(sameWindowsPath('DSBotDeck.exe', executable), false)
})
test('同名他程序、不同安装位置及已同步图标不被覆盖', () => {
  for (const shortcut of [
    {},
    { target: 'C:\\Other\\DSBotDeck.exe' },
    { target: executable, appUserModelId: 'another.app' },
    { target: executable, icon, iconIndex: 0 },
  ]) {
    const port: ShortcutPort = { readShortcutLink: () => shortcut, writeShortcutLink: () => { throw new Error('不能写入') } }
    assert.equal(updateShortcutIcon('fixture.lnk', executable, icon, port), 'skipped')
  }
  assert.throws(() => updateShortcutIcon('fixture.lnk', executable, icon, { readShortcutLink: () => ({ target: executable }), writeShortcutLink: () => false }), /shortcut-update-failed/)
})
test('开始菜单入口不存在时不创建，写入受限报告失败且重复目录只处理一次', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-shortcut-'))
  try {
    const file = path.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'DSBotDeck.lnk')
    let reads = 0
    const port: ShortcutPort = { readShortcutLink: () => { reads++; return { target: executable } }, writeShortcutLink: () => false }
    assert.equal(await syncStartMenuIcon([root], executable, icon, port), true)
    assert.equal(reads, 0)
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'fictional-link', 'utf8')
    assert.equal(await syncStartMenuIcon([root, root], executable, icon, port), false)
    assert.equal(reads, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
