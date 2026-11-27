// SPDX-License-Identifier: Apache-2.0
// 仅由CI执行真实Vite内存打包；覆盖别名与上游页面相对导入之间的词典实例身份。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build, normalizePath } from 'vite'
import { uiResolver } from '../scripts/ui-resolver.mjs'

const client = fileURLToPath(new URL('../', import.meta.url))
const upstream = path.resolve(client, '../DS-Bot')
test('Windows构建中Deck与服务器设置、Bot设置、后台按钮共用同一语言实例', async () => {
  const entry = normalizePath(path.join(client, 'src/renderer/locale-bundle-probe.js'))
  const modules = new Map<string, string>()
  const names = ['settings', 'bot-settings', 'activity-row']
  for (const name of names) {
    const file = path.join(upstream, `ds-bot/src/client/${name}.js`)
    const text = await readFile(file, 'utf8')
    const specifier = /^import [^\r\n]+ from ['"]([^'"]*i18n\.js)['"]/m.exec(text)?.[1]
    assert.ok(specifier, `${name}必须沿实际页面的词典导入路径验证`)
    // 替身与实际页面同目录，只去掉无关控件；词典源码与模块解析均使用正式实现。
    modules.set(normalizePath(`${file}.deck-locale-probe.js`), `export * from ${JSON.stringify(specifier)};`)
  }
  modules.set(entry, `
import * as deck from '@dsbot/client/i18n.js';
import { createDeckLocale } from ${JSON.stringify(normalizePath(path.join(client, 'src/renderer/locale-service.js')))};
${[...modules.keys()].map((id, index) => `import * as page${index} from ${JSON.stringify(id)};`).join('\n')}
export const shared = [page0, page1, page2].every(page => page.t === deck.t && page.language === deck.language);
export function labels(tag) {
  const dispose = deck.installLocale(createDeckLocale(tag));
  try { return { deck: deck.language(), settings: page0.language(), bot: page1.language(), activity: page2.language(),
    connection: page0.t('Connection'), profile: page1.t('Profile'), background: page2.t('Move to background') }; }
  finally { dispose(); }
}
`)
  let ids: string[] = []
  const result = await build({
    configFile: false, root: client,
    plugins: [uiResolver(client, upstream), {
      name: 'deck-locale-probe',
      resolveId(id) { return modules.has(normalizePath(id)) ? normalizePath(id) : null },
      load(id) { return modules.get(normalizePath(id)) ?? null },
      generateBundle() { ids = [...this.getModuleIds()].filter(id => /[\\/]i18n\.js$/.test(id)) },
    }],
    build: { write: false, minify: false, lib: { entry, name: 'DeckLocaleProbe', formats: ['iife'] } },
  })
  assert.ok(!Array.isArray(result) && 'output' in result)
  const entryChunk = result.output.find(item => item.type === 'chunk' && item.isEntry)
  assert.ok(entryChunk?.type === 'chunk')
  const device = { language: 'en-US' }
  const bundle = runInNewContext(`${entryChunk.code}\n;DeckLocaleProbe`, { navigator: device })
  assert.equal(bundle.shared, true, `词典被解析为不同模块：${JSON.stringify(ids)}`)
  assert.equal(ids.length, 1, '一个页面只能安装一份上游词典模块')
  for (const [tag, expected, connection, profile, background] of [
    ['zh', 'zh', '连接方式', '资料', '转到后台'],
    ['en', 'en', 'Connection', 'Profile', 'Move to background'],
    ['zh-TW', 'zh-TW', '連接方式', '資料', '轉到後台'],
    ['zh', 'zh', '连接方式', '资料', '转到后台'],
  ]) {
    const labels = bundle.labels(tag)
    assert.equal(labels.deck, expected); assert.equal(labels.settings, expected)
    assert.equal(labels.bot, expected); assert.equal(labels.activity, expected)
    assert.equal(labels.connection, connection); assert.equal(labels.profile, profile); assert.equal(labels.background, background)
  }
  device.language = 'en-GB'; assert.equal(bundle.labels().settings, 'en')
  device.language = 'zh-CN'; assert.equal(bundle.labels().settings, 'zh')
})
