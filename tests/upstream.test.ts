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
const systemTheme = "const dark = matchMedia('(prefers-color-scheme: dark)')\nconst paint = () => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }\npaint()\ndark.addEventListener('change', paint)"
test('交换记录只读接入原按钮与弹窗，缺来源、拒绝和失败不伪装正常', async () => {
  const names = ['ds-bot/src/client/cells.js', 'ds-bot/src/client/exchange.js', 'ds-bot/src/client/team-actions.js']
  const adapted = new Map<string, string>()
  for (const name of names) {
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    const next = paintSource(raw, path.join(source, name), source) ?? ''
    adapted.set(name, next)
    assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), next)
    assert.throws(() => paintSource(`${raw}\n${raw}`, path.join(source, name), source), /结构已变化/)
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
  }
  const cells = adapted.get(names[0]) ?? ''; const exchange = adapted.get(names[1]) ?? ''
  assert.ok(cells.includes('h(PeerEvent, { key, prefix, other, selfId, sessionId, roster, actions, EventLine })'))
  assert.ok(exchange.includes('exchangeRows(raw)')); assert.ok(exchange.includes('setFailure(exchangeFailure(error))'))
  assert.ok(exchange.includes('if (stop) return')); assert.ok(exchange.includes('setEntries(null)'))
  assert.ok(exchange.includes('clearTimeout(timer)')); assert.ok(exchange.includes('[pair[0], pair[1], retry]'))
  assert.ok(exchange.includes('重新读取')); assert.ok(exchange.includes("t('No messages yet')"))
  assert.ok(exchange.includes('actions.exchangeText(entry.id, entry.from, entry.to)'))
  const actions = adapted.get(names[2]) ?? ''
  assert.ok(actions.includes("exchange: (a, b) => call('exchange', { a, b }),"))
  assert.equal(actions.includes("call('exchange', { a, b }).catch(() => [])"), false)
  assert.equal(actions.includes("call('exchange-text', { id, ...(a !== undefined && b !== undefined ? { a, b } : {}) }).catch(() => undefined)"), false)
  assert.equal(adaptUiSource('@dsbotdeck/chat-model', undefined, client, source), path.join(client, 'src/shared/chat-model.ts'))
  assert.equal(adaptUiSource('@dsbotdeck/peer-event', undefined, client, source), path.join(client, 'src/remote/peer-event.js'))
})
test('私聊目标只适配固定Bot设置卡片和全量状态刷新，不改群目标或创建原生Goal', async () => {
  const formName = 'ds-bot/src/client/bot-settings.js'; const teamName = 'app/ui/src/team.js'
  const formRaw = await readFile(new URL(`../../DS-Bot/${formName}`, import.meta.url), 'utf8')
  const form = paintSource(formRaw, path.join(source, formName), source) ?? ''
  assert.ok(form.includes("import { PrivateGoalSettings } from '@dsbotdeck/private-goal'"))
  assert.equal(form.split('h(PrivateGoalSettings,').length - 1, 1)
  assert.ok(form.includes('botId: bot.id, Card'))
  assert.ok(form.includes('h(BotCapabilitiesCard,')); assert.ok(form.includes('h(BotSchedules,'))
  const teamRaw = await readFile(new URL(`../../DS-Bot/${teamName}`, import.meta.url), 'utf8')
  const team = paintSource(teamRaw, path.join(source, teamName), source) ?? ''
  assert.ok(team.includes('deckRefreshGoals: async signal'))
  assert.ok(team.includes('await pull(true, signal)')); assert.ok(team.includes('return roster.getSnapshot()'))
  assert.ok(team.includes('since: full ? -1 : known.revision'))
  assert.ok(team.includes('signal?.aborted || value.unchanged'))
  assert.ok(team.includes('!Number.isSafeInteger(value.revision)'))
  assert.ok(team.includes('order < applied || value.revision < roster.getSnapshot().revision'))
  assert.ok(team.includes('!full && value.revision === current.revision'))
  assert.equal(adaptUiSource('@dsbotdeck/private-goal', undefined, client, source), path.join(client, 'src/remote/private-goal.js'))
  for (const [name, raw] of [[formName, formRaw], [teamName, teamRaw]]) {
    assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), paintSource(raw, path.join(source, name), source))
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
  }
})
test('聊天菜单只读接入原输入框，提及和动作不借DSH服务或伪造发送', async () => {
  const name = 'app/ui/src/chat.js'; const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
  const next = paintSource(raw, path.join(source, name), source) ?? ''
  assert.ok(next.includes("import { useComposerMenu } from '@dsbotdeck/composer-menu'"))
  assert.ok(next.includes('const menu = useComposerMenu({ sessionId, text, setText, field, disabled, actions, useRoster, onError: setError })'))
  assert.ok(next.includes('menu.content')); assert.ok(next.includes('...menu.inputProps'))
  assert.ok(next.includes('if (menu.onKeyDown(event)) return'))
  assert.ok(next.includes('if (!menu.runCommand(value)) await onSend(value)'))
  assert.ok(next.includes('menu.isBlocked()')); assert.ok(next.includes('menu.onSelect()'))
  assert.ok(next.includes('event.nativeEvent.isComposing')); assert.ok(next.includes('event.keyCode !== 229'))
  assert.equal(next.includes('ctx.inputTriggers'), false); assert.equal(next.includes('ctx.commandUi'), false)
  assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), next)
  assert.throws(() => paintSource(raw.replace('  const inputActions = useInput(field, setText)', 'changed input'), path.join(source, name), source), /结构已变化/)
  assert.throws(() => paintSource(raw.replace("    if (value === '' || disabled) return", 'changed submit'), path.join(source, name), source), /结构已变化/)
  assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
  assert.equal(adaptUiSource('@dsbotdeck/composer-menu', undefined, client, source), path.join(client, 'src/remote/composer-menu.js'))
})
test('入口只在内存中去掉原 App 挂载与强制系统明暗监听', () => {
  const original = `import { App } from './app.js'\n${systemTheme}\ncreateRoot(document.getElementById('root')).render(h(App))\ninstallStyles(text)`
  const next = bootstrapText(original)
  assert.ok(!next.includes('render(h(App))'))
  assert.equal(next.includes('matchMedia('), false)
  assert.ok(next.includes('installStyles(text)'))
  assert.ok(original.includes('render(h(App))')); assert.ok(original.includes(systemTheme))
})
test('上游入口变化时停止而不是猜测替换', () => {
  assert.throws(() => bootstrapText('mountAnotherApp()'), /入口已变化/)
})
test('真实入口的系统明暗适配兼容 CRLF，锚点变化或重复时停止', async () => {
  const raw = await readFile(new URL('../../DS-Bot/app/ui/src/main.js', import.meta.url), 'utf8')
  const next = bootstrapText(raw)
  assert.equal(bootstrapText(raw.replace(/\r?\n/g, '\r\n')), next)
  assert.equal(next.includes("dark.addEventListener('change', paint)"), false)
  assert.throws(() => bootstrapText(raw.replace("const dark = matchMedia('(prefers-color-scheme: dark)')", 'changed system theme')), /系统明暗.*已变化/)
  assert.throws(() => bootstrapText(`${raw}\n${systemTheme}`), /系统明暗.*已变化/)
  assert.equal(await readFile(new URL('../../DS-Bot/app/ui/src/main.js', import.meta.url), 'utf8'), raw)
})
test('原主题预览组件只在构建内存中导出，不复制上游界面', async () => {
  const raw = await readFile(new URL('../../DS-Bot/ds-bot/src/client/settings.js', import.meta.url), 'utf8')
  const next = paintSource(raw, path.join(source, 'ds-bot/src/client/settings.js'), source)
  assert.ok(next?.includes('export function ThemeGallery('))
  assert.equal(raw.includes('export function ThemeGallery('), false)
  assert.throws(() => paintSource(raw.replace('function ThemeGallery(', 'export function ThemeGallery('), path.join(source, 'ds-bot/src/client/settings.js'), source), /结构已变化/)
  assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, 'ds-bot/src/client/settings.js'), source), next)
  assert.equal(await readFile(new URL('../../DS-Bot/ds-bot/src/client/settings.js', import.meta.url), 'utf8'), raw)
})
test('UI 接入只替换入口与 primitives', () => {
  const main = path.join(source, 'app/ui/src/main.js')
  assert.equal(adaptUiSource('./app.js', main, client, source), path.join(client, 'src/remote/app.js'))
  assert.equal(adaptUiSource('./chat.js', path.join(source, 'app/ui/src/app.js'), client, source), null)
  assert.equal(adaptUiSource('./dsh-primitives.js', path.join(source, 'ds-bot/src/client/cells.js'), client, source), path.join(source, 'app/ui/src/primitives.js'))
  assert.equal(adaptUiSource('@dsbot/bootstrap', undefined, client, source), BOOTSTRAP_ID)
  assert.equal(adaptUiSource('@dsbot/themes', undefined, client, source), path.join(source, 'ds-bot/src/client/themes.js'))
})
test('普通私聊审批只读接入输入区，允许一次和拒绝仍使用原接口', async () => {
  const names = ['app/ui/src/chat.js', 'ds-bot/src/client/member-status.js']
  const adapted = new Map<string, string>()
  for (const name of names) {
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    const next = paintSource(raw, path.join(source, name), source)
    assert.ok(next !== null)
    assert.equal(paintSource(raw.replace(/\r?\n/g, '\r\n'), path.join(source, name), source), next)
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
    assert.throws(() => paintSource(`${raw}\n${raw}`, path.join(source, name), source), /结构已变化/)
    adapted.set(name, next)
  }
  const chat = adapted.get(names[0]) ?? ''
  assert.ok(chat.includes('foregroundApprovals(work, bot?.id, sessionId)'))
  assert.ok(chat.includes('room === undefined'))
  assert.ok(chat.includes('h(ApprovalCard, { key: approval.id, approval, bot, actions, showBot: true })'))
  assert.ok(chat.includes('deck-chat-approvals')); assert.ok(chat.includes('[view.items, stream, pending, running, question, approvalKey]'))
  const cards = adapted.get(names[1]) ?? ''
  assert.ok(cards.includes('approval.answerable === true'))
  assert.equal(cards.includes('approval.answerable && (approval.roomId !== undefined || approval.taskId !== undefined)'), false)
  assert.ok(cards.includes("answer('allow')")); assert.ok(cards.includes("answer('reject')"))
  assert.ok(cards.includes('disabled: busy')); assert.ok(cards.includes('actions.answerApproval(approval.id, choice)'))
  assert.equal(adaptUiSource('@dsbotdeck/approval-model', undefined, client, source), path.join(client, 'src/shared/approval-model.ts'))
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
  assert.ok(taskNext?.includes("import { TaskResourceEntries } from '@dsbotdeck/resource-entry'"))
  assert.ok(taskNext?.includes('h(TaskResourceEntries, { botId, taskId, sessionId: page?.sessionId ?? task.sessionId })'))
  assert.equal(adaptUiSource('@dsbotdeck/resource-entry', undefined, client, source), path.join(client, 'src/remote/resource-entry.js'))
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
  assert.ok(cells.includes("case 'steps': return h(ToolSteps, { key: toolGroupKey(row, sessionId, key), entry: row"))
  assert.ok(cells.includes('toolHistory.current.group(rows, { sessionId })'))
  assert.ok(cells.includes('return displayRows.flatMap(')); assert.ok(cells.includes('const key = displayRows.length - index'))
  const tasks = adapted.get(names[2]) ?? ''
  assert.ok(tasks.includes('const [showSteps, setShowSteps] = useState(true)'))
  assert.ok(tasks.includes('return h(ToolSteps, { key: toolGroupKey(entry, page?.sessionId, key), entry,'))
  assert.ok(tasks.includes('toolHistory.current.group(items, { sessionId: page?.sessionId, targetId: taskId })'))
  assert.ok(tasks.includes('displayItems.map(')); assert.ok(tasks.includes('scope: { botId, taskId, sessionId: page?.sessionId }'))
  assert.ok(tasks.includes("t('Hide steps')")); assert.ok(tasks.includes('actions.deckTaskPaint?.'))
  assert.ok(tasks.includes('if (!showSteps || tools.length === 0) return null'))
  assert.ok(tasks.includes('useLayoutEffect(() => {\n    setLoadingMore(false)\n    reqGenRef.current += 1'))
  assert.ok(tasks.includes("fullMessages && errorCode(err) === 'bot/refused'"))
  assert.ok(tasks.includes('setPage(null); setOlder([]); setOlderCursor({ active: false, cursor: null })'))
  assert.ok(tasks.includes('setError(extraReadFailure(err))'))
  assert.equal(tasks.split('noteReadError(err)').length - 1, 2)
  assert.equal(adaptUiSource('@dsbotdeck/tool-steps', undefined, client, source), path.join(client, 'src/remote/tool-steps.js'))
  assert.equal(adaptUiSource('@dsbotdeck/tool-refresh', undefined, client, source), path.join(client, 'src/shared/tool-refresh.ts'))
})
test('增补读取保留原群DTO适配和分页，拒绝不吞，完整消息变化释放原历史', async () => {
  const names = ['app/ui/src/chat.js', 'ds-bot/src/client/team-actions.js', 'ds-bot/src/client/browser-pane.js']
  const next = new Map<string, string>()
  for (const name of names) {
    const raw = await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8')
    const transformed = paintSource(raw, path.join(source, name), source) ?? ''
    assert.equal(await readFile(new URL(`../../DS-Bot/${name}`, import.meta.url), 'utf8'), raw)
    next.set(name, transformed)
  }
  const chat = next.get(names[0]) ?? ''; const actions = next.get(names[1]) ?? ''; const pane = next.get(names[2]) ?? ''
  assert.ok(chat.includes("readExtraPage(call, 'extra-messages'")); assert.ok(chat.includes('fullMessages }, () => roomId !== undefined'))
  assert.ok(chat.includes('export function adaptRoomItem(item)')); assert.ok(chat.includes('mergeLatestPage(current.items, current.cursor, mergedItems, page.cursor)'))
  assert.ok(chat.includes('setFailure({ message: extraReadFailure(error), cursor })'))
  assert.ok(chat.includes("fullMessages && errorCode(error) === 'bot/refused' ? { items: [], sessionId: null }"))
  assert.ok(chat.includes('useChat(bot?.id, room?.id, sessionId, feed, extraMode.fullMessages, extraMode.state)'))
  assert.ok(chat.includes('[active, botId, roomId, part, fullMessages, extraReads]'))
  assert.ok(actions.includes("readExtraPage(call, 'extra-task-read'")); assert.ok(actions.includes("() => call('bot-task-read'"))
  assert.ok(pane.includes('fullMessages: remoteReadMode(roster).fullMessages'))
  for (const [alias, file] of [['tool-history', 'src/shared/tool-history.ts'], ['extra-read', 'src/shared/extra-read-model.ts'], ['remote-capabilities', 'src/shared/remote-capabilities.ts'], ['validation', 'src/shared/validation.ts'], ['message-note', 'src/remote/message-note.js']]) assert.equal(adaptUiSource(`@dsbotdeck/${alias}`, undefined, client, source), path.join(client, file))
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
      assert.ok(next.includes('changed.extras = value.extras'))
      assert.ok(next.indexOf('changed.extras = value.extras') < next.indexOf('if (value.unchanged ||'))
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
