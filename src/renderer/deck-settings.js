// SPDX-License-Identifier: Apache-2.0
// Deck 本机设置不向服务器发 RPC；图片和目录均由系统选择器授权。
import { createElement as h, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@dsbot/client/icons.js'
import { CharacterGrid } from '@dsbot/client/bot-settings.js'
import { MAIN_LOOK } from '@dsbot/client/characters.js'
import { lookOf } from '@dsbot/client/mark.js'
import { renderBuiltinIcon } from './builtin-icon.js'
import { PetSprite } from './pet-sprite.js'
import { BackgroundCropper } from './background-cropper.js'
const api = window.dsbotDeck
function RangeControl({ label, value, min, max, step = 1, unit = '', disabled, commit }) {
  const [draft, setDraft] = useState(value)
  const last = useRef(value)
  useEffect(() => { setDraft(value); last.current = value }, [value])
  const save = event => { const next = Number(event.currentTarget.value); if (next !== last.current) { last.current = next; commit(next) } }
  return h('label', { className: 'deck-field' }, `${label}：${Math.round(draft * (unit === '%' ? 100 : 1))}${unit}`,
    h('input', { type: 'range', min, max, step, value: draft, disabled, onChange: event => setDraft(Number(event.target.value)), onPointerUp: save, onKeyUp: save, onBlur: save }))
}
export function DeckSettings({ snapshot, assets, busy, error, run, close }) {
  const [search, setSearch] = useState('')
  const root = useRef(null)
  const exit = useRef(null)
  const state = useRef({ busy, close }); state.current = { busy, close }
  useEffect(() => {
    const previous = document.activeElement
    exit.current?.focus()
    const key = event => {
      if (event.key === 'Escape' && !state.current.busy) { event.preventDefault(); state.current.close() }
      if (event.key !== 'Tab') return
      const controls = [...root.current.querySelectorAll('button,input,select,summary')].filter(item => !item.matches(':disabled') && item.checkVisibility())
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus?.() }
  }, [])
  const disabled = busy || !snapshot || Boolean(snapshot.startupError)
  const prefs = snapshot?.appearance ?? { opacity: 0.25, blur: 0, fit: 'cover' }
  const pet = snapshot?.pet ?? { enabled: false, locked: false, alwaysOnTop: true, skin: null, size: 112 }
  const act = callback => void run(callback)
  const iconLook = prefs.builtinIcon?.look ?? MAIN_LOOK
  const petLook = pet.mark ?? lookOf()
  const grid = (look, change) => h('fieldset', { className: 'deck-character-grid', disabled }, h(CharacterGrid, { look, onShape: shape => change({ ...look, shape }), onColor: color => change({ ...look, color }) }))
  const chooseIcon = look => act(async () => api.builtinIcon(look, await renderBuiltinIcon(look)))
  const choosePetMark = mark => act(() => api.pet({ skin: null, mark }))
  const choose = kind => act(() => api.chooseAsset(kind))
  const reset = kind => act(() => api.resetAsset(kind))
  const check = (label, name) => h('label', { className: 'deck-check' }, h('input', { type: 'checkbox', checked: pet[name], disabled, onChange: event => act(() => api.pet({ [name]: event.target.checked })) }), label)
  const pets = (assets?.pets ?? []).filter(entry => `${entry.name} ${entry.key}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const missingChoice = pet.skin && !pets.some(entry => entry.key === pet.skin)
  return h('div', { className: 'deck-scrim', onPointerDown: event => { if (event.target === event.currentTarget && !busy) close() } },
    h('section', { ref: root, className: 'deck-sheet deck-settings', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'deck-settings-title' },
      h('header', null, h('h2', { id: 'deck-settings-title' }, 'Deck 设置'), h('button', { ref: exit, type: 'button', className: 'deck-icon', disabled: busy, title: '关闭 Deck 设置', 'aria-label': '关闭 Deck 设置', onClick: close }, h(CloseIcon))),
      h('p', { className: 'deck-hint' }, '仅保存到这台电脑。服务器设置在服务器行齿轮，Bot 参数在 Bot 行齿轮或聊天顶部名称中。'),
      h('section', { className: 'deck-setting-block' }, h('h3', null, '原 DS-Bot 界面语言'),
        h('label', { className: 'deck-field' }, '连接后聊天、Bot 参数与服务器设置使用的语言', h('select', { className: 'bt-input', value: prefs.language ?? 'zh', disabled, onChange: event => act(() => api.appearance({ language: event.target.value })) },
          [['zh', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['system', '跟随本机系统']].map(([value, label]) => h('option', { key: value, value }, label)))),
        h('p', { className: 'deck-hint' }, '使用上游原词典，默认简体中文；不改变服务器配置或 Bot 回复语言。Deck 自身说明保持简体中文，工具原名、模型名和会话内容不强制翻译。')),
      h('section', { className: 'deck-setting-block' }, h('h3', null, '程序图标'),
        h('div', { className: 'deck-setting-actions' }, assets?.icon ? h('img', { className: 'deck-icon-preview', src: assets.icon, alt: '当前 Deck 图标' }) : null,
          h('button', { type: 'button', className: 'bt-soft', disabled, onClick: () => choose('icon') }, '选择本地图标'),
          h('button', { type: 'button', className: 'bt-soft', disabled: disabled || !prefs.iconPath && !prefs.builtinIcon, onClick: () => reset('icon') }, '恢复默认图标')),
        h('details', { className: 'deck-builtin-picker' }, h('summary', null, 'DS-Bot 内置图标与颜色'), grid(iconLook, chooseIcon)),
        h('p', { className: 'deck-hint' }, '用于 Deck Logo、窗口、运行中的任务栏和托盘，并同步当前安装的开始菜单入口。Windows 已固定项可能需重新固定才能刷新。')),
      h('section', { className: 'deck-setting-block' }, h('h3', null, '整个程序背景'),
        h('div', { className: 'deck-setting-actions' }, h('button', { type: 'button', className: 'bt-soft', disabled, onClick: () => choose('background') }, '选择背景图片'), h('button', { type: 'button', className: 'bt-soft', disabled: disabled || !prefs.backgroundPath, onClick: () => reset('background') }, '移除背景')),
        h('p', { className: 'deck-hint' }, '本机图片覆盖整个窗口，包括聊天区；不使用服务器背景，也不改写服务器主题。'),
        h(RangeControl, { label: '背景透明度', value: 1 - prefs.opacity, min: 0, max: 1, step: 0.05, unit: '%', disabled, commit: transparency => act(() => api.appearance({ opacity: 1 - transparency })) }),
        h('p', { className: 'deck-hint' }, `会话区域透明度：${Math.min(100, Math.round((1 - prefs.opacity) * 100) + 10)}%，固定比其他区域高 10 个百分点；文字和控件不变。`),
        h(RangeControl, { label: '背景模糊', value: prefs.blur, min: 0, max: 24, unit: 'px', disabled, commit: blur => act(() => api.appearance({ blur })) }),
        h('label', { className: 'deck-field' }, '图片布局', h('select', { className: 'bt-input', value: prefs.fit, disabled: disabled || Boolean(prefs.backgroundCrop), onChange: event => act(() => api.appearance({ fit: event.target.value })) }, h('option', { value: 'cover' }, '填满窗口'), h('option', { value: 'contain' }, '完整显示'))),
        assets?.background ? h('details', { className: 'deck-background-picker', open: true }, h('summary', null, '选择背景位置'), h(BackgroundCropper, { source: assets.background, value: prefs.backgroundCrop, disabled, commit: backgroundCrop => act(() => api.appearance({ backgroundCrop })) })) : null),
      h('section', { className: 'deck-setting-block' }, h('h3', null, '四色宠物'),
        h('div', { className: 'deck-setting-actions' }, check('显示宠物', 'enabled'), check('锁定主体穿透', 'locked'), check('置顶显示', 'alwaysOnTop')),
        h(RangeControl, { label: '宠物尺寸', value: pet.size, min: 72, max: 144, unit: 'px', disabled, commit: size => act(() => api.pet({ size })) }),
        h('div', { className: 'deck-setting-actions' }, h('button', { type: 'button', className: 'bt-soft', disabled, onClick: () => choose('pets') }, '选择宠物合集目录'), h('button', { type: 'button', className: 'bt-soft', disabled, onClick: () => act(api.refreshAssets) }, '刷新合集'), h('button', { type: 'button', className: 'bt-soft', disabled: disabled || !prefs.petLibraryPath, onClick: () => reset('pets') }, '恢复 Codex 默认目录')),
        h('p', { className: 'deck-hint deck-path' }, assets?.libraryPath ?? '正在读取本机合集…'),
        h('div', { className: 'deck-pet-picker' }, h('div', { className: 'deck-pet-preview' }, h(PetSprite, { asset: assets?.selected, mark: pet.mark, size: 112, pose: 'idle' })),
          h('div', { className: 'deck-pet-options' }, h('input', { type: 'search', className: 'bt-input', placeholder: '搜索宠物名称', 'aria-label': '搜索宠物名称', value: search, onChange: event => setSearch(event.target.value) }),
            h('select', { className: 'bt-input', size: 7, 'aria-label': '宠物外观', value: pet.skin ?? '', disabled, onChange: event => act(() => api.pet({ skin: event.target.value || null })) },
              h('option', { value: '' }, '内置 DS-Bot 宠物'), missingChoice ? h('option', { value: pet.skin, disabled: true }, `${pet.skin}（当前选择）`) : null,
              pets.map(entry => h('option', { key: entry.key, value: entry.key, disabled: !entry.available, title: entry.error ?? entry.key }, `${entry.name}${entry.available ? '' : ' · 不兼容'}`))))),
        h('details', { className: 'deck-builtin-picker' }, h('summary', null, 'DS-Bot 内置宠物与颜色'), grid(petLook, choosePetMark)),
        h('p', { className: 'deck-hint' }, '选择内置形状或颜色即切换到内置宠物。只读兼容 Codex 的 pet.json 与标准 WebP 精灵，不复制或上传合集。只有非零四色灯显示，悬停打开对象气泡，离开灯与气泡十秒后收起。')),
      assets?.warnings.length ? h('div', { className: 'deck-asset-warnings', role: 'status' }, assets.warnings.map(message => h('p', { key: message, className: 'deck-hint' }, message))) : null,
      error ? h('p', { className: 'deck-error', role: 'alert' }, error) : null,
      h('footer', null, h('button', { type: 'button', className: 'bt-soft', disabled: busy, onClick: close }, '完成'))))
}
