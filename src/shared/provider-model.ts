// SPDX-License-Identifier: Apache-2.0
// 只适配现有模型列表协议；未编辑的模型只传编号，服务端保留原高级字段。
import { DeckError, record } from './validation.ts'
export interface ProviderModel { id: string; name: string }
export interface ModelProvider { id: string; name: string; editable: boolean; models: ProviderModel[] }
export interface ProviderCatalog { available: boolean; revision: number | null; providers: ModelProvider[] }
export interface ModelDraft { id: string; name: string; contextWindow: string; maxTokens: string; input: string }
const invalid = (message: string) => new DeckError('bot/invalid', message)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(value)
const modelRows = (value: unknown): ProviderModel[] => {
  if (!Array.isArray(value) || value.length > 4096) throw invalid('Model list is invalid.')
  const seen = new Set<string>()
  return value.map(item => {
    const model = record(item)
    if (!model || !identifier(model.id) || seen.has(model.id)) throw invalid('Model list is invalid.')
    seen.add(model.id)
    return { id: model.id, name: typeof model.name === 'string' ? model.name.slice(0, 256) : model.id }
  })
}
export function providerCatalog(value: unknown): ProviderCatalog {
  const view = record(value)
  if (view?.available === false) return { available: false, revision: null, providers: [] }
  if (view?.available !== true || !Array.isArray(view.providers) || view.providers.length > 256) throw invalid('Provider list is invalid.')
  const revision = typeof view.revision === 'number' && Number.isSafeInteger(view.revision) && view.revision >= 0 ? view.revision : null
  const seen = new Set<string>()
  const providers = view.providers.map(item => {
    const provider = record(item)
    if (!provider || !identifier(provider.id) || seen.has(provider.id)) throw invalid('Provider list is invalid.')
    seen.add(provider.id)
    // 原协议的 refreshable 与 saveProviderModels 使用相同的可编辑条件。
    const declared = provider.declaredModels
    if (declared !== undefined && !Array.isArray(declared)) throw invalid('Model list is invalid.')
    return { id: provider.id, name: typeof provider.name === 'string' ? provider.name.slice(0, 256) : provider.id,
      editable: revision !== null && provider.refreshable === true && provider.auth !== 'chatgpt',
      models: modelRows(Array.isArray(declared) && declared.length > 0 ? declared : provider.models) }
  })
  return { available: true, revision, providers }
}
function positive(value: string): number | undefined {
  if (value.trim() === '') return undefined
  if (!/^\d+$/.test(value.trim())) throw invalid('Token limits must be positive integers.')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw invalid('Token limits must be positive integers.')
  return number
}
export function providerModelRequest(catalog: ProviderCatalog, providerId: string, originalId: string | null, draft: ModelDraft) {
  const provider = catalog.providers.find(item => item.id === providerId)
  if (!provider?.editable || catalog.revision === null) throw invalid('This provider cannot edit models here.')
  const id = draft.id.trim()
  if (!identifier(id)) throw invalid('Enter a model ID without spaces.')
  const existing = provider.models.some(model => model.id === id)
  if (originalId !== null && (id !== originalId || !existing)) throw invalid('The model changed. Read the list again.')
  if (originalId === null && existing) throw invalid('A model with this ID already exists.')
  if (provider.models.length + (originalId === null ? 1 : 0) > 500) throw invalid('At most 500 models can be kept.')
  const name = draft.name.trim()
  if (name.length > 256 || /[\u0000-\u001f\u007f]/.test(name)) throw invalid('Model name is invalid.')
  const contextWindow = positive(draft.contextWindow); const maxTokens = positive(draft.maxTokens)
  if (contextWindow !== undefined && maxTokens !== undefined && maxTokens > contextWindow) throw invalid('Max output cannot exceed the context window.')
  if (!['', 'text', 'text,image'].includes(draft.input)) throw invalid('Input types are invalid.')
  const edited = { id, ...(name ? { name } : {}), ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }), ...(draft.input ? { input: draft.input.split(',') } : {}) }
  if (originalId !== null && Object.keys(edited).length === 1) throw invalid('Enter at least one setting to change.')
  const models = provider.models.map(model => model.id === originalId ? edited : { id: model.id })
  if (originalId === null) models.push(edited)
  return { provider: providerId, revision: catalog.revision, models }
}
