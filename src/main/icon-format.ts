// SPDX-License-Identifier: Apache-2.0
// 将已经栅格化的 PNG 封装为 Windows ICO；本模块只核对格式，不替代图片解码。
import { Buffer } from 'node:buffer'
interface IconImage { size: number; png: Uint8Array }
export function icoFile(images: readonly IconImage[]): Buffer {
  if (images.length < 1 || images.length > 32) throw new Error('ICO 图标数量无效。')
  const pngs = images.map(({ size, png }) => {
    const bytes = Buffer.from(png)
    if (!Number.isInteger(size) || size < 1 || size > 256 || bytes.length < 24 || bytes.length > 300000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) throw new Error('ICO 需要尺寸匹配且有预算的 PNG。')
    return bytes
  })
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size }, index) => {
    const entry = 6 + 16 * index
    header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry]
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(pngs[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += pngs[index].length
  })
  return Buffer.concat([header, ...pngs])
}
