// SPDX-License-Identifier: Apache-2.0
// 构建时复用原标记和已声明的 Electron，仅写临时目录与本项目图标输出。
import { spawn } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_APP_MARK, iconSvg } from '../src/shared/app-icon.ts'
import { icoFile } from '../src/main/icon-format.ts'
export const APP_ICON_SIZES = Object.freeze([16, 20, 24, 32, 36, 40, 48, 64, 72, 96, 128, 256])
export const ICON_SOURCE_FILES = Object.freeze(['ds-bot/src/client/characters.js', 'ds-bot/src/client/inks.js'])
const TRAY_SIZES = new Set([16, 20, 24, 32])
export function appIconJobs(characterMarkup, maskId) {
  const markup = characterMarkup(DEFAULT_APP_MARK.shape, DEFAULT_APP_MARK.color)
  return APP_ICON_SIZES.map(size => ({ size, svg: iconSvg(markup, maskId, size) }))
}
export async function createAppIcons(upstreamRoot, outputRoot) {
  const characters = await import(pathToFileURL(path.join(upstreamRoot, ICON_SOURCE_FILES[0])).href)
  const inks = await import(pathToFileURL(path.join(upstreamRoot, ICON_SOURCE_FILES[1])).href)
  if (characters.SHAPES?.[DEFAULT_APP_MARK.shape]?.size !== 100 || !inks.GRADIENTS?.[DEFAULT_APP_MARK.color]) throw new Error('上游五角星或渐变定义已变化，请核对默认图标兼容性。')
  const jobs = appIconJobs(characters.characterMarkup, characters.MASK_ID)
  const folder = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-icons-'))
  try {
    await writeFile(path.join(folder, 'request.json'), JSON.stringify({ jobs }), 'utf8')
    const electron = createRequire(import.meta.url)('electron')
    // 编辑器可能令 Electron 作为 Node 运行；仅移除此标记，不改写用户环境。
    const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
    await new Promise((resolve, reject) => {
      const child = spawn(electron, [fileURLToPath(new URL('./render-icon.mjs', import.meta.url)), folder], { stdio: 'inherit', env })
      child.once('error', reject)
      child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`默认图标转换失败：${signal ?? code ?? '未知退出状态'}。`)))
    })
    const images = await Promise.all(jobs.map(async ({ size }) => ({ size, png: await readFile(path.join(folder, `${size}.png`)) })))
    const files = [
      ['icon.png', images.find(image => image.size === 256).png],
      ['icon.ico', icoFile(images)],
      ['tray.png', images.find(image => image.size === 24).png],
      ['tray.ico', icoFile(images.filter(image => TRAY_SIZES.has(image.size)))],
    ]
    for (const [name, bytes] of files) {
      const target = path.join(outputRoot, name)
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error('图标构建目标不能是符号链接。') }
      catch (error) { if (error?.code !== 'ENOENT') throw error }
      await writeFile(target, bytes)
    }
    console.log('默认图标已生成：原五角星渐变，Windows 与托盘共用矢量来源。')
  } finally { await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}
