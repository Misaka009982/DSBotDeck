// SPDX-License-Identifier: Apache-2.0
// 只读取主进程授权的本机图片尺寸；背景与选框共享窗口的实际内容尺寸。
import { useEffect, useState } from 'react'
export function useWindowSize() {
  const measure = () => ({ width: window.innerWidth, height: window.innerHeight })
  const [size, setSize] = useState(measure)
  useEffect(() => {
    const update = () => setSize(measure())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}
export function useImageSize(source) {
  const [image, setImage] = useState(null)
  useEffect(() => {
    if (!source) return
    let stopped = false
    const image = new Image()
    image.onload = () => { if (!stopped) setImage({ source, width: image.naturalWidth, height: image.naturalHeight }) }
    image.onerror = () => { if (!stopped) setImage({ source, error: true }) }
    image.src = source
    return () => { stopped = true; image.onload = null; image.onerror = null }
  }, [source])
  return image?.source === source ? image : null
}
