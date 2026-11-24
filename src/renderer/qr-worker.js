// SPDX-License-Identifier: Apache-2.0
// 二维码像素在独立线程处理，避免大截图阻塞配对窗口。
import { pairingQr } from '../shared/qr-code.ts'
self.onmessage = event => {
  try { self.postMessage({ value: pairingQr(event.data.data, event.data.width, event.data.height) }) }
  catch (error) { self.postMessage({ error: error.message || '二维码识别失败。' }) }
}
