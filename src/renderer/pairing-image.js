// SPDX-License-Identifier: Apache-2.0
// 仅处理用户主动选择或粘贴的截图；图片及识别结果不写磁盘、不上传。
function decodePixels(pixels, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./qr-worker.js', import.meta.url), { type: 'module' })
    const finish = (error, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(value) }
    const abort = () => finish(new Error('已取消图片识别。'))
    const timer = setTimeout(() => finish(new Error('截图识别超时，请裁剪到二维码区域后重试。')), 20000)
    worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.value)
    worker.onerror = () => finish(new Error('二维码识别组件未能读取图片。'))
    signal?.addEventListener('abort', abort, { once: true })
    worker.postMessage({ data: pixels.data, width: pixels.width, height: pixels.height }, [pixels.data.buffer])
  })
}
export async function readPairingImage(file, signal) {
  const accepted = ['image/png', 'image/jpeg', 'image/webp']
  if (!file || file.size === 0 || file.size > 20 * 1024 * 1024 || !(accepted.includes(file.type) || !file.type && /\.(png|jpe?g|webp)$/i.test(file.name))) throw new Error('请选择不超过 20 MB 的 PNG、JPEG 或 WebP 截图。')
  let image
  try { image = await createImageBitmap(file) }
  catch { throw new Error('截图无法解码，请检查图片是否完整。') }
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('截图像素过大，请先裁剪到二维码区域。')
    const scale = Math.min(1, 4096 / image.width, 4096 / image.height, Math.sqrt(12_000_000 / (image.width * image.height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(image.width * scale)); canvas.height = Math.max(1, Math.floor(image.height * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('本机图片读取不可用。')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await decodePixels(context.getImageData(0, 0, canvas.width, canvas.height), signal)
  } finally { image.close() }
}
