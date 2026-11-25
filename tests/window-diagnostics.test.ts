// SPDX-License-Identifier: Apache-2.0
// 只用虚构窗口与临时目录验证诊断，不读取用户配置、不启动 Electron。
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { configurationFileStamp, diagnosticErrorCode, notifyDiagnostic, windowGeometry, WindowDiagnostics } from '../src/main/window-diagnostics.ts'
import type { WindowDiagnosticRecord } from '../src/main/window-diagnostics.ts'

const rectangle = { x: -1400, y: 80, width: 720, height: 540 }
const state = { ...rectangle, maximized: false }
const rows = async (file: string): Promise<Record<string, unknown>[]> => (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))

test('诊断只输出白名单窗口与文件字段，额外凭据、路径和错误正文不入日志', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'window-state.jsonl'); const diagnostics = new WindowDiagnostics(file, '0.1.5')
    const report = { event: 'vault-update-prepared' as const, source: 'window-state' as const, before: { ...state, privateKey: '虚构私钥不可入日志' }, after: { ...state, width: 736, token: '虚构令牌不可入日志' }, windowChanged: true, secret: '虚构额外凭据不可入日志', errorMessage: '虚构异常正文不可入日志', filePath: 'C:/fixtures/private-file.json' }
    diagnostics.record(report); await diagnostics.flush()
    const encoded = await readFile(file, 'utf8'); const [row] = await rows(file)
    for (const forbidden of ['虚构私钥', '虚构令牌', '虚构额外凭据', '虚构异常正文', 'private-file']) assert.equal(encoded.includes(forbidden), false)
    assert.deepEqual(row.before, state); assert.deepEqual(row.after, { ...state, width: 736 })
    assert.equal(row.source, 'window-state'); assert.equal(row.windowChanged, true)
    assert.equal(row.schema, 1); assert.equal(row.version, '0.1.5'); assert.equal(typeof row.session, 'string'); assert.equal(typeof row.pid, 'number')
    assert.equal(row.sequence, 1); assert.ok(Number.isFinite(Date.parse(String(row.at))))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('重开追加到同一日志，以会话标识区分多轮启动而不覆盖上一轮', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'window-state.jsonl')
    const first = new WindowDiagnostics(file, '0.1.5'); first.record({ event: 'session-start', saved: state }); await first.flush()
    const second = new WindowDiagnostics(file, '0.1.5'); second.record({ event: 'session-start', saved: { ...state, width: 736 } }); await second.flush()
    const saved = await rows(file)
    assert.equal(saved.length, 2); assert.notEqual(saved[0].session, saved[1].session)
    assert.deepEqual(saved[0].saved, state); assert.deepEqual(saved[1].saved, { ...state, width: 736 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('日志轮换只保留当前和两份旧记录，各文件不超预算且逐行完整', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'window-state.jsonl'); const diagnostics = new WindowDiagnostics(file, '0.1.5', 1024)
    for (let index = 0; index < 60; index++) diagnostics.record({ event: 'session-start', operationId: index + 1 })
    await diagnostics.flush()
    const names = await readdir(directory)
    assert.deepEqual(names.sort(), ['window-state.jsonl', 'window-state.jsonl.1', 'window-state.jsonl.2'].sort())
    for (const name of names) {
      const encoded = await readFile(path.join(directory, name), 'utf8')
      assert.ok(Buffer.byteLength(encoded, 'utf8') <= 1024); assert.ok(encoded.endsWith('\n'))
      assert.ok((await rows(path.join(directory, name))).length > 0)
    }
    const latest = await rows(file); assert.equal(latest.at(-1)?.operationId, 60)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('日志目标不是普通文件时拒绝写入，诊断失败不抛给原操作', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'window-state.jsonl'); await mkdir(file)
    const marker = path.join(file, 'marker.txt'); await writeFile(marker, '不可覆盖的虚构内容', 'utf8')
    const diagnostics = new WindowDiagnostics(file, '0.1.5'); diagnostics.record({ event: 'session-start' })
    await assert.doesNotReject(diagnostics.flush())
    assert.equal(diagnostics.problem, 'diagnostics/refused'); assert.equal(await readFile(marker, 'utf8'), '不可覆盖的虚构内容')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('配置文件观测只返回存在状态与元数据，不返回加密文件内容', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'client.vault.json')
    assert.equal((await configurationFileStamp(file)).state, 'missing')
    await writeFile(file, '虚构加密内容不应被日志读取', 'utf8')
    const stamp = await configurationFileStamp(file)
    assert.equal(stamp.state, 'file'); assert.equal(stamp.size, Buffer.byteLength('虚构加密内容不应被日志读取', 'utf8'))
    assert.equal(typeof stamp.mtimeMs, 'number'); assert.equal(typeof stamp.ctimeMs, 'number')
    assert.equal(JSON.stringify(stamp).includes('虚构加密内容'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('窗口几何同时保留外框、内容与还原矩形，显示器标签和额外数据被丢弃', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'window-state.jsonl'); const diagnostics = new WindowDiagnostics(file, '0.1.5')
    const window = { isDestroyed: () => false, isVisible: () => true, isMaximized: () => false, isMinimized: () => false, isFullScreen: () => false, getBounds: () => rectangle, getNormalBounds: () => ({ ...rectangle, width: 700 }), getContentBounds: () => ({ ...rectangle, x: -1392, y: 88, width: 704, height: 524 }), getMinimumSize: (): number[] => [480, 320] }
    const display = { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.5, label: '虚构显示器名称不入日志' }
    const physical = { x: -2100, y: 120, width: 1080, height: 810 }
    const geometry = windowGeometry(window, () => display, value => { assert.deepEqual(value, rectangle); return physical })
    diagnostics.record({ event: 'window-event', reason: 'resize', geometry }); await diagnostics.flush()
    const [row] = await rows(file); const saved = row.geometry as Record<string, unknown>
    assert.deepEqual(saved.outer, rectangle); assert.deepEqual(saved.physical, physical)
    assert.deepEqual(saved.normal, { ...rectangle, width: 700 })
    assert.deepEqual(saved.content, { ...rectangle, x: -1392, y: 88, width: 704, height: 524 })
    assert.deepEqual(saved.minimum, { width: 480, height: 320 })
    assert.equal((saved.display as Record<string, unknown>).scaleFactor, 1.5)
    assert.equal(JSON.stringify(row).includes('虚构显示器名称'), false)
    assert.equal(windowGeometry({ ...window, isDestroyed: () => true }, () => display), null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('观察回调异常不改变原调用结果，也不把错误正文写入日志', () => {
  const trace = (_entry: WindowDiagnosticRecord) => { throw new Error('虚构敏感异常正文') }
  assert.doesNotThrow(() => notifyDiagnostic(trace, { event: 'tracker-capture', captured: state }))
  const captured = { ...state }
  notifyDiagnostic(entry => { if (entry.captured) entry.captured.width = 2000 }, { event: 'tracker-capture', captured })
  assert.deepEqual(captured, state)
  assert.equal(diagnosticErrorCode({ get code() { throw new Error('虚构敏感读取故障') } }), 'unknown')
})
test('窗口事件突发超过积压预算，丢失数量明确记录而不无限排队', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsbotdeck-window-diagnostics-'))
  try {
    const file = path.join(directory, 'window-state.jsonl'); const diagnostics = new WindowDiagnostics(file, '0.1.5')
    for (let index = 0; index < 1040; index++) diagnostics.record({ event: 'window-event', reason: 'resize' })
    await diagnostics.flush()
    const saved = await rows(file)
    assert.equal(saved.length, 1025); assert.equal(saved.at(-1)?.event, 'log-overflow'); assert.equal(saved.at(-1)?.dropped, 16)
    assert.equal(diagnostics.problem, null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
