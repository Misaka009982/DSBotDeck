// SPDX-License-Identifier: Apache-2.0
// 只在本机解析截图像素；只接受原配对链接，不访问二维码里的网址。
import jsQR from 'jsqr'
import { DeckError, pairingText } from './validation.ts'
export function pairingQr(data: Uint8ClampedArray, width: number, height: number): string {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 12_000_000 || data.length !== width * height * 4) throw new DeckError('qr/invalid', '二维码图片尺寸无效或过大。')
  // jsQR 的 CommonJS 导出同时提供 default 自引用，沿用其公开声明以兼容 NodeNext 与浏览器打包。
  const code = jsQR.default(data, width, height, { inversionAttempts: 'attemptBoth' })
  if (!code) throw new DeckError('qr/not-found', '没有识别到二维码，请截取完整二维码和四周留白，避免缩得过小。')
  return pairingText(code.data)
}
