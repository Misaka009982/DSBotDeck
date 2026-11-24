// SPDX-License-Identifier: Apache-2.0
// 固定调用系统自带 Windows PowerShell；没有超时、自动重试或普通确认框降级。
import { execFile } from 'node:child_process'
import path from 'node:path'
import { record } from '../shared/validation.ts'
import type { UnlockProvider, UnlockRequest } from './request-gate.ts'
export class WindowsUnlock implements UnlockProvider {
  private readonly script: string
  private readonly owner: () => Buffer | null
  private queue: Promise<void> = Promise.resolve()
  constructor(script: string, owner: () => Buffer | null) { this.script = script; this.owner = owner }
  verify(request: UnlockRequest): Promise<boolean> {
    const task = this.queue.then(() => this.run(request))
    this.queue = task.then(() => {}, () => {})
    return task
  }
  private run(request: UnlockRequest): Promise<boolean> {
    if (process.platform !== 'win32' || request.allowed?.() === false) return Promise.resolve(false)
    const handle = this.owner()
    if (handle === null || handle.length < 4) return Promise.resolve(false)
    const windowHandle = handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0))
    const root = process.env.SystemRoot
    if (!root || !path.isAbsolute(root)) return Promise.resolve(false)
    const executable = path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const message = Buffer.from(`DSBotDeck：验证后向「${request.serverAlias.slice(0, 80)}」执行 ${request.endpoint}。`, 'utf8').toString('base64')
    return new Promise(resolve => {
      execFile(executable, ['-NoProfile', '-NonInteractive', '-STA', '-File', this.script, '-WindowHandle', windowHandle, '-MessageBase64', message], { windowsHide: true, encoding: 'utf8', maxBuffer: 65536 }, (error, stdout) => {
        if (error) { resolve(false); return }
        try { resolve(record(JSON.parse(stdout.trim().replace(/^\uFEFF/, '')))?.status === 'Verified') }
        catch { resolve(false) }
      })
    })
  }
}
