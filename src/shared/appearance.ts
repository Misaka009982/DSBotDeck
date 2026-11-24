// SPDX-License-Identifier: Apache-2.0
// 透明度只作用于图片层；会话区固定比外壳多透出十个百分点。
export function backgroundLevels(imageOpacity: number): { surface: number; chat: number; tint: number } {
  const surface = Math.max(0, Math.min(1, Number.isFinite(imageOpacity) ? imageOpacity : 0))
  const chat = Math.max(0, surface - 0.1)
  return { surface, chat, tint: surface > 0 ? 1 - chat / surface : 0 }
}
