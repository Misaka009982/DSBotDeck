// SPDX-License-Identifier: Apache-2.0
// 应用默认标记与矢量封装共用一处；不覆盖用户已保存的外观或远程 Bot。
import type { LocalMark } from './domain.ts'
export const DEFAULT_APP_MARK: Readonly<LocalMark> = Object.freeze({ shape: 'star', color: 'aurora' })
export const ICON_PNG_SIZE = 256
export function iconSvg(markup: string, maskId: string, size = ICON_PNG_SIZE): string {
  if (!maskId || !Number.isInteger(size) || size < 1 || size > 1024) throw new Error('图标尺寸或遮罩标识无效。')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${markup.replaceAll(maskId, 'deck-icon')}</svg>`
}
