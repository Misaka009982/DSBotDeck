// SPDX-License-Identifier: Apache-2.0
// 仅定义工作流结构核对，不启动 Actions、下载依赖或打包。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { REFERENCE_COMMIT } from '../scripts/upstream.mjs'
const workflow = () => readFile(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8')
test('Windows 工作流使用独立同级源码、固定上游与最小凭据权限', async () => {
  const text = await workflow()
  assert.ok(text.includes('workflow_dispatch:')); assert.ok(text.includes('runs-on: windows-latest'))
  assert.ok(text.includes('contents: read')); assert.equal(text.includes('contents: write'), false)
  assert.ok(text.includes('working-directory: DSBotDeck'))
  assert.ok(text.includes('path: DSBotDeck')); assert.ok(text.includes('path: DS-Bot'))
  assert.ok(text.includes('repository: Fei-Craft/DS-Bot'))
  assert.ok(text.includes(`DSBOT_UPSTREAM_REF: '${REFERENCE_COMMIT}'`))
  assert.ok(text.includes('ref: ${{ inputs.upstream_ref || env.DSBOT_UPSTREAM_REF }}'))
  assert.equal((text.match(/persist-credentials: false/g) ?? []).length, 2)
  assert.equal((text.match(/uses: actions\/[a-z-]+@[a-f0-9]{40}/g) ?? []).length, 4)
  assert.ok(text.includes("node-version: '24.10.0'"))
  assert.equal(text.includes('pull_request_target:'), false); assert.equal(text.includes('secrets.'), false)
})
test('工作流先类型和回归再打包，只上传 EXE 且保留内部来源核对', async () => {
  const text = await workflow()
  const commands = ['run: npm install', 'run: npm run typecheck', 'run: npm test', 'run: npm run dist']
  const positions = commands.map(command => text.indexOf(command))
  assert.ok(positions.every(position => position >= 0))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  assert.equal(text.includes('npm ci'), false); assert.equal(text.includes('cache: npm'), false)
  assert.equal(text.includes('git archive'), false); assert.equal(text.includes('*-Source-*.zip'), false)
  assert.ok(text.includes('path: DSBotDeck/release/DSBotDeck-Setup-*-x64.exe'))
  assert.ok(text.includes('dist/upstream-sources.json'))
  assert.ok(text.includes('$receipt.commit -ne $upstreamSha'))
  const uploads = text.slice(text.indexOf('uses: actions/upload-artifact'))
  assert.equal(uploads.includes('package-lock.json'), false)
  assert.equal(uploads.includes('upstream-sources.json'), false)
  assert.equal(uploads.includes('licenses/'), false)
  assert.ok(text.includes('if-no-files-found: error'))
  assert.equal(text.includes('npm start'), false); assert.equal(text.includes('gh release'), false)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.scripts.dist.includes('--publish never'))
})
