// SPDX-License-Identifier: Apache-2.0
// 原记录损坏或系统加密不可用时失败关闭，不写入替代身份。
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PetSettings, SavedClient, WindowState } from '../shared/domain.ts'
import { defaultClient } from '../shared/domain.ts'
import { DeckError, record, savedClient } from '../shared/validation.ts'
import { assertServerIdentity } from './link-factory.ts'
import { configurationFileStamp, diagnosticErrorCode, notifyDiagnostic } from './window-diagnostics.ts'
import type { VaultWriteSource, WindowDiagnosticObserver, WindowDiagnosticRecord, WindowSaveReason } from './window-diagnostics.ts'

export interface StringCipher {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export class Vault {
  private readonly file: string
  private readonly cipher: StringCipher
  private data: SavedClient = defaultClient()
  private loaded = false
  private broken = false
  private queue: Promise<void> = Promise.resolve()
  private operationId = 0
  private readonly diagnostic: WindowDiagnosticObserver | undefined
  constructor(file: string, cipher: StringCipher, diagnostic?: WindowDiagnosticObserver) { this.file = file; this.cipher = cipher; this.diagnostic = diagnostic }
  private async report(entry: WindowDiagnosticRecord): Promise<void> {
    if (!this.diagnostic) return
    try { notifyDiagnostic(this.diagnostic, { ...entry, file: await configurationFileStamp(this.file) }) } catch { /* 日志失败不影响加密记录。 */ }
  }
  snapshot(): SavedClient { return structuredClone(this.data) }
  windowState(): WindowState | null { return this.data.window ? { ...this.data.window } : null }
  petSettings(): PetSettings { return structuredClone(this.data.pet) }
  async flush(): Promise<void> { await this.queue }
  async load(): Promise<SavedClient> {
    await this.report({ event: 'vault-load-start' })
    try {
      try { if ((await lstat(this.file)).isSymbolicLink()) throw new DeckError('vault/corrupt', '客户端配置不能指向其他文件。') }
      catch (error) { if (record(error)?.code !== 'ENOENT') throw error }
      let encoded: string
      try { encoded = await readFile(this.file, 'utf8') }
      catch (error) {
        if (record(error)?.code !== 'ENOENT') throw error
        this.loaded = true
        await this.report({ event: 'vault-load-success', saved: this.data.window })
        return this.snapshot()
      }
      if (!this.cipher.isEncryptionAvailable()) throw new DeckError('vault/unavailable', '系统加密尚不可用，未读取或重建配对身份。')
      if (Buffer.byteLength(encoded, 'utf8') > 4 * 1024 * 1024) throw new DeckError('vault/corrupt', '客户端加密配置大小异常，未覆盖原文件。')
      const envelope = record(JSON.parse(encoded))
      if (!envelope || envelope.format !== 'dsbotdeck-v1' || typeof envelope.data !== 'string') throw new DeckError('vault/corrupt', '客户端加密配置格式无效，未覆盖原文件。')
      const decoded = this.cipher.decryptString(Buffer.from(envelope.data, 'base64'))
      const next = savedClient(JSON.parse(decoded))
      for (const server of next.servers) assertServerIdentity(server)
      this.data = next
      this.loaded = true
      await this.report({ event: 'vault-load-success', saved: next.window })
      return this.snapshot()
    } catch (error) {
      this.broken = true
      await this.report({ event: 'vault-load-failed', errorCode: diagnosticErrorCode(error) })
      if (error instanceof DeckError) throw error
      throw new DeckError('vault/corrupt', '客户端配置无法解密或读取，未重置原记录；请使用原 Windows 用户或先保留备份再排查。')
    }
  }
  update(change: (current: SavedClient) => SavedClient, source: VaultWriteSource = 'unspecified', reason: WindowSaveReason = 'none'): Promise<SavedClient> {
    const operationId = ++this.operationId
    let before: WindowState | null = null
    notifyDiagnostic(this.diagnostic, { event: 'vault-update-queued', operationId, source, reason })
    const result = this.queue.then(async () => {
      before = this.data.window ? { ...this.data.window } : null
      await this.report({ event: 'vault-update-start', operationId, source, reason, before })
      if (!this.loaded || this.broken) throw new DeckError('vault/corrupt', '原配置尚未安全读取，拒绝覆盖。')
      if (!this.cipher.isEncryptionAvailable()) throw new DeckError('vault/unavailable', '系统加密不可用，未保存任何明文凭据。')
      const next = savedClient(change(this.snapshot()))
      for (const server of next.servers) assertServerIdentity(server)
      const windowChanged = JSON.stringify(before) !== JSON.stringify(next.window)
      await this.report({ event: 'vault-update-prepared', operationId, source, reason, before, after: next.window, windowChanged })
      const plaintext = JSON.stringify(next)
      if (Buffer.byteLength(plaintext, 'utf8') > 3 * 1024 * 1024) throw new DeckError('vault/full', '客户端配置过大，未覆盖原文件。')
      let data: string
      try { data = this.cipher.encryptString(plaintext).toString('base64') }
      catch { throw new DeckError('vault/encryption-failed', '系统加密失败，未写入明文或覆盖原配置；请检查当前 Windows 用户的系统加密环境。') }
      const temporary = `${this.file}.tmp-${randomUUID()}`
      try {
        await mkdir(path.dirname(this.file), { recursive: true })
        await writeFile(temporary, `${JSON.stringify({ format: 'dsbotdeck-v1', data })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await rename(temporary, this.file)
      } catch {
        await unlink(temporary).catch(() => {})
        throw new DeckError('vault/write-failed', '客户端配置未能保存，原记录仍保留；请检查此用户对客户端数据目录的写入权限。')
      }
      this.data = next
      await this.report({ event: 'vault-update-success', operationId, source, reason, before, after: next.window, windowChanged })
      return this.snapshot()
    }).catch(async error => {
      await this.report({ event: 'vault-update-failed', operationId, source, reason, before, after: this.data.window, errorCode: diagnosticErrorCode(error) })
      throw error
    })
    this.queue = result.then(() => {}, () => {})
    return result
  }
}
