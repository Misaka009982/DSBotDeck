// SPDX-License-Identifier: Apache-2.0
// 使用临时目录与虚构数据，不接触用户的 DS-Bot 或 DSH 数据。
import { strict as assert } from 'node:assert'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Vault } from '../src/main/vault.ts'
import type { StringCipher } from '../src/main/vault.ts'
import type { WindowDiagnosticRecord } from '../src/main/window-diagnostics.ts'
class FixtureCipher implements StringCipher {
  available = true
  private readonly key = randomBytes(32)
  isEncryptionAvailable() { return this.available }
  encryptString(value: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), body])
  }
  decryptString(value: Buffer) {
    const cipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(0, 12))
    cipher.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
  }
}
test('存储序列化更新，不在文件中保留明文配置', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-vault-'))
  try {
    const file = path.join(directory, 'client.vault.json'); const cipher = new FixtureCipher(); const vault = new Vault(file, cipher)
    await vault.load()
    await Promise.all([vault.update(value => ({ ...value, pet: { ...value.pet, enabled: true } })), vault.update(value => ({ ...value, pet: { ...value.pet, locked: true } }))])
    const window = { x: -1400, y: 60, width: 1200, height: 800, maximized: true }
    await vault.update(value => ({ ...value, window, appearance: { ...value.appearance, theme: 'paper', themeMode: 'dark', backgroundPath: 'C:/fixtures/background.webp', backgroundCrop: { cx: 0.3, cy: 0.7, zoom: 2 }, opacity: 0.6 }, pet: { ...value.pet, skin: 'fixture-pet', size: 128 } }))
    const encoded = await readFile(file, 'utf8')
    assert.equal(encoded.includes('enabled'), false); assert.equal(encoded.includes('background.webp'), false)
    const loaded = await new Vault(file, cipher).load()
    assert.equal(loaded.pet.enabled, true); assert.equal(loaded.pet.locked, true)
    assert.equal(loaded.pet.skin, 'fixture-pet'); assert.equal(loaded.pet.size, 128)
    assert.equal(loaded.appearance.theme, 'paper'); assert.equal(loaded.appearance.themeMode, 'dark')
    assert.deepEqual(loaded.appearance.backgroundCrop, { cx: 0.3, cy: 0.7, zoom: 2 })
    assert.equal(loaded.appearance.backgroundPath, 'C:/fixtures/background.webp'); assert.equal(loaded.appearance.opacity, 0.6)
    assert.deepEqual(loaded.window, window)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('加密不可用不降级，损坏记录不覆写', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-vault-'))
  try {
    const file = path.join(directory, 'client.vault.json'); const cipher = new FixtureCipher(); const vault = new Vault(file, cipher)
    await vault.load(); cipher.available = false
    await assert.rejects(vault.update(value => value), /明文|加密不可用/)
    await writeFile(file, 'fictional-corrupt-record', 'utf8'); cipher.available = true
    const broken = new Vault(file, cipher)
    await assert.rejects(broken.load(), /未重置/)
    await assert.rejects(broken.update(value => value), /覆盖/)
    assert.equal(await readFile(file, 'utf8'), 'fictional-corrupt-record')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('真实配置写入记录来源、窗口字段变化与替换前后文件元数据', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-vault-diagnostics-'))
  try {
    const file = path.join(directory, 'client.vault.json'); const reports: WindowDiagnosticRecord[] = []
    const vault = new Vault(file, new FixtureCipher(), entry => { reports.push(entry) }); await vault.load()
    const window = { x: 180, y: 100, width: 720, height: 540, maximized: false }
    await vault.update(value => ({ ...value, window }), 'window-state', 'before-quit')
    await vault.update(value => ({ ...value, pet: { ...value.pet, enabled: true } }), 'pet-settings')
    const prepared = reports.filter(entry => entry.event === 'vault-update-prepared')
    const written = reports.filter(entry => entry.event === 'vault-update-success')
    assert.equal(prepared.length, 2); assert.equal(written.length, 2)
    assert.equal(prepared[0].source, 'window-state'); assert.equal(prepared[0].reason, 'before-quit')
    assert.equal(prepared[0].windowChanged, true); assert.equal(prepared[1].windowChanged, false)
    assert.deepEqual(prepared[0].before, null); assert.deepEqual(prepared[0].after, window)
    assert.deepEqual(prepared[1].before, window); assert.deepEqual(prepared[1].after, window)
    assert.equal(written[0].file?.state, 'file'); assert.ok((written[0].file?.size ?? 0) > 0)
    assert.equal(written[1].source, 'pet-settings'); assert.equal(written[1].operationId, 2)
    assert.ok(reports.some(entry => entry.event === 'vault-update-start' && entry.operationId === 1 && entry.file?.state === 'missing'))
    assert.equal(JSON.stringify(reports).includes('enabled'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('配置诊断回调失败不阻止加密保存，失败记录不泄露异常正文', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-vault-diagnostics-'))
  try {
    const file = path.join(directory, 'client.vault.json'); const cipher = new FixtureCipher()
    const vault = new Vault(file, cipher, () => { throw new Error('虚构敏感观测故障') }); await vault.load()
    await vault.update(value => ({ ...value, window: { x: 100, y: 100, width: 720, height: 540, maximized: false } }), 'window-state', 'close')
    const reports: WindowDiagnosticRecord[] = []; const loaded = new Vault(file, cipher, entry => { reports.push(entry) }); await loaded.load()
    cipher.available = false
    await assert.rejects(loaded.update(value => value, 'window-state'), /加密不可用/)
    const failure = reports.find(entry => entry.event === 'vault-update-failed')
    assert.equal(failure?.errorCode, 'vault/unavailable'); assert.equal(failure?.source, 'window-state')
    assert.equal(JSON.stringify(reports).includes('虚构敏感'), false)
    assert.ok((await readFile(file, 'utf8')).startsWith('{"format":"dsbotdeck-v1"'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
