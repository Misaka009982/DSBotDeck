// SPDX-License-Identifier: Apache-2.0
// 原模型设置页的远程补充：仅使用已开放的服务商列表与模型保存协议。
import { createElement as h, useContext, useLayoutEffect, useRef, useState } from 'react'
import { call } from '@dsbot/client/api.js'
import { hostText, language, t } from '@dsbot/client/i18n.js'
import { toTraditional } from '@dsbot/client/locales/zh-tw.js'
import { PlusIcon } from '@dsbot/client/icons.js'
import { SelectMenu } from '@dsbot/client/select-menu.js'
import { providerCatalog, providerModelRequest } from '../shared/provider-model.ts'
import { errorCode } from '../shared/validation.ts'
import { ResourceContext } from './resource-read.js'
import { useDetailAvailability } from './tool-detail.js'
import './model-settings.css'
const tr = (en, zh) => language() === 'zh' ? zh : language() === 'zh-TW' ? toTraditional(zh) : t(en)
const errors = {
  'Model list is invalid.': '服务器模型列表格式无效。',
  'Provider list is invalid.': '服务器服务商列表格式无效。',
  'Token limits must be positive integers.': 'Token 上限必须是正整数。',
  'Max output cannot exceed the context window.': '最大输出不能超过上下文长度。',
  'This provider cannot edit models here.': '此服务商不能在这里编辑模型。',
  'Enter a model ID without spaces.': '请输入不含空白的模型 ID。',
  'The model changed. Read the list again.': '模型已变化，请重新读取列表。',
  'A model with this ID already exists.': '已存在相同 ID 的模型，请选择它进行修改。',
  'At most 500 models can be kept.': '每个服务商最多保留 500 个模型。',
  'Model name is invalid.': '模型名称无效。',
  'Input types are invalid.': '输入类型无效。',
  'Enter at least one setting to change.': '请至少填写一个要修改的参数。',
}
const failureText = error => errors[error?.message] ? tr(error.message, errors[error.message]) : hostText(error?.message ?? String(error))
const emptyDraft = (id = '') => ({ id, name: '', contextWindow: '', maxTokens: '', input: '' })
export function ProviderModelActions({ provider, actions }) {
  const context = useContext(ResourceContext)
  if (provider.refreshable !== true || provider.auth === 'chatgpt') return null
  return h('div', { className: 'bt-secret-row-actions' }, h('button', {
    type: 'button', className: 'bt-soft bt-soft-sm bt-with-icon', disabled: context.cached || context.mode !== 'phone' || Boolean(context.roster?.readOnly),
    onClick: () => actions.openSettings('models', `advanced:${provider.id}`),
  }, h(PlusIcon), tr('Add model', '添加模型')))
}
export function ModelSettings({ actions, initialProvider = '', leaving = false }) {
  const context = useContext(ResourceContext); const shown = useDetailAvailability()
  const available = shown && !leaving && !context.cached
  const writable = available && context.mode === 'phone' && !context.roster?.readOnly
  const [catalog, setCatalog] = useState(null); const [providerId, setProviderId] = useState(initialProvider)
  const [busy, setBusy] = useState(''); const [needsRead, setNeedsRead] = useState(true)
  const [message, setMessage] = useState(''); const [failure, setFailure] = useState(''); const [edition, setEdition] = useState(0)
  const node = useRef(null); const request = useRef(null); const latest = useRef(null); const uncertain = useRef(false)
  const identity = JSON.stringify([context.epoch, context.mode, context.cached, Boolean(context.roster?.readOnly), available])
  latest.current = { identity, available, writable }
  const usable = () => latest.current.identity === identity && latest.current.available && document.visibilityState === 'visible'
    && !document.body.hasAttribute('data-deck-cached') && node.current?.isConnected && !node.current.closest('[data-leaving]')
  const unknownText = () => tr('Save result is unknown. Read the list and check before making another change.', '保存结果待确认，请重新读取列表并核对后再修改；没有自动重发。')
  const read = async () => {
    if (!usable() || request.current) return
    const pending = { controller: new AbortController(), kind: 'read' }; request.current = pending
    setBusy('read'); setFailure('')
    try {
      const raw = await call('providers', {}, pending.controller.signal)
      if (request.current !== pending || !usable()) return
      const next = providerCatalog(raw)
      setCatalog(next); setNeedsRead(false); setEdition(value => value + 1)
      // 明确点开的服务商失效时不自动改投其他服务商；由用户重新选择。
      setProviderId(value => value || next.providers.find(provider => provider.editable)?.id || next.providers[0]?.id || '')
      setMessage(uncertain.current ? tr('The list has been reloaded. Check the saved model before editing again.', '已重新读取列表，请核对模型是否已保存后再继续编辑。') : '')
      uncertain.current = false
    } catch (error) {
      if (request.current === pending && usable()) { setNeedsRead(true); setFailure(failureText(error)) }
    } finally { if (request.current === pending) { request.current = null; setBusy('') } }
  }
  useLayoutEffect(() => {
    setNeedsRead(true); setBusy('')
    if (uncertain.current) setMessage(unknownText())
    // 已有编辑在断线/隐藏后保持，只能显式重新读取后继续写入。
    if (available && catalog === null) void read()
    return () => {
      const pending = request.current; request.current = null
      if (pending?.kind === 'save') uncertain.current = true
      pending?.controller.abort()
    }
  }, [identity])
  const save = async (originalId, draft) => {
    if (!usable() || !latest.current.writable || needsRead || request.current || !catalog) return
    let payload
    try { payload = providerModelRequest(catalog, providerId, originalId, draft) }
    catch (error) { setFailure(failureText(error)); return }
    const pending = { controller: new AbortController(), kind: 'save', received: false }; request.current = pending
    setBusy('save'); setFailure(''); setMessage('')
    try {
      const raw = await call('provider-models-save', payload, pending.controller.signal)
      pending.received = true
      if (request.current !== pending || !usable()) return
      const next = providerCatalog(raw)
      if (!next.providers.find(provider => provider.id === providerId)?.models.some(model => model.id === draft.id.trim())) throw new Error('Model list is invalid.')
      pending.kind = 'confirmed'
      setCatalog(next); setEdition(value => value + 1); setNeedsRead(false); setMessage(t('Saved.'))
      void Promise.resolve().then(() => { if (usable()) return actions.refreshModels?.() }).catch(() => {})
    } catch (error) {
      if (request.current !== pending || !usable()) return
      const refused = !pending.received && ['bot/invalid', 'bot/refused', 'bot/stale', 'bot/read-only'].includes(errorCode(error))
      uncertain.current = !refused
      setNeedsRead(true)
      setFailure(refused ? failureText(error) : unknownText())
    } finally { if (request.current === pending) { request.current = null; setBusy('') } }
  }
  const provider = catalog?.providers.find(item => item.id === providerId)
  let reason = ''
  if (!available) reason = tr('Reconnect to edit model settings.', '恢复连接后才能读取或修改模型设置。')
  else if (context.mode !== 'phone') reason = tr('A phone pairing is required to change models. This browser pairing is read-only.', '修改模型需要手机权限配对；当前浏览器权限仅可查看。')
  else if (context.roster?.readOnly) reason = tr('This server is read-only.', '此服务器当前只读。')
  else if (catalog?.available && providerId && !provider) reason = tr('The provider is no longer available. Choose another provider.', '原服务商已不可用，请重新选择服务商。')
  else if (provider && !provider.editable) reason = tr('This provider is managed by the server. Add a custom API provider to declare your own models.', '此服务商由服务器管理。需要自定义模型时，请返回添加“自定义 API”服务商。')
  return h('section', { ref: node, className: 'deck-model-settings', 'aria-label': t('Advanced settings') },
    h('div', { className: 'bt-provider-models-head' }, h('h3', null, t('Manage models')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: !available || Boolean(busy), onClick: () => { void read() } },
        busy === 'read' ? t('Loading…') : catalog ? tr('Reload and discard edits', '重新读取并丢弃未保存编辑') : t('Retry'))),
    reason ? h('p', { className: 'bt-set-hint', role: 'status' }, reason) : null,
    message ? h('p', { className: 'bt-set-hint', role: 'status' }, message) : null,
    failure ? h('p', { className: 'bt-error', role: 'alert' }, failure) : null,
    catalog?.available === false ? h('p', { className: 'bt-set-hint' }, t('This DSH cannot set up model providers.')) : null,
    catalog?.available ? h('div', { className: 'bt-provider-form' },
      h(SelectMenu, { 'aria-label': t('Provider'), value: providerId, disabled: Boolean(busy),
        options: catalog.providers.map(item => ({ value: item.id, label: item.name })), onChange: value => { setProviderId(value); setFailure(''); setMessage('') } }),
      catalog.providers.length === 0 ? h('p', { className: 'bt-set-hint' }, tr('Add a provider first.', '请先返回添加服务商。')) : null,
      provider ? h(ModelForm, { key: JSON.stringify([provider.id, edition]), provider, disabled: !writable || !provider.editable || needsRead || Boolean(busy), saving: busy === 'save', onSave: save }) : null) : null)
}
function ModelForm({ provider, disabled, saving, onSave }) {
  const [originalId, setOriginalId] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  const selected = provider.models.find(model => model.id === originalId)
  const keep = tr('Keep existing value', '保持服务器现值')
  const input = (key, label, placeholder, extra = {}) => h('label', { className: 'deck-model-field' }, h('span', null, label), h('input', {
    className: 'bt-input', value: draft[key], placeholder, 'aria-label': label, autoComplete: 'off', spellCheck: false, ...extra,
    onChange: event => set(key, event.target.value),
  }))
  return h('div', { className: 'bt-provider-form' },
    h(SelectMenu, { 'aria-label': t('Model'), value: originalId ?? '', disabled: saving,
      options: [{ value: '', label: tr('Add model', '添加模型') }, ...provider.models.map(model => ({ value: model.id, label: `${model.name} · ${model.id}` }))],
      onChange: value => { setOriginalId(value || null); setDraft(emptyDraft(value)) } }),
    h('fieldset', { className: 'deck-model-fields', disabled },
    h('p', { className: 'bt-set-hint' }, tr('Leave fields blank to keep saved values. The server does not return current advanced settings; thinking levels are managed on the server.', '未填写的参数保持原设置。当前服务器未回传已有高级参数；思考档位仍需在服务器端管理。')),
    h('div', { className: 'bt-provider-pair' },
      input('id', tr('Model ID', '模型 ID'), 'model-id', { readOnly: originalId !== null, maxLength: 256 }),
      input('name', t('Name'), selected?.name ?? t('Name (optional)'), { maxLength: 256 })),
    h('div', { className: 'bt-provider-pair' },
      input('contextWindow', tr('Context window (tokens)', '上下文长度（tokens）'), keep, { inputMode: 'numeric' }),
      input('maxTokens', tr('Maximum output (tokens)', '最大输出（tokens）'), keep, { inputMode: 'numeric' })),
    h('label', { className: 'deck-model-field' }, h('span', null, tr('Input types', '输入类型')),
      h(SelectMenu, { 'aria-label': tr('Input types', '输入类型'), value: draft.input, disabled,
        options: [{ value: '', label: keep }, { value: 'text', label: tr('Text', '文本') }, { value: 'text,image', label: tr('Text and images', '文本与图片') }], onChange: value => set('input', value) })),
    h('div', { className: 'bt-secret-row-actions' }, h('button', {
      type: 'button', className: 'bt-send bt-soft-sm', disabled: disabled || draft.id.trim() === '', onClick: () => { void onSave(originalId, draft) },
    }, saving ? t('Saving…') : originalId === null ? tr('Add model', '添加模型') : t('Save')))))
}
