// SPDX-License-Identifier: Apache-2.0
// 拖动只修改本地草稿，点击应用后保存；窗口比例变化时不改变原图片。
import { createElement as h, useEffect, useRef, useState } from 'react'
import { backgroundCropRect, moveBackgroundCrop, resizeBackgroundCrop } from '../shared/background-crop.ts'
import { useImageSize, useWindowSize } from './background-image.js'
const centered = () => ({ cx: 0.5, cy: 0.5, zoom: 1 })
export function BackgroundCropper({ source, value, disabled, commit }) {
  const image = useImageSize(source)
  const viewport = useWindowSize()
  const [draft, setDraft] = useState(value ?? centered)
  const stage = useRef(null)
  const drag = useRef(null)
  useEffect(() => { setDraft(value ?? centered()); drag.current = null }, [source, value?.cx, value?.cy, value?.zoom])
  useEffect(() => { drag.current = null }, [disabled, viewport.width, viewport.height])
  if (!image) return h('p', { className: 'deck-hint', role: 'status' }, '正在加载背景预览…')
  if (image.error) return h('p', { className: 'deck-error', role: 'alert' }, '背景预览无法加载，请重新选择完整图片。')
  const rect = backgroundCropRect(image, viewport, draft)
  if (!rect) return null
  const begin = (event, mode) => {
    if (disabled || event.button !== 0) return
    event.preventDefault(); event.currentTarget.focus()
    const bounds = stage.current.getBoundingClientRect()
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds, rect, draft, mode }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = event => {
    const start = drag.current
    if (!start || start.id !== event.pointerId || disabled) return
    const dx = (event.clientX - start.x) / start.bounds.width; const dy = (event.clientY - start.y) / start.bounds.height
    setDraft(start.mode === 'move' ? moveBackgroundCrop(start.rect, start.draft.zoom, dx, dy) : resizeBackgroundCrop(image, viewport, start.rect, dx, dy))
  }
  const end = event => {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    if (event.type === 'pointercancel') setDraft(start.draft)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const key = (event, mode) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? 0.05 : 0.01
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    setDraft(mode === 'move' ? moveBackgroundCrop(rect, draft.zoom, dx, dy) : resizeBackgroundCrop(image, viewport, rect, dx, dy))
  }
  const interaction = mode => ({ disabled, onPointerDown: event => begin(event, mode), onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: () => { drag.current = null }, onKeyDown: event => key(event, mode) })
  return h('div', { className: 'deck-background-crop' },
    h('p', { className: 'deck-hint' }, `选框比例跟随窗口：${viewport.width} × ${viewport.height}。拖动选框选择位置，拖动右下角调整大小；聚焦后也可用方向键调整。`),
    h('div', { ref: stage, className: 'deck-crop-stage', style: { width: `min(100%, ${280 * image.width / image.height}px)`, aspectRatio: `${image.width} / ${image.height}` } },
      h('img', { src: source, alt: '背景图片选区预览', draggable: false }),
      h('div', { className: 'deck-crop-box', style: { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` } },
        h('button', { type: 'button', className: 'deck-crop-move', 'aria-label': '移动背景选区', ...interaction('move') }),
        h('button', { type: 'button', className: 'deck-crop-resize', 'aria-label': '缩放背景选区', ...interaction('resize') }))),
    h('label', { className: 'deck-field' }, `选区放大：${draft.zoom.toFixed(1)} 倍`, h('input', { type: 'range', min: 1, max: 8, step: 0.05, value: draft.zoom, disabled, onChange: event => { const next = { ...draft, zoom: Number(event.target.value) }; setDraft(moveBackgroundCrop(backgroundCropRect(image, viewport, next), next.zoom, 0, 0)) } })),
    h('div', { className: 'deck-setting-actions' },
      h('button', { type: 'button', className: 'bt-soft', disabled, onClick: () => setDraft(centered()) }, '居中重选'),
      h('button', { type: 'button', className: 'bt-soft', disabled: disabled || !value, onClick: () => { setDraft(centered()); commit(null) } }, '恢复整图'),
      h('button', { type: 'button', className: 'bt-send', disabled, onClick: () => commit(moveBackgroundCrop(rect, draft.zoom, 0, 0)) }, '应用选区')),
    h('p', { className: 'deck-hint' }, value ? '当前使用所选区域填满窗口；窗口调整后保持选区中心并适配比例。' : '点击“应用选区”后生效，原图片保持不变。'))
}
