// SPDX-License-Identifier: Apache-2.0
// 回归定义：验证模型更新的真实请求与固定上游保存实现；不运行真实服务或写用户配置。
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { providerCatalog, providerModelRequest, type ModelDraft } from '../src/shared/provider-model.ts'
const draft = (patch: Partial<ModelDraft> = {}): ModelDraft => ({ id: 'new-model', name: '', contextWindow: '', maxTokens: '', input: '', ...patch })
const view = () => ({ available: true, revision: 7, providers: [{ id: 'relay', name: 'Relay', refreshable: true,
  models: [{ id: 'default', name: '默认目录模型' }], declaredModels: [{ id: 'kept', name: '原配置模型' }] }] })
test('新增模型保留原声明列表、完整模型ID与版本号，仅传实际填写的参数', () => {
  const catalog = providerCatalog(view())
  assert.deepEqual(providerModelRequest(catalog, 'relay', null, draft({ id: 'org/model-v2', name: '自定义模型', contextWindow: '128000', maxTokens: '8192', input: 'text,image' })), {
    provider: 'relay', revision: 7, models: [{ id: 'kept' }, { id: 'org/model-v2', name: '自定义模型', contextWindow: 128000, maxTokens: 8192, input: ['text', 'image'] }],
  })
  assert.deepEqual(providerModelRequest(catalog, 'relay', 'kept', draft({ id: 'kept', maxTokens: '4096' })).models, [{ id: 'kept', maxTokens: 4096 }])
  assert.equal(JSON.stringify(catalog).includes('apiKey'), false)
})
test('模型编辑拒绝重复编号、无效参数、无版本和不可编辑服务商', () => {
  const catalog = providerCatalog(view())
  assert.throws(() => providerModelRequest(catalog, 'relay', null, draft({ id: 'kept' })), /already exists/)
  assert.throws(() => providerModelRequest(catalog, 'relay', 'kept', draft()), /changed/)
  assert.throws(() => providerModelRequest(catalog, 'relay', 'kept', draft({ id: 'kept' })), /at least one setting/)
  for (const patch of [{ id: 'bad id' }, { contextWindow: '0' }, { maxTokens: '-1' }, { maxTokens: '1.5' }, { contextWindow: '1e6' }, { maxTokens: '9007199254740992' }, { contextWindow: '4', maxTokens: '8' }, { input: 'executable' }]) {
    assert.throws(() => providerModelRequest(catalog, 'relay', null, draft(patch)))
  }
  for (const value of [{ ...view(), revision: undefined }, { ...view(), providers: [{ ...view().providers[0], refreshable: false }] }, { ...view(), providers: [{ ...view().providers[0], auth: 'chatgpt' }] }]) {
    assert.throws(() => providerModelRequest(providerCatalog(value), 'relay', null, draft()), /cannot edit/)
  }
  assert.throws(() => providerCatalog({ ...view(), providers: [{ ...view().providers[0], declaredModels: [{ id: 'a' }, { id: 'a' }] }] }), /invalid/)
  const large = { ...view(), providers: [{ ...view().providers[0], declaredModels: Array.from({ length: 500 }, (_, index) => ({ id: `m${index}` })) }] }
  assert.throws(() => providerModelRequest(providerCatalog(large), 'relay', null, draft()), /500/)
})
test('原服务端保存实现接收新增与高级参数，保留其他模型、思考配置、路由和凭据引用', async () => {
  const source = await readFile(new URL('../../DS-Bot/ds-bot/src/host/providers.js', import.meta.url), 'utf8')
  const { install } = runInNewContext(`${source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')}\n;({ install })`, {
    CHATGPT_PROVIDER: 'openai-chatgpt', serviceOf: (ctx: any, name: string) => ctx.get(name), URL,
  })
  let revision = 7
  const profile = { api: 'openai-completions', baseURL: 'https://relay.example/v1', apiKeyEnv: 'FICTIONAL_API_KEY', headers: { 'X-Route': 'example' },
    compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true },
    models: [{ id: 'kept', name: '原模型', contextWindow: 64000, maxTokens: 2048, input: ['text'], reasoningEfforts: { default: 'high' } }] as Record<string, unknown>[] }
  const unchanged = JSON.stringify({ ...profile, models: undefined })
  const writes: unknown[] = []
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision, value: { providers: { relay: profile } }, user: { providers: { relay: profile } }, base: {} }],
    mutate: async (namespace: string, operations: { op: string; path: string[]; value: Record<string, unknown>[] }[], expected: number) => {
      assert.equal(namespace, 'llm-pi-ai'); assert.equal(expected, revision)
      assert.deepEqual(JSON.parse(JSON.stringify(operations[0].path)), ['providers', 'relay', 'models'])
      writes.push(operations); profile.models = operations[0].value; revision++
    },
  }
  const rt: any = { ctx: { get: (key: string) => key === 'settings' ? settings : key === 'credentials' ? { describe: async () => ({ configured: true, writable: true }) } : undefined,
    llm: { listConfigurableProviders: () => [{ provider: 'relay', displayName: 'Relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'], declared: true }] } },
    catalog: async () => profile.models.map(model => ({ provider: 'relay', id: model.id, ref: `relay/${model.id}`, name: model.name ?? model.id })), dropCatalog: () => {} }
  install(rt)
  const first = providerCatalog(await rt.providersView())
  const result = providerCatalog(await rt.saveProviderModels(providerModelRequest(first, 'relay', null, draft({ contextWindow: '128000', maxTokens: '4096', input: 'text,image' }))))
  assert.equal(result.revision, 8); assert.equal(result.providers[0].models[1].id, 'new-model')
  assert.equal(profile.models[0].contextWindow, 64000); assert.equal(profile.models[0].maxTokens, 2048)
  assert.deepEqual(profile.models[0].reasoningEfforts, { default: 'high' })
  assert.deepEqual(JSON.parse(JSON.stringify(profile.models[1])), { id: 'new-model', contextWindow: 128000, maxTokens: 4096, input: ['text', 'image'] })
  await rt.saveProviderModels(providerModelRequest(result, 'relay', 'kept', draft({ id: 'kept', name: '新名称', contextWindow: '256000' })))
  assert.equal(profile.models[0].name, '新名称'); assert.equal(profile.models[0].contextWindow, 256000)
  assert.equal(profile.models[0].maxTokens, 2048); assert.deepEqual(profile.models[0].reasoningEfforts, { default: 'high' })
  assert.equal(JSON.stringify({ ...profile, models: undefined }), unchanged)
  await assert.rejects(rt.saveProviderModels(providerModelRequest(first, 'relay', null, draft({ id: 'late-model' }))), /changed in another window/)
  assert.equal(writes.length, 2)
})
