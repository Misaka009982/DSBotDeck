// SPDX-License-Identifier: Apache-2.0
// 顶部入口仅分配已存在的设置／详情动作，不发送远程写请求。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { HeaderActions } from '../src/remote/header-actions.js'

test('Bot名称只打开其稳定编号设置，头像和尾部仍调用原详情动作', () => {
  const calls: unknown[][] = []
  const view = HeaderActions({ botId: 'bot-a', name: '同名 Bot', openSettings: (page: string, id: string) => calls.push([page, id]),
    type: 'button', className: 'bt-pill', 'aria-expanded': true, onClick: () => calls.push(['details', 'part-a']),
    children: ['头像', '同名 Bot', null, '箭头'] })
  assert.equal(view.type, 'div')
  const [avatar, name, tail] = view.props.children
  assert.equal(avatar.type, 'button'); assert.equal(name.type, 'button'); assert.equal(tail.type, 'button')
  name.props.onClick(); assert.deepEqual(calls, [['bots', 'bot-a']])
  avatar.props.onClick(); tail.props.onClick()
  assert.deepEqual(calls, [['bots', 'bot-a'], ['details', 'part-a'], ['details', 'part-a']])
  assert.equal(name.props.title, '打开 同名 Bot 设置')
})
test('群聊、返回聊天和未提供设置动作仍沿用原按钮，不借Bot名称改目标', () => {
  let opened = 0
  const children = ['原名称']
  for (const botId of [undefined, null, '']) {
    const view = HeaderActions({ botId, name: '原名称', openSettings: () => { throw new Error('不应打开Bot设置') },
      children, type: 'button', className: 'bt-pill', onClick: () => { opened++ } })
    assert.equal(view.type, 'button'); assert.equal(view.props.children, children)
    view.props.onClick()
  }
  assert.equal(opened, 3)
})
