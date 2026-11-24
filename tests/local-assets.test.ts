// SPDX-License-Identifier: Apache-2.0
// 只使用临时素材，不读取用户的 Codex 合集、身份库或真实图片。
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { builtinIconBytes, LocalAssets, localFile, readImage, webpSize } from '../src/main/local-assets.ts'
import { defaultAppearance } from '../src/shared/domain.ts'
import { backgroundLevels } from '../src/shared/appearance.ts'
import { petPose, spriteFrame } from '../src/shared/pet-sprite.ts'

function sheet(width = 1536, height = 1872): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(22, 4); bytes.write('WEBPVP8X', 8); bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}
test('WebP 尺寸区分原生九行与十一行，不把小图当精灵', () => {
  assert.deepEqual(webpSize(sheet()), { width: 1536, height: 1872 })
  assert.deepEqual(webpSize(sheet(1536, 2288)), { width: 1536, height: 2288 })
  assert.equal(webpSize(Buffer.from('not-a-webp')), null)
})
test('内置图标仅接收有预算的标准 PNG，固定资源不向宠物公开程序图标', async () => {
  const png = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write('IHDR', 12)
  png.writeUInt32BE(256, 16); png.writeUInt32BE(256, 20)
  assert.deepEqual(builtinIconBytes(png.toString('base64')), png)
  assert.throws(() => builtinIconBytes(Buffer.from('<svg/>').toString('base64')))
  const large = Buffer.from(png); large.writeUInt32BE(40000, 16)
  assert.throws(() => builtinIconBytes(large.toString('base64')))
  assert.throws(() => builtinIconBytes(Buffer.alloc(300001).toString('base64')))
  const root = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-icons-'))
  try {
    const assets = new LocalAssets(root)
    await assets.refresh({ ...defaultAppearance(), builtinIcon: { look: { shape: 'whale', color: 'blue' }, png: png.toString('base64') } }, null)
    assert.ok(assets.view('shell').icon)
    assert.equal(assets.response('shell', '/local/icon', 'GET').headers.get('content-type'), 'image/png')
    assert.equal(assets.response('pet', '/local/icon', 'GET').status, 404)
    const file = path.join(root, 'icon.webp'); await writeFile(file, sheet(256, 256))
    const settings = { ...defaultAppearance(), iconPath: file }
    await assets.refresh(settings, null)
    const old = assets.view('shell').revision
    assert.equal(assets.view('shell').iconNeedsRaster, true); assert.equal(assets.view('pet').iconNeedsRaster, false)
    await assets.refresh(settings, null)
    assert.equal(assets.setIconRaster(old, png), false)
    assert.equal(assets.setIconRaster(assets.view('shell').revision, png), true)
    assert.equal(assets.view('shell').iconNeedsRaster, false)
    assert.deepEqual(assets.iconBytes(), png)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('本机文件拒绝越界、URL、设备路径和超出预算', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-assets-'))
  try {
    await writeFile(path.join(root, 'sprite.webp'), sheet())
    // Windows 临时目录可能使用 8.3 短路径；localFile 按契约返回规范化后的真实路径。
    assert.equal(await localFile(root, 'sprite.webp', 1024), await realpath(path.join(root, 'sprite.webp')))
    for (const name of ['../other.webp', 'https://example/a.webp', 'C:/other.webp', 'sprite.webp:stream', '\\other\\a.webp']) await assert.rejects(localFile(root, name, 1024))
    await assert.rejects(localFile(root, 'sprite.webp', 8), /大小/)
    await writeFile(path.join(root, 'fake.webp'), 'not an image')
    await assert.rejects(readImage(path.join(root, 'fake.webp')), /图片/)
    await mkdir(path.join(root, 'real')); await writeFile(path.join(root, 'real', 'inside.webp'), sheet())
    await symlink(path.join(root, 'real'), path.join(root, 'linked'), 'junction')
    await assert.rejects(localFile(root, 'linked/inside.webp', 1024))
    await writeFile(path.join(root, 'large.webp'), sheet(16384, 16384))
    await assert.rejects(readImage(path.join(root, 'large.webp')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('合集有坏包仍列出好包，只公开选中精灵且不读取任意路径', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-pets-'))
  try {
    for (const name of ['valid', 'tiny', 'eleven']) {
      await mkdir(path.join(root, name))
      await writeFile(path.join(root, name, 'pet.json'), JSON.stringify({ id: name, displayName: name === 'valid' ? '测试宠物' : '小图片', spritesheetPath: 'spritesheet.webp' }), 'utf8')
      await writeFile(path.join(root, name, 'spritesheet.webp'), name === 'tiny' ? sheet(256, 80) : sheet(1536, name === 'eleven' ? 2288 : 1872))
    }
    const assets = new LocalAssets(root)
    await assets.refresh(defaultAppearance(), 'valid')
    const view = assets.view('shell')
    assert.equal(view.pets.length, 3); assert.equal(view.pets.find(pet => pet.key === 'tiny')?.available, false)
    assert.equal(view.selected?.name, '测试宠物'); assert.equal(view.selected?.rows, 9)
    assert.ok(view.selected?.url.startsWith('dsbotdeck://shell/local/pet.webp?'))
    assert.equal(JSON.stringify(view.selected).includes(root), false)
    const response = assets.response('pet', '/local/pet.webp', 'GET')
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp')
    assert.equal(assets.response('pet', '/local/icon', 'GET').status, 404)
    assert.equal(assets.response('shell', '/local/../pet.json', 'GET').status, 404)
    assert.equal(assets.response('pet', '/local/pet.webp', 'POST').status, 405)
    await assets.refresh(defaultAppearance(), 'eleven')
    assert.equal(assets.view('pet').selected?.rows, 11)
    await assets.refresh(defaultAppearance(), 'missing')
    assert.equal(assets.view('pet').selected, null)
    assert.equal(assets.response('pet', '/local/pet.webp', 'GET').status, 404)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('会话背景透明度增加十个百分点，零到一百边界不影响文字层', () => {
  const normal = backgroundLevels(0.6)
  assert.equal(normal.surface, 0.6); assert.equal(normal.chat, 0.5)
  assert.ok(Math.abs(normal.surface * (1 - normal.tint) - normal.chat) < 1e-10)
  assert.deepEqual(backgroundLevels(0), { surface: 0, chat: 0, tint: 0 })
  assert.equal(backgroundLevels(0.05).chat, 0)
  assert.equal(backgroundLevels(1).chat, 0.9)
  assert.equal(backgroundLevels(NaN).surface, 0)
})
test('宠物姿态只使用非缓存事实；不把缺失结果补成工作或失败', () => {
  assert.equal(petPose([{ color: 'red', cached: true }]), 'idle')
  assert.equal(petPose([{ color: 'green', cached: false }]), 'working')
  assert.equal(petPose([{ color: 'yellow', cached: false }, { color: 'green', cached: false }]), 'waiting')
  assert.deepEqual(spriteFrame('working', 7), { row: 7, frame: 1 })
  assert.deepEqual(spriteFrame('error', 7), { row: 5, frame: 7 })
})
