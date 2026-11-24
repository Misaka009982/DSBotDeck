// SPDX-License-Identifier: Apache-2.0
// 将只读上游内置角色或已授权本机图标绘成 PNG；不向主进程提交 SVG 或文件路径。
import { characterMarkup, MASK_ID, PICKER_SHAPES } from '@dsbot/client/characters.js'
import { INKS, isHex } from '@dsbot/client/inks.js'
export async function renderBuiltinIcon(look) {
  if (!PICKER_SHAPES.includes(look.shape) || !(Object.hasOwn(INKS, look.color) || isHex(look.color))) throw new Error('内置图标选择无效。')
  const markup = characterMarkup(look.shape, look.color).replaceAll(MASK_ID, 'deck-icon')
    .replace(/var\(--bt-ink-([a-z]+)\)/g, (_match, ink) => INKS[ink][0])
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 100 100">${markup}</svg>`
  return rasterizeIcon(`data:image/svg+xml,${encodeURIComponent(svg)}`)
}
export async function rasterizeIcon(source) {
  const image = new Image()
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('图标无法在本机解码，原设置未修改。'))
    image.src = source
  })
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('本机图片绘制不可用。')
  context.drawImage(image, 0, 0, 256, 256)
  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
}
