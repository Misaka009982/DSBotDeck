// SPDX-License-Identifier: Apache-2.0
// 仅验证默认选择、矢量来源和 ICO 目录格式；不启动 Electron 或写用户图标。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { characterMarkup, MAIN_LOOK, MASK_ID, PICKER_SHAPES } from '@dsbot/characters'
import { defaultAppearance } from '../src/shared/domain.ts'
import { DEFAULT_APP_MARK, iconSvg } from '../src/shared/app-icon.ts'
import { icoFile } from '../src/main/icon-format.ts'
import { APP_ICON_SIZES, appIconJobs } from '../scripts/app-icons.mjs'

const pngHeader = (size: number): Buffer => {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write('IHDR', 12); bytes.writeUInt32BE(size, 16); bytes.writeUInt32BE(size, 20)
  return bytes
}
test('应用默认使用原 star/aurora，不改变远程 Bot 或用户外观默认配置', () => {
  assert.deepEqual(DEFAULT_APP_MARK, { shape: 'star', color: 'aurora' })
  assert.equal(Object.isFrozen(DEFAULT_APP_MARK), true)
  assert.ok(PICKER_SHAPES.includes(DEFAULT_APP_MARK.shape))
  assert.deepEqual(MAIN_LOOK, { shape: 'whale', color: 'deepseek' })
  assert.equal(defaultAppearance().builtinIcon, null); assert.equal(defaultAppearance().iconPath, null)
})
test('默认矢量直接复用原五角星渐变和眼睛遮罩，各尺寸不拉伸', () => {
  const markup = characterMarkup(DEFAULT_APP_MARK.shape, DEFAULT_APP_MARK.color)
  for (const size of [16, 24, 256]) {
    const svg = iconSvg(markup, MASK_ID, size)
    assert.ok(svg.includes(`width="${size}" height="${size}" viewBox="0 0 100 100"`))
    assert.ok(svg.includes(markup.replaceAll(MASK_ID, 'deck-icon')))
    assert.ok(svg.includes('<linearGradient')); assert.ok(svg.includes('<mask'))
    assert.equal(svg.includes(MASK_ID), false)
  }
  for (const size of [0, 1025, NaN, 20.5]) assert.throws(() => iconSvg(markup, MASK_ID, size))
  assert.throws(() => iconSvg(markup, ''))
})
test('ICO 目录支持小尺寸和256尺寸，字节偏移与PNG一致', () => {
  const images = [16, 32, 256].map(size => ({ size, png: pngHeader(size) }))
  const bytes = icoFile(images)
  assert.equal(bytes.readUInt16LE(0), 0); assert.equal(bytes.readUInt16LE(2), 1)
  assert.equal(bytes.readUInt16LE(4), images.length)
  let offset = 6 + 16 * images.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index
    assert.equal(bytes[entry], size === 256 ? 0 : size); assert.equal(bytes[entry + 1], bytes[entry])
    assert.equal(bytes.readUInt16LE(entry + 4), 1); assert.equal(bytes.readUInt16LE(entry + 6), 32)
    assert.equal(bytes.readUInt32LE(entry + 8), png.length); assert.equal(bytes.readUInt32LE(entry + 12), offset)
    assert.deepEqual(bytes.subarray(offset, offset + png.length), png)
    offset += png.length
  })
  assert.equal(bytes.length, offset)
})
test('ICO 拒绝空目录、无效尺寸、非PNG和尺寸不匹配；实际解码仍由原生链路负责', () => {
  assert.throws(() => icoFile([]))
  for (const size of [0, 257, 16.5]) assert.throws(() => icoFile([{ size, png: pngHeader(16) }]))
  assert.throws(() => icoFile([{ size: 16, png: Buffer.from('not-png') }]))
  assert.throws(() => icoFile([{ size: 16, png: pngHeader(32) }]))
  assert.throws(() => icoFile([{ size: 16, png: Buffer.alloc(300001) }]))
})
test('图标构建任务只有固定尺寸的原五角星，托盘尺寸包含在同一组向量中', () => {
  const jobs = appIconJobs(characterMarkup, MASK_ID)
  assert.deepEqual(jobs.map(job => job.size), [...APP_ICON_SIZES])
  assert.equal(new Set(jobs.map(job => job.size)).size, jobs.length)
  for (const size of [16, 20, 24, 32, 256]) assert.ok(jobs.some(job => job.size === size))
  const markup = characterMarkup(DEFAULT_APP_MARK.shape, DEFAULT_APP_MARK.color)
  for (const job of jobs) assert.equal(job.svg, iconSvg(markup, MASK_ID, job.size))
})
test('打包只生成本项目图标，转换页隔离且不启动Deck或上游Host', async () => {
  const root = new URL('../', import.meta.url)
  const build = await readFile(new URL('scripts/build.mjs', root), 'utf8')
  const icons = await readFile(new URL('scripts/app-icons.mjs', root), 'utf8')
  const renderer = await readFile(new URL('scripts/render-icon.mjs', root), 'utf8')
  assert.ok(build.includes('createAppIcons(upstream.root, assets)'))
  assert.equal(build.includes("path.join(upstream.root, 'app/assets', name)"), false)
  assert.ok(icons.includes('ds-bot/src/client/characters.js')); assert.ok(icons.includes('ds-bot/src/client/inks.js'))
  assert.ok(icons.includes("stdio: 'inherit'")); assert.equal(icons.includes('timeout:'), false)
  assert.ok(renderer.includes('contextIsolation: true')); assert.ok(renderer.includes('sandbox: true'))
  assert.ok(renderer.includes('nodeIntegration: false')); assert.ok(renderer.includes("app.setPath('userData'"))
  assert.ok(renderer.includes('catch (error) { failed(error) }')); assert.ok(renderer.includes('.catch(failed)'))
  assert.equal(renderer.includes('dist/main/index.mjs'), false)
  assert.equal(renderer.includes('DSH'), false)
})
