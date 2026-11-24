// SPDX-License-Identifier: Apache-2.0
// 前台审批只匹配当前 Bot 与会话，不把群聊或后台任务混入私聊卡。
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { foregroundApprovals } from '../src/shared/approval-model.ts'
const approval = () => ({ id: 'approval-a', botId: 'bot-a', sessionId: 'part-a', tool: 'bash', reason: '需要访问工作区外文件', detail: { text: '服务器公开的审批说明', code: 'fictional-command' }, answerable: true })
test('当前普通私聊的可回答审批保留原请求内容和顺序', () => {
  const first = approval(); const second = { ...approval(), id: 'approval-b' }
  const selected = foregroundApprovals({ approvals: [first, second] }, 'bot-a', 'part-a')
  assert.deepEqual(selected, [first, second]); assert.equal(selected[0], first)
})
test('普通私聊排除其他 Bot、旧会话、群聊、后台与不可回答审批', () => {
  const own = approval()
  const others = [
    { ...own, botId: 'bot-b' }, { ...own, sessionId: 'part-old' },
    { ...own, roomId: 'room-a' }, { ...own, taskId: 'task-a' },
    { ...own, answerable: false }, { ...own, answerable: undefined }, { ...own, answerable: 'true' },
  ]
  assert.deepEqual(foregroundApprovals({ approvals: [...others, own] }, 'bot-a', 'part-a'), [own])
  assert.deepEqual(foregroundApprovals({ approvals: [own] }, undefined, 'part-a'), [])
  assert.deepEqual(foregroundApprovals({ approvals: [own] }, 'bot-a', 'part-next'), [])
})
test('损坏的审批、空请求编号和非文本说明不显示授权卡', () => {
  const own = approval()
  for (const work of [null, true, [], {}, { approvals: {} }]) assert.deepEqual(foregroundApprovals(work, 'bot-a', 'part-a'), [])
  const broken = [null, true, [], {}, { ...own, id: '' }, { ...own, tool: {} }, { ...own, reason: [] }, { ...own, detail: [] }, { ...own, detail: { code: {} } }]
  assert.deepEqual(foregroundApprovals({ approvals: broken }, 'bot-a', 'part-a'), [])
})
