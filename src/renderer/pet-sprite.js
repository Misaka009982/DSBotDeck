// SPDX-License-Identifier: Apache-2.0
// 本机图片只由主进程固定地址提供；加载失败立即使用原标记，不执行素材目录里的代码。
import { createElement as h, useEffect, useState } from 'react'
import { BotMark } from '@dsbot/client/mark.js'
import { spriteFrame } from '../shared/pet-sprite.ts'
import './pet-sprite.css'
export function PetSprite({ asset, pose = 'idle', size = 112, paused = false }) {
  const [ready, setReady] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    setReady(null)
    if (!asset) return
    let disposed = false
    const image = new Image()
    image.onload = () => { if (!disposed && image.naturalWidth === 1536 && image.naturalHeight === asset.rows * 208) setReady(asset.url) }
    image.src = asset.url
    return () => { disposed = true; image.onload = null; image.onerror = null }
  }, [asset?.url, asset?.rows])
  useEffect(() => {
    setTick(0)
    if (!ready || paused) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let timer
    const sync = () => { clearInterval(timer); if (!reduced.matches && document.visibilityState === 'visible') timer = setInterval(() => setTick(value => (value + 1) % 24), 140) }
    sync(); reduced.addEventListener('change', sync); document.addEventListener('visibilitychange', sync)
    return () => { clearInterval(timer); reduced.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync) }
  }, [ready, pose, paused])
  if (!asset || ready !== asset.url) return h(BotMark, { size: Math.min(size, 96) })
  const frame = spriteFrame(pose, tick)
  return h('span', { className: 'deck-sprite', role: 'img', 'aria-label': asset.name, style: {
    width: `${size * 192 / 208}px`, height: `${size}px`, backgroundImage: `url("${asset.url}")`,
    backgroundSize: `800% ${asset.rows * 100}%`, backgroundPosition: `${frame.frame / 7 * 100}% ${frame.row / (asset.rows - 1) * 100}%`,
  } })
}
