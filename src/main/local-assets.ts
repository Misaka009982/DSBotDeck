// SPDX-License-Identifier: Apache-2.0
// 只读用户主动选择的本机图片与 Codex 合集；页面只拿固定资源地址，不接受任意磁盘请求。
import { randomUUID } from 'node:crypto'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { AppearanceSettings, LocalAssetsView } from '../shared/domain.ts'
import { DeckError, record, text } from '../shared/validation.ts'
import { CSP, SCHEME } from './protocol.ts'
const IMAGE_LIMIT = 20 * 1024 * 1024
const LIBRARY_LIMIT = 256
interface ImageAsset { bytes: Buffer; type: string }
interface SkinAsset { key: string; name: string; rows: number; image: ImageAsset }
const failure = () => new DeckError('asset/invalid', '本机素材不可用，请检查文件格式、权限和大小。')
const contained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
async function bytesOf(file: string, limit: number): Promise<Buffer> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw failure()
  const handle = await open(file, 'r')
  try {
    const current = await handle.stat()
    if (info.dev !== current.dev || info.ino !== current.ino || !current.isFile() || current.size <= 0 || current.size > limit) throw new DeckError('asset/budget', '素材文件已变化或大小超出限制。')
    const bytes = Buffer.alloc(current.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) throw failure()
      offset += read.bytesRead
    }
    if ((await handle.stat()).size !== current.size) throw failure()
    return bytes
  } finally { await handle.close() }
}
export async function localFile(root: string, child: string, limit: number): Promise<string> {
  if (!child || path.isAbsolute(child) || /^[a-z]:/i.test(child) || /[:\u0000-\u001f]/.test(child) || child.startsWith('\\')) throw failure()
  const base = await realpath(root)
  const candidate = path.resolve(base, child)
  if (!contained(base, candidate)) throw failure()
  let current = base
  for (const segment of path.relative(base, candidate).split(path.sep)) {
    current = path.join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) throw failure()
  }
  const canonical = await realpath(candidate)
  if (!contained(base, canonical)) throw failure()
  const info = await lstat(canonical)
  if (!info.isFile() || info.size <= 0 || info.size > limit) throw new DeckError('asset/budget', '素材文件大小超出限制。')
  return canonical
}
export function webpSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null
  const kind = bytes.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  return null
}
export async function readImage(file: string, icon = false): Promise<ImageAsset> {
  const bytes = await bytesOf(file, icon ? 2 * 1024 * 1024 : IMAGE_LIMIT)
  let type: string | null = null
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = 'image/png'
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'image/jpeg'
  else if (webpSize(bytes)) type = 'image/webp'
  else if (icon && bytes.length >= 22 && bytes.readUInt32LE(0) === 0x00010000 && bytes.readUInt16LE(4) > 0) type = 'image/x-icon'
  if (!type) throw new DeckError('asset/invalid', '只能选择 PNG、JPEG、WebP 图片，图标另支持 ICO；不能加载脚本或 SVG。')
  if (type === 'image/png' && (bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 40_000_000)) throw failure()
  if (type === 'image/webp') {
    const size = webpSize(bytes)
    if (!size || size.width <= 0 || size.height <= 0 || size.width * size.height > 40_000_000) throw failure()
  }
  if (type === 'image/jpeg') {
    let offset = 2; let size: { width: number; height: number } | null = null
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]
      if (marker === 0xff) { offset++; continue }
      if (marker === 0xda || marker === 0xd9) break
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) { size = { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }; break }
      offset += 2 + length
    }
    if (!size || size.width <= 0 || size.height <= 0 || size.width * size.height > 40_000_000) throw failure()
  }
  return { bytes, type }
}
async function readSkin(root: string, key: string, image = true): Promise<SkinAsset> {
  const manifest = await localFile(root, path.join(key, 'pet.json'), 64 * 1024)
  const value = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytesOf(manifest, 64 * 1024))))
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 160 || typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 160 || typeof value.spritesheetPath !== 'string' || !value.spritesheetPath.toLowerCase().endsWith('.webp')) throw failure()
  const folder = path.dirname(manifest)
  const sprite = await localFile(folder, value.spritesheetPath, IMAGE_LIMIT)
  // 扫描只读文件头；完整精灵仅为选中项加载，不在每次快照复制整个合集。
  const handle = await open(sprite, 'r')
  let header: Buffer
  try { header = Buffer.alloc(32); const read = await handle.read(header, 0, 32, 0); header = header.subarray(0, read.bytesRead) } finally { await handle.close() }
  const dimensions = webpSize(header)
  const version = value.spriteVersionNumber
  if (version !== undefined && ![1, 2, 'default', 'v1', 'v2'].some(known => known === version)) throw failure()
  const rows = dimensions?.height === 2288 ? 11 : 9
  if (!dimensions || dimensions.width !== 1536 || dimensions.height !== rows * 208 || (version === 2 || version === 'v2') && rows !== 11 || (version === 1 || version === 'v1' || version === 'default') && rows !== 9) throw new DeckError('asset/unsupported', '精灵须为 Codex 标准 1536×1872 或 1536×2288。')
  return { key, name: text(value.displayName, 160), rows, image: image ? await readImage(sprite) : { bytes: Buffer.alloc(0), type: 'image/webp' } }
}
export class LocalAssets {
  private readonly defaultLibrary: string
  private revision = randomUUID()
  private libraryPath = ''
  private pets: LocalAssetsView['pets'] = []
  private warnings: string[] = []
  private icon: ImageAsset | null = null
  private background: ImageAsset | null = null
  private selected: SkinAsset | null = null
  constructor(defaultLibrary: string) { this.defaultLibrary = defaultLibrary }
  iconBytes(): Buffer | null { return this.icon?.bytes ?? null }
  hasBackground(): boolean { return this.background !== null }
  warn(message: string): void { if (!this.warnings.includes(message)) this.warnings.push(message) }
  async refresh(settings: AppearanceSettings, skin: string | null): Promise<void> {
    const pets: LocalAssetsView['pets'] = []; const warnings: string[] = []
    let icon: ImageAsset | null = null; let background: ImageAsset | null = null; let selected: SkinAsset | null = null
    if (settings.iconPath) { try { icon = await readImage(settings.iconPath, true) } catch { warnings.push('自定义图标不可用，已回退内置图标。') } }
    if (settings.backgroundPath) { try { background = await readImage(settings.backgroundPath) } catch { warnings.push('背景图片不可用，已回退原主题背景。') } }
    const libraryPath = settings.petLibraryPath ?? this.defaultLibrary
    try {
      const directory = await opendir(libraryPath)
      let visited = 0
      for await (const entry of directory) {
        if (visited++ >= LIBRARY_LIMIT) { warnings.push(`合集超过 ${LIBRARY_LIMIT} 项，只扫描前 ${LIBRARY_LIMIT} 项。`); break }
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        try {
          const pet = await readSkin(libraryPath, entry.name, entry.name === skin)
          pets.push({ key: entry.name, name: pet.name, available: true, error: null })
          if (entry.name === skin) selected = pet
        } catch { pets.push({ key: entry.name, name: entry.name.slice(0, 160), available: false, error: '格式、尺寸或路径不兼容' }) }
      }
    } catch { warnings.push('未找到可读的 Codex 宠物目录；可在 Deck 设置中选择目录或使用内置宠物。') }
    if (skin && !selected) warnings.push('所选宠物不可用，暂用内置外观；不会清除你的选择或配对身份。')
    this.icon = icon; this.background = background; this.selected = selected; this.pets = pets.sort((a, b) => a.name.localeCompare(b.name)); this.warnings = warnings; this.libraryPath = libraryPath; this.revision = randomUUID()
  }
  view(host: 'shell' | 'pet'): LocalAssetsView {
    const url = (name: string) => `${SCHEME}://${host}/local/${name}?v=${this.revision}`
    return {
      revision: this.revision, icon: host === 'shell' && this.icon ? url('icon') : null, background: host === 'shell' && this.background ? url('background') : null,
      libraryPath: host === 'shell' ? this.libraryPath : '', pets: host === 'shell' ? this.pets.map(pet => ({ ...pet })) : [],
      selected: this.selected ? { key: this.selected.key, name: this.selected.name, rows: this.selected.rows, url: url('pet.webp') } : null, warnings: host === 'shell' ? [...this.warnings] : [],
    }
  }
  response(host: 'shell' | 'pet', pathname: string, method: string): Response {
    if (method !== 'GET' && method !== 'HEAD') return new Response('不允许此方法', { status: 405 })
    const image = pathname === '/local/pet.webp' ? this.selected?.image : host === 'shell' && pathname === '/local/icon' ? this.icon : host === 'shell' && pathname === '/local/background' ? this.background : null
    if (!image) return new Response('本机素材不可用', { status: 404 })
    return new Response(method === 'HEAD' ? null : new Uint8Array(image.bytes), { headers: { 'Content-Type': image.type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } })
  }
}
