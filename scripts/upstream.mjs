// SPDX-License-Identifier: Apache-2.0
// 构建接入只读取上游；入口变换发生在内存中，不生成上游补丁。
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { paintSource, SCOPED_UI_FILES } from './paint-source.mjs'

export const REFERENCE_COMMIT = 'd104d9ca18d69a35460f14e15dff4d553181433a'
export const BOOTSTRAP_ID = '\0dsbotdeck-bootstrap'
export const UI_PACKAGES = new Set(['react', 'react-dom', 'qrcode-generator', 'deep-view', 'react-markdown', 'remark-gfm', '@xterm/xterm', '@xterm/addon-fit'])
const REQUIRED = [
  'app/ui/src/main.js', 'app/ui/src/app.js', 'app/ui/src/team.js', 'app/ui/src/chat.js',
  'app/ui/src/primitives.js', 'ds-bot/package.json', 'ds-bot/src/client/api.js', 'ds-bot/src/client/themes.js',
  'ds-bot/src/client/mark.js', 'ds-bot/src/client/overlays.js', 'ds-bot/src/client/bot-tasks.js', 'ds-bot/src/client/cells.js', 'ds-bot/src/client/activity-row.js',
  'ds-bot/src/client/at-menu.js', 'ds-bot/src/client/command-actions.js',
  ...SCOPED_UI_FILES,
  'ds-bot/src/shared/browser-endpoints.js', 'mobile/src/team/gated.ts',
  'mobile/src/team/notices.ts', 'link/src/index.ts', 'LICENSE', 'NOTICE',
]
const slash = value => value.replaceAll('\\', '/')

export function inside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function bootstrapText(source) {
  source = source.replaceAll('\r\n', '\n')
  const mount = "createRoot(document.getElementById('root')).render(h(App))"
  const appImport = "import { App } from './app.js'"
  if (!source.includes(mount) || !source.includes(appImport)) {
    throw new Error('上游 UI 启动入口已变化，请更新 DSBotDeck 的入口适配；未修改上游文件。')
  }
  const systemTheme = "const dark = matchMedia('(prefers-color-scheme: dark)')\nconst paint = () => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }\npaint()\ndark.addEventListener('change', paint)"
  if (source.split(systemTheme).length !== 2) throw new Error('上游 UI 系统明暗入口已变化，请更新只读主题适配；未修改上游文件。')
  return source.replace(appImport, '').replace(mount, '').replace(systemTheme, '// 明暗由 Deck 本机设置统一控制，不保留上游强制跟随系统的监听。')
}

export function adaptUiSource(specifier, importer, clientRoot, sourceRoot) {
  const main = path.join(sourceRoot, 'app/ui/src/main.js')
  if (specifier === '@dsbot/characters') return path.join(sourceRoot, 'ds-bot/src/client/characters.js')
  if (specifier === '@dsbot/themes') return path.join(sourceRoot, 'ds-bot/src/client/themes.js')
  if (specifier === '@dsbot/bootstrap') return BOOTSTRAP_ID
  if (specifier === '@dsbotdeck/header-actions') return path.join(clientRoot, 'src/remote/header-actions.js')
  if (specifier === '@dsbotdeck/private-goal') return path.join(clientRoot, 'src/remote/private-goal.js')
  if (specifier === '@dsbotdeck/composer-menu') return path.join(clientRoot, 'src/remote/composer-menu.js')
  if (specifier === '@dsbotdeck/peer-event') return path.join(clientRoot, 'src/remote/peer-event.js')
  if (specifier === '@dsbotdeck/chat-model') return path.join(clientRoot, 'src/shared/chat-model.ts')
  if (specifier === '@dsbotdeck/tool-steps') return path.join(clientRoot, 'src/remote/tool-steps.js')
  if (specifier === '@dsbotdeck/resource-entry') return path.join(clientRoot, 'src/remote/resource-entry.js')
  if (specifier === '@dsbotdeck/tool-model') return path.join(clientRoot, 'src/shared/tool-model.ts')
  if (specifier === '@dsbotdeck/tool-history') return path.join(clientRoot, 'src/shared/tool-history.ts')
  if (specifier === '@dsbotdeck/extra-read') return path.join(clientRoot, 'src/shared/extra-read-model.ts')
  if (specifier === '@dsbotdeck/remote-capabilities') return path.join(clientRoot, 'src/shared/remote-capabilities.ts')
  if (specifier === '@dsbotdeck/validation') return path.join(clientRoot, 'src/shared/validation.ts')
  if (specifier === '@dsbotdeck/message-note') return path.join(clientRoot, 'src/remote/message-note.js')
  if (specifier === '@dsbotdeck/approval-model') return path.join(clientRoot, 'src/shared/approval-model.ts')
  if (specifier === '@dsbotdeck/tool-refresh') return path.join(clientRoot, 'src/shared/tool-refresh.ts')
  if (importer === BOOTSTRAP_ID && specifier.startsWith('.')) return path.resolve(path.dirname(main), specifier)
  if (specifier === './app.js' && slash(importer ?? '') === slash(main)) return path.join(clientRoot, 'src/remote/app.js')
  if (specifier === './dsh-primitives.js' && slash(importer ?? '').startsWith(`${slash(sourceRoot)}/ds-bot/src/client/`)) {
    return path.join(sourceRoot, 'app/ui/src/primitives.js')
  }
  for (const [prefix, folder] of [['@dsbot/client/', 'ds-bot/src/client/'], ['@dsbot/ui/', 'app/ui/src/']]) {
    if (specifier.startsWith(prefix)) {
      const root = path.join(sourceRoot, folder)
      const target = path.resolve(root, specifier.slice(prefix.length))
      if (!inside(root, target)) throw new Error('上游 UI 引用越过了允许目录。')
      return target
    }
  }
  return null
}

