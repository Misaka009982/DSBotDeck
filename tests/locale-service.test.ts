// SPDX-License-Identifier: Apache-2.0
// 使用原词典与原locale服务，覆盖网页旧偏好不能覆盖Deck语言的边界。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { installLocale, language, t } from '../../DS-Bot/ds-bot/src/client/i18n.js'
const localeSource = await readFile(new URL('../../DS-Bot/app/ui/src/locale.js', import.meta.url), 'utf8')
const adapterSource = await readFile(new URL('../src/renderer/locale-service.js', import.meta.url), 'utf8')
function fixture() {
  const reads: string[] = []; const writes: string[] = []
  const { createLocale } = runInNewContext(`${localeSource.replace(/^export /gm, '')}\n({ createLocale })`, {
    localStorage: { getItem: (key: string) => { reads.push(key); return 'en' }, setItem: (key: string) => writes.push(key), removeItem: (key: string) => writes.push(key) },
  })
  const { createDeckLocale } = runInNewContext(`${adapterSource.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')}\n({ createDeckLocale })`, { createLocale })
  return { createLocale, createDeckLocale, reads, writes }
}
test('Deck简体中文采用原词典，转到后台按钮不受旧英文偏好覆盖', () => {
  const f = fixture()
  assert.equal(f.createLocale('zh-CN').getLocale().active, 'en', '原网页保存偏好优先于传入语言')
  const service = f.createDeckLocale('zh-CN'); const dispose = installLocale(service)
  try {
    assert.equal(language(), 'zh')
    assert.equal(t('Move to background'), '转到后台')
    assert.equal(t('Moving…'), '正在转后台…')
    assert.equal(t('Move current work to background'), '将当前工作转到后台')
    assert.equal(t('Background tasks'), '后台任务')
    for (const [key, expected] of [['Connect', '连接'], ['Connection', '连接方式'], ['Pair a phone', '配对手机'], ['Paired devices', '已配对设备'], ['Profile', '资料'], ['Model', '模型'], ['Instructions', '说明']]) assert.equal(t(key), expected)
    assert.equal(f.reads.length, 1); assert.deepEqual(f.writes, [])
  } finally { dispose() }
})
test('Deck显式切换语言仍遵循本机选择，不写回网页存储', () => {
  const f = fixture()
  for (const [tag, expected, label] of [['zh', 'zh', '转到后台'], ['en-US', 'en', 'Move to background'], ['zh-Hant', 'zh-TW', '轉到後台']]) {
    const service = f.createDeckLocale(tag); const dispose = installLocale(service)
    try { assert.equal(language(), expected); assert.equal(t('Move to background'), label) } finally { dispose() }
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, [])
})
