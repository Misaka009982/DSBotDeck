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
    const encoded = await readFile(file, 'utf8')
    assert.equal(encoded.includes('enabled'), false)
    const loaded = await new Vault(file, cipher).load()
    assert.equal(loaded.pet.enabled, true); assert.equal(loaded.pet.locked, true)
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
