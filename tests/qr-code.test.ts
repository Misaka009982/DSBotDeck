// SPDX-License-Identifier: Apache-2.0
// 回归只读虚构二维码；不访问二维码网址，不读取真实配对截图。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import qrcode from 'qrcode-generator'
import { pairingQr } from '../src/shared/qr-code.ts'
function pixels(text: string, inverse = false) {
  const code = qrcode(0, 'M'); code.addData(text); code.make()
  const border = 4; const scale = 5; const side = (code.getModuleCount() + border * 2) * scale
  const data = new Uint8ClampedArray(side * side * 4)
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const row = Math.floor(y / scale) - border; const column = Math.floor(x / scale) - border
    const dark = row >= 0 && column >= 0 && row < code.getModuleCount() && column < code.getModuleCount() && code.isDark(row, column)
    const value = dark !== inverse ? 0 : 255; const offset = (y * side + x) * 4
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255
  }
  return { data, side }
}
test('本机二维码识别手机配对与浏览器片段链接，不访问远程地址', () => {
  const uri = 'dsbot://pair?v=1&device=browser&code=fictional-fixture'
  for (const input of [uri, `https://relay.example/web/#pair=${encodeURIComponent(uri)}`]) {
    const image = pixels(input)
    assert.equal(pairingQr(image.data, image.side, image.side), uri)
  }
  const inverted = pixels(uri, true)
  assert.equal(pairingQr(inverted.data, inverted.side, inverted.side), uri)
})
test('截图识别拒绝非配对码、空白图和异常像素预算', () => {
  const unrelated = pixels('https://example.com/not-pairing')
  assert.throws(() => pairingQr(unrelated.data, unrelated.side, unrelated.side), /配对链接/)
  assert.throws(() => pairingQr(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100), /没有识别到/)
  assert.throws(() => pairingQr(new Uint8ClampedArray(4), 100000, 100000), /尺寸/)
  assert.throws(() => pairingQr(new Uint8ClampedArray(4), 100, 100), /尺寸/)
})
