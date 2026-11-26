// SPDX-License-Identifier: Apache-2.0
// 用户拖拽实时同步DIP；只读观测不再反写尺寸，停下后保持最后用户设定。
import { createElement as h, useEffect, useRef, useState } from 'react'
const api = window.dsbotDeck
export function WindowSettings({ active, disabled, act }) {
  const [layout, setLayout] = useState(null)
  const [width, setWidth] = useState(''); const [height, setHeight] = useState('')
  const [error, setError] = useState(null)
  const dirty = useRef(false); const revision = useRef(0); const sizeRevision = useRef(-1); const shown = useRef(active); shown.current = active
  const update = (value, reset = false) => {
    const changedSize = sizeRevision.current !== value.sizeRevision
    sizeRevision.current = value.sizeRevision
    setLayout(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); setError(null)
    if (reset || changedSize || !dirty.current) { setWidth(String(value.userSize.width)); setHeight(String(value.userSize.height)); dirty.current = false }
  }
  useEffect(() => {
    if (!active) return
    let alive = true
    const read = async () => {
      const ticket = ++revision.current
      try {
        const result = await api.windowLayout()
        if (!alive || ticket !== revision.current) return
        if (result.ok) update(result.value)
        else setError(result.error.message)
      } catch { if (alive && ticket === revision.current) setError('当前窗口尺寸读取失败，请重新打开窗口分类。') }
    }
    const off = api.onWindowLayout(value => { if (alive) { revision.current++; update(value) } })
    void read()
    return () => { alive = false; revision.current++; off() }
  }, [active])
  const apply = request => act(async () => {
    const ticket = ++revision.current
    const result = await api.windowLayout(request)
    if (result.ok && shown.current && ticket === revision.current) update(result.value, true)
    return result
  })
  const blocked = disabled || !layout
  const valid = layout && Number.isInteger(Number(width)) && Number.isInteger(Number(height)) && Number(width) >= Math.max(100, layout.minimum.width) && Number(height) >= Math.max(100, layout.minimum.height) && Number(width) <= Math.min(16000, layout.workArea.width) && Number(height) <= Math.min(16000, layout.workArea.height)
  return h('section', { className: 'deck-setting-block' }, h('h3', null, '窗口位置与大小'),
    h('p', { className: 'deck-hint', role: 'status' }, layout ? `当前外框：${layout.bounds.width} × ${layout.bounds.height} DIP；显示器缩放：${Math.round(layout.scaleFactor * 100)}%。` : '正在读取当前窗口…'),
    h('div', { className: 'deck-setting-actions' },
      h('button', { type: 'button', className: 'bt-soft', disabled: blocked, onClick: () => apply({ mode: 'left' }) }, '左半屏'),
      h('button', { type: 'button', className: 'bt-soft', disabled: blocked, onClick: () => apply({ mode: 'right' }) }, '右半屏')),
    h('div', { className: 'deck-window-dimensions' },
      h('label', { className: 'deck-field' }, '宽度（DIP）', h('input', { type: 'number', className: 'bt-input', min: layout?.minimum.width ?? 480, max: layout?.workArea.width ?? 16000, step: 1, value: width, disabled: blocked, onChange: event => { dirty.current = true; setWidth(event.target.value) } })),
      h('label', { className: 'deck-field' }, '高度（DIP）', h('input', { type: 'number', className: 'bt-input', min: layout?.minimum.height ?? 320, max: layout?.workArea.height ?? 16000, step: 1, value: height, disabled: blocked, onChange: event => { dirty.current = true; setHeight(event.target.value) } }))),
    h('div', { className: 'deck-setting-actions' }, h('button', { type: 'button', className: 'bt-soft', disabled: blocked || !valid, onClick: () => apply({ mode: 'custom', width: Number(width), height: Number(height) }) }, '应用自定义尺寸')),
    h('p', { className: 'deck-hint' }, '拖拽窗口也是用户设定，宽高在拖拽时实时更新，停下后冻结；移动、显示和退出只记位置，不反写原生尺寸偏差。半屏与自定义尺寸仍会记忆，不修改 Windows 分辨率。'),
    layout ? h('p', { className: 'deck-hint' }, `自定义范围：${Math.max(100, layout.minimum.width)}～${Math.min(16000, layout.workArea.width)} × ${Math.max(100, layout.minimum.height)}～${Math.min(16000, layout.workArea.height)} DIP。窗口变大诊断仍可从托盘获取日志。`) : null,
    error ? h('p', { className: 'deck-error', role: 'alert' }, error) : null)
}
