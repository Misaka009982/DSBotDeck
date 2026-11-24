// SPDX-License-Identifier: Apache-2.0
// 回归定义供用户执行；本轮不运行测试。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { adaptUiSource, BOOTSTRAP_ID, bootstrapText, inside } from '../scripts/upstream.mjs'
import { paintSource, SCOPED_UI_FILES } from '../scripts/paint-source.mjs'

const client = path.resolve('DSBotDeck')
const source = path.resolve('DS-Bot')
test('入口只在内存中去掉原 App 挂载', () => {
  const original = "import { App } from './app.js'\ncreateRoot(document.getElementById('root')).render(h(App))\ninstallStyles(text)"
  const next = bootstrapText(original)
  assert.ok(!next.includes('render(h(App))'))
  assert.ok(next.includes('installStyles(text)'))
  assert.ok(original.includes('render(h(App))'))
})
test('上游入口变化时停止而不是猜测替换', () => {
  assert.throws(() => bootstrapText('mountAnotherApp()'), /入口已变化/)
})
test('UI 接入只替换入口与 primitives', () => {
  const main = path.join(source, 'app/ui/src/main.js')
  assert.equal(adaptUiSource('./app.js', main, client, source), path.join(client, 'src/remote/app.js'))
  assert.equal(adaptUiSource('./chat.js', path.join(source, 'app/ui/src/app.js'), client, source), null)
  assert.equal(adaptUiSource('./dsh-primitives.js', path.join(source, 'ds-bot/src/client/cells.js'), client, source), path.join(source, 'app/ui/src/primitives.js'))
  assert.equal(adaptUiSource('@dsbot/bootstrap', undefined, client, source), BOOTSTRAP_ID)
})
test('上游别名不能越过源码目录', () => {
  assert.throws(() => adaptUiSource('@dsbot/client/../../../outside.js', undefined, client, source), /越过/)
  assert.equal(inside(source, `${source}-other/file.js`), false)
})
test('结果视图结构变化时停止，不靠 DOM 注入猜测已读', () => {
  assert.throws(() => paintSource('changed Chat', path.join(source, 'app/ui/src/chat.js'), source), /结构已变化/)
  assert.equal(paintSource('other source', path.join(source, 'other.js'), source), null)
})
test('原聊天与任务的呈现确认仍保留，源字符串不被修改', async () => {
  const root = new URL('../../DS-Bot/', import.meta.url)
  const chat = await readFile(new URL('app/ui/src/chat.js', root), 'utf8')
  const tasks = await readFile(new URL('ds-bot/src/client/bot-tasks.js', root), 'utf8')
  const chatNext = paintSource(chat, path.join(source, 'app/ui/src/chat.js'), source)
  const taskNext = paintSource(tasks, path.join(source, 'ds-bot/src/client/bot-tasks.js'), source)
  assert.ok(chatNext?.includes('team.deckPaint?.'))
  assert.ok(taskNext?.includes('actions.deckTaskPaint?.'))
  assert.ok(!chat.includes('team.deckPaint?.')); assert.ok(!tasks.includes('actions.deckTaskPaint?.'))
})
test('Windows 的 CRLF 上游源码也能只读接入渲染确认', async () => {
  const raw = await readFile(new URL('../../DS-Bot/app/ui/src/chat.js', import.meta.url), 'utf8')
  const windows = raw.replace(/\r?\n/g, '\r\n')
  assert.ok(paintSource(windows, path.join(source, 'app/ui/src/chat.js'), source)?.includes('team.deckPaint?.'))
})
test('只读构建隐藏电脑控制与浏览器详情，保留聊天和普通 Bot 设置', async () => {
  const adapted = new Map<string, string>()
  for (const name of SCOPED_UI_FILES) {
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    const next = paintSource(raw, path.join(source, name), source)
    assert.ok(next !== null)
    assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), next)
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
    adapted.set(name, next)
  }
  const settings = adapted.get('ds-bot/src/client/settings.js') ?? ''
  assert.equal(settings.includes("['computer', 'Computer use']"), false)
  assert.ok(settings.includes("['browser', 'Browser']")); assert.ok(settings.includes("['capabilities', 'Capabilities']")); assert.ok(settings.includes("['secrets', 'Secrets']"))
  assert.ok(settings.includes("tools: 'capabilities'"))
  const form = adapted.get('ds-bot/src/client/bot-settings.js') ?? ''
  assert.equal(form.includes('h(BotComputerCard,'), false)
  assert.ok(form.includes('h(BotCapabilitiesCard,')); assert.ok(form.includes('h(MemoryCard,')); assert.ok(form.includes('h(BotSchedules,'))
  const details = adapted.get('ds-bot/src/client/details-drawer.js') ?? ''
  assert.equal(details.includes("...(bot ? ['browser'] : [])"), false)
  assert.equal(details.includes("...(bot && roster.computer?.enabled === true ? ['computer'] : [])"), false)
  assert.ok(details.includes("const activeTab = tabs.includes(tab) ? tab : 'details'")); assert.ok(details.includes('h(DetailsTaskList,')); assert.ok(details.includes('h(RunStats,'))
  const overview = adapted.get('ds-bot/src/client/settings-overview.js') ?? ''
  assert.equal(overview.includes("actions.openSettings('computer')"), false)
  assert.ok(overview.includes("actions.openSettings('capabilities')"))
})
test('控制入口接入锚点缺失或重复时停止，非目标文件保持不变', async () => {
  for (const name of SCOPED_UI_FILES) {
    const id = path.join(source, name)
    assert.throws(() => paintSource('changed UI', id, source), /结构已变化/)
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    assert.throws(() => paintSource(`${raw}\n${raw}`, id, source), /结构已变化/)
  }
  assert.equal(paintSource('other UI', path.join(source, 'other.js'), source), null)
})
test('主聊天与群聊读取工具步骤，聊天和任务使用同一只读组件', async () => {
  const names = ['app/ui/src/chat.js', 'ds-bot/src/client/cells.js', 'ds-bot/src/client/bot-tasks.js']
  const adapted = new Map<string, string>()
  for (const name of names) {
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    const next = paintSource(raw, path.join(source, name), source)
    assert.ok(next !== null)
    assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), next)
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
    adapted.set(name, next)
  }
  const chat = adapted.get(names[0]) ?? ''
  assert.ok(chat.includes("call('chat', { botId, steps: true,")); assert.ok(chat.includes("call('room-chat', { roomId, steps: true,"))
  assert.ok(chat.includes("import { watchToolSteps } from '@dsbotdeck/tool-refresh'"))
  assert.ok(chat.includes('watchToolSteps(feed, { botId, roomId, sessionId: part }'))
  assert.ok(chat.includes('loadRef.current === read')); assert.ok(chat.includes('gen.current === generation'))
  assert.ok(chat.includes("document.visibilityState === 'visible'")); assert.ok(chat.includes("document.body.hasAttribute('data-deck-cached')"))
  assert.ok(chat.includes("document.removeEventListener('visibilitychange', latest)"))
  const cells = adapted.get(names[1]) ?? ''
  assert.ok(cells.includes("case 'steps': return h(ToolSteps, { key, entry: row })"))
  const tasks = adapted.get(names[2]) ?? ''
  assert.ok(tasks.includes('const [showSteps, setShowSteps] = useState(true)'))
  assert.ok(tasks.includes('return h(ToolSteps, { key, entry })'))
  assert.ok(tasks.includes("t('Hide steps')")); assert.ok(tasks.includes('actions.deckTaskPaint?.'))
  assert.equal(adaptUiSource('@dsbotdeck/tool-steps', undefined, client, source), path.join(client, 'src/remote/tool-steps.js'))
  assert.equal(adaptUiSource('@dsbotdeck/tool-refresh', undefined, client, source), path.join(client, 'src/shared/tool-refresh.ts'))
})
test('实时工具接入普通聊天与群聊，追加输入不盖住当前服务器工具', async () => {
  for (const name of ['app/ui/src/team.js', 'ds-bot/src/client/activity-row.js']) {
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    const next = paintSource(raw, path.join(source, name), source)
    assert.ok(next !== null)
    assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), next)
    assert.throws(() => paintSource('changed UI', path.join(source, name), source), /结构已变化/)
    assert.throws(() => paintSource(`${raw}\n${raw}`, path.join(source, name), source), /结构已变化/)
    if (name.endsWith('team.js')) {
      assert.ok(next.includes('workToolNote(doing)'))
      assert.ok(next.includes('workToolNote(rooms[room.id], r.byId)'))
    } else assert.ok(next.includes('preferInputStatus(inputAt, tool)'))
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
  }
  assert.equal(adaptUiSource('@dsbotdeck/tool-model', undefined, client, source), path.join(client, 'src/shared/tool-model.ts'))
  assert.equal(adaptUiSource('@dsbot/characters', undefined, client, source), path.join(source, 'ds-bot/src/client/characters.js'))
})
test('工具展示接入结构变化时停止，不猜测界面入口', () => {
  for (const name of ['app/ui/src/chat.js', 'ds-bot/src/client/cells.js', 'ds-bot/src/client/bot-tasks.js']) assert.throws(() => paintSource('changed UI', path.join(source, name), source), /结构已变化/)
})
test('安装包依赖不带 DSH 与本地运行引擎', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]
  assert.equal(names.some(name => name.includes('@deepseek-ai/') || name === 'ds-bot' || /node-pty|python|libreoffice|playwright/.test(name)), false)
})
test('NodeNext ESM 从只读上游解析到客户端的真实加密类型', () => {
  const configFile = fileURLToPath(new URL('../tsconfig.json', import.meta.url))
  const loaded = ts.readConfigFile(configFile, ts.sys.readFile)
  assert.equal(loaded.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configFile), undefined, configFile)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.options.moduleResolution, ts.ModuleResolutionKind.NodeNext)
  const imports = [
    { file: 'link/src/keys.ts', name: '@noble/curves/ed25519', types: '@noble/curves/ed25519.d.ts' },
    { file: 'link/src/keys.ts', name: '@noble/hashes/sha256', types: '@noble/hashes/sha256.d.ts' },
    { file: 'link/src/keys.ts', name: '@noble/ciphers/webcrypto', types: '@noble/ciphers/webcrypto.d.ts' },
    { file: 'link/src/noise.ts', name: '@lukeburns/clatterjs', types: '@lukeburns/clatterjs/dist/index.d.ts' },
    { file: 'link/src/noise.ts', name: '@noble/ciphers/webcrypto', types: '@noble/ciphers/webcrypto.d.ts' },
  ]
  for (const entry of imports) {
    const from = fileURLToPath(new URL(`../../DS-Bot/${entry.file}`, import.meta.url))
    // 必须显式走 import 模式；require 模式会误放行旧的无扩展名路径和目录映射。
    const resolved = ts.resolveModuleName(entry.name, from, parsed.options, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule
    assert.ok(resolved, `${entry.file} 的 ESM 导入 ${entry.name} 未能解析`)
    const expected = fileURLToPath(new URL(`../node_modules/${entry.types}`, import.meta.url))
    assert.equal(path.normalize(resolved.resolvedFileName), path.normalize(expected))
  }
  assert.equal(parsed.options.paths?.['@noble/*'], undefined, '不得改写 clatterjs 自身使用的嵌套 @noble 版本')
})
