// SPDX-License-Identifier: Apache-2.0
// 只供构建使用的隔离矢量绘制页；不加载客户端主入口或用户身份库。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
if (!process.versions.electron) throw new Error('图标转换页只能由构建通过 Electron 调用。')
const { app, BrowserWindow } = await import('electron')
const folder = process.argv.at(-1)
async function renderIcons() {
  const { jobs } = JSON.parse(await readFile(path.join(folder, 'request.json'), 'utf8'))
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > 32 || jobs.some(job => !Number.isInteger(job.size) || job.size < 1 || job.size > 256 || typeof job.svg !== 'string' || job.svg.length > 100000) || new Set(jobs.map(job => job.size)).size !== jobs.length) throw new Error('图标转换请求无效或超出预算。')
  const page = new BrowserWindow({
    show: false, skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false, partition: 'deck-icon-build' },
  })
  page.setMenu(null)
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  page.webContents.on('will-navigate', event => event.preventDefault())
  page.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  page.webContents.session.setPermissionCheckHandler(() => false)
  try {
    await page.loadURL('data:text/html,<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:"><title>Deck 图标转换</title>')
    const draw = async list => Promise.all(list.map(async ({ svg, size }) => {
      const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('本机构建图片绘制不可用。')
      context.drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
    }))
    const pngs = await page.webContents.executeJavaScript(`(${draw.toString()})(${JSON.stringify(jobs)})`)
    await Promise.all(jobs.map(({ size }, index) => writeFile(path.join(folder, `${size}.png`), Buffer.from(pngs[index], 'base64'))))
  } finally { if (!page.isDestroyed()) page.destroy() }
}
const failed = error => { console.error('默认图标转换失败：', error); app.exit(1) }
try {
  if (!folder || !path.isAbsolute(folder)) throw new Error('图标转换临时目录无效。')
  const profile = path.join(folder, 'profile')
  await mkdir(profile, { recursive: true })
  app.setPath('userData', profile)
  // Electron 就绪依赖主模块执行结束，不能在顶层等待 whenReady。
  app.whenReady().then(renderIcons).then(() => app.exit(0)).catch(failed)
} catch (error) { failed(error) }