async function currentCommit(root) {
  try {
    let git = path.join(root, '.git')
    if ((await stat(git)).isFile()) {
      const pointer = (await readFile(git, 'utf8')).trim()
      if (!pointer.startsWith('gitdir: ')) return null
      git = path.resolve(root, pointer.slice(8))
    }
    const head = (await readFile(path.join(git, 'HEAD'), 'utf8')).trim()
    if (/^[a-f0-9]{40,64}$/i.test(head)) return head
    const ref = /^ref: (refs\/[A-Za-z0-9_./-]+)$/.exec(head)?.[1]
    if (ref === undefined || ref.split('/').includes('..')) return null
    let common = git
    try { common = path.resolve(git, (await readFile(path.join(git, 'commondir'), 'utf8')).trim()) } catch {}
    try {
      const value = (await readFile(path.join(common, ref), 'utf8')).trim()
      if (/^[a-f0-9]{40,64}$/i.test(value)) return value
    } catch {}
    const packed = await readFile(path.join(common, 'packed-refs'), 'utf8')
    return packed.split(/\r?\n/).map(line => line.split(' ')).find(parts => parts[1] === ref)?.[0] ?? null
  } catch { return null }
}

export async function readUpstream(clientRoot, requested = process.env.DSBOT_SOURCE) {
  const root = await realpath(path.resolve(clientRoot, requested || '../DS-Bot'))
  if (inside(root, clientRoot) || inside(clientRoot, root)) throw new Error('客户端与上游源码目录必须相互独立。')
  for (const relative of REQUIRED) {
    const target = path.join(root, relative)
    try { if (!(await stat(target)).isFile()) throw new Error('not-file') }
    catch { throw new Error(`上游缺少构建所需文件：${relative}；请检查 DSBOT_SOURCE。`) }
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'ds-bot/package.json'), 'utf8'))
  if (manifest.name !== 'ds-bot') throw new Error('指定目录不是 DS-Bot 源码。')
  bootstrapText(await readFile(path.join(root, 'app/ui/src/main.js'), 'utf8'))
  for (const name of ['app/ui/src/chat.js', 'app/ui/src/team.js', 'ds-bot/src/client/activity-row.js', 'ds-bot/src/client/bot-tasks.js', 'ds-bot/src/client/cells.js', ...SCOPED_UI_FILES]) paintSource(await readFile(path.join(root, name), 'utf8'), path.join(root, name), root)
  return { root, version: manifest.version, commit: await currentCommit(root), referenceCommit: REFERENCE_COMMIT }
}

export async function sourceReceipt(upstream, inputs) {
  const paths = [...new Set(inputs.map(input => path.resolve(input)).filter(input => inside(upstream.root, input)))].sort()
  const files = []
  for (const input of paths) {
    const bytes = await readFile(input)
    files.push({ path: slash(path.relative(upstream.root, input)), sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  return { project: 'DS-Bot', version: upstream.version, commit: upstream.commit, referenceCommit: upstream.referenceCommit, sourceDigest: digest, files }
}
