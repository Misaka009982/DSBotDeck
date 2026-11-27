// SPDX-License-Identifier: Apache-2.0
// 只构建本项目的外壳、原 UI 接入和 link；不安装或启动 DSH。
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as bundle } from 'esbuild'
import { build as buildUi } from 'vite'
import { paintSource } from './paint-source.mjs'
import { createAppIcons, ICON_SOURCE_FILES } from './app-icons.mjs'
import { adaptUiSource, BOOTSTRAP_ID, bootstrapText, inside, readUpstream, sourceReceipt, UI_PACKAGES } from './upstream.mjs'

const clientRoot = fileURLToPath(new URL('../', import.meta.url))
const upstream = await readUpstream(clientRoot)
const dist = path.join(clientRoot, 'dist')
for (const folder of ['', 'renderer', 'remote', 'main', 'preload', 'assets', 'licenses', 'licenses/DS-Bot']) {
  try { if ((await lstat(path.join(dist, folder))).isSymbolicLink()) throw new Error(`构建目录不能是符号链接：${folder || 'dist'}`) }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
}
await mkdir(dist, { recursive: true })
const inputs = new Set()
const plugin = () => ({
  name: 'dsbotdeck-readonly-ui',
  enforce: 'pre',
  async resolveId(specifier, importer) {
    const adapted = adaptUiSource(specifier, importer, clientRoot, upstream.root)
    if (adapted !== null) return adapted
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (UI_PACKAGES.has(packageName) && importer && !importer.includes('/node_modules/')) {
      return this.resolve(specifier, path.join(clientRoot, 'src/renderer/main.js'), { skipSelf: true })
    }
    return null
  },
  async load(id) {
    if (id !== BOOTSTRAP_ID) return null
    const main = path.join(upstream.root, 'app/ui/src/main.js')
    inputs.add(main)
    return bootstrapText(await readFile(main, 'utf8'))
  },
  transform(code, id) {
    const next = paintSource(code, id.split('?')[0], upstream.root)
    return next === null ? null : { code: next, map: null }
  },
  generateBundle() {
    for (const id of this.getModuleIds()) {
      const clean = id.split('?')[0]
      if (path.isAbsolute(clean) && inside(upstream.root, clean)) inputs.add(clean)
    }
  },
})

for (const [folder, pages] of [
  ['renderer', { index: path.join(clientRoot, 'src/renderer/index.html'), pet: path.join(clientRoot, 'src/renderer/pet.html') }],
  ['remote', { index: path.join(clientRoot, 'src/remote/index.html') }],
]) {
  await buildUi({
    configFile: false,
    root: path.join(clientRoot, `src/${folder}`),
    base: './',
    plugins: [plugin()],
    worker: { plugins: () => [plugin()] },
    resolve: { dedupe: [...UI_PACKAGES] },
    build: {
      outDir: path.join(dist, folder),
      emptyOutDir: true,
      chunkSizeWarningLimit: 2048,
      rollupOptions: { input: pages },
    },
  })
}

const aliases = {
  '@dsbot/link': path.join(upstream.root, 'link/src/index.ts'),
  '@dsbot/notices': path.join(upstream.root, 'mobile/src/team/notices.ts'),
  '@dsbot/gated': path.join(upstream.root, 'mobile/src/team/gated.ts'),
  '@dsbot/characters': path.join(upstream.root, 'ds-bot/src/client/characters.js'),
  '@dsbot/themes': path.join(upstream.root, 'ds-bot/src/client/themes.js'),
  '@dsbot/browser-policy': path.join(upstream.root, 'ds-bot/src/shared/browser-endpoints.js'),
  '@dsbot/remote-policy': path.join(upstream.root, 'ds-bot/src/shared/remote-endpoints.js'),
}
const result = await bundle({
  absWorkingDir: clientRoot,
  entryPoints: ['src/main/index.ts'],
  outfile: path.join(dist, 'main/index.mjs'),
  platform: 'node', format: 'esm', target: 'node24',
  bundle: true, packages: 'external', alias: aliases,
  metafile: true,
})
for (const input of Object.keys(result.metafile.inputs)) inputs.add(path.resolve(clientRoot, input))
for (const name of ['shell', 'content', 'pet']) {
  await bundle({
    absWorkingDir: clientRoot,
    entryPoints: [`src/preload/${name}.ts`],
    outfile: path.join(dist, `preload/${name}.cjs`),
    platform: 'node', format: 'cjs', target: 'node24', bundle: true, external: ['electron'],
  })
}
const legal = path.join(dist, 'licenses/DS-Bot')
await mkdir(legal, { recursive: true })
for (const name of ['LICENSE', 'NOTICE']) {
  await copyFile(path.join(upstream.root, name), path.join(legal, name))
  await copyFile(path.join(upstream.root, name), path.join(dist, 'remote', name))
}
await mkdir(path.join(dist, 'licenses/jsQR'), { recursive: true })
await copyFile(path.join(clientRoot, 'node_modules/jsqr/LICENSE'), path.join(dist, 'licenses/jsQR/LICENSE'))
for (const name of ['xterm', 'addon-fit']) {
  await mkdir(path.join(dist, `licenses/xterm-${name}`), { recursive: true })
  await copyFile(path.join(clientRoot, `node_modules/@xterm/${name}/LICENSE`), path.join(dist, `licenses/xterm-${name}/LICENSE`))
}
for (const [name, file] of [['highlight.js', 'LICENSE'], ['katex', 'LICENSE'], ['remark-math', 'license']]) {
  await mkdir(path.join(dist, `licenses/${name}`), { recursive: true })
  await copyFile(path.join(clientRoot, `node_modules/${name}/${file}`), path.join(dist, `licenses/${name}/LICENSE`))
}
const assets = path.join(dist, 'assets')
await mkdir(assets, { recursive: true })
await createAppIcons(upstream.root, assets)
for (const name of ICON_SOURCE_FILES) inputs.add(path.join(upstream.root, name))
const receipt = await sourceReceipt(upstream, [...inputs])
await writeFile(path.join(dist, 'upstream-sources.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
console.log(`DSBotDeck 构建完成；上游 DS-Bot ${receipt.version}，提交 ${receipt.commit ?? '未知（源码目录不含 Git 元数据）'}。`)
console.log('构建只输出本项目 dist/，没有安装或启动本地 DSH。')
