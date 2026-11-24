// SPDX-License-Identifier: Apache-2.0
// 选区使用图片内的归一化中心与缩放，窗口变化只重新适配比例，不拉伸原图。
import type { BackgroundCrop, Bounds } from './domain.ts'
export interface ImageSize { width: number; height: number }
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
export function backgroundCropRect(image: ImageSize, viewport: ImageSize, crop: BackgroundCrop | null): Bounds | null {
  if (![image.width, image.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return null
  const ratio = viewport.width / viewport.height
  const zoom = clamp(crop?.zoom ?? 1, 1, 8)
  const width = Math.min(image.width, image.height * ratio) / image.width / zoom
  const height = Math.min(image.height, image.width / ratio) / image.height / zoom
  return { x: clamp((crop?.cx ?? 0.5) - width / 2, 0, 1 - width), y: clamp((crop?.cy ?? 0.5) - height / 2, 0, 1 - height), width, height }
}
export function moveBackgroundCrop(rect: Bounds, zoom: number, dx: number, dy: number): BackgroundCrop {
  return { cx: clamp(rect.x + dx, 0, 1 - rect.width) + rect.width / 2, cy: clamp(rect.y + dy, 0, 1 - rect.height) + rect.height / 2, zoom }
}
export function resizeBackgroundCrop(image: ImageSize, viewport: ImageSize, rect: Bounds, dx: number, dy: number): BackgroundCrop {
  const base = backgroundCropRect(image, viewport, null)
  if (!base) return { cx: 0.5, cy: 0.5, zoom: 1 }
  const width = rect.width * image.width; const height = rect.height * image.height
  // 将拖动投影到固定比例的对角线上；左上角不动，四边始终留在原图内。
  const requested = 1 + (dx * image.width * width + dy * image.height * height) / (width * width + height * height)
  const scale = clamp(requested, base.width / rect.width / 8, Math.min(base.width / rect.width, (1 - rect.x) / rect.width, (1 - rect.y) / rect.height))
  return { cx: rect.x + rect.width * scale / 2, cy: rect.y + rect.height * scale / 2, zoom: clamp(base.width / (rect.width * scale), 1, 8) }
}
export function backgroundPlacement(viewport: ImageSize, rect: Bounds): Bounds {
  const width = viewport.width / rect.width; const height = viewport.height / rect.height
  return { x: -rect.x * width, y: -rect.y * height, width, height }
}
