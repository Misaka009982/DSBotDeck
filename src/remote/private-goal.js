// SPDX-License-Identifier: Apache-2.0
// 同一目标入口共享操作状态；只有用户明确操作才提交，迟到回包不改变新页面。
import { createElement as h, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { call } from '@dsbot/client/api.js'
import { GoalOperations, GOAL_LABELS, goalFailure, goalLive, goalReply, goalRequest, goalStamp, observedGoal, privateGoal, privateGoalCanRun, privateGoalMode, privateGoalTarget } from '../shared/private-goal.ts'
import { ResourceContext } from './resource-read.js'
import { useDetailAvailability } from './tool-detail.js'
import './private-goal.css'
const operations = new GoalOperations()
const visible = node => document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached') && node?.isConnected && !node.closest('[data-leaving]')
function usePrivateGoal(botId) {
  const context = useContext(ResourceContext); const shown = useDetailAvailability()
  const node = useRef(null); const latest = useRef(null); const request = useRef(null)
  const [message, setMessage] = useState(null)
  useSyncExternalStore(operations.subscribe, () => operations.revision)
  const mode = privateGoalMode(context.roster); const target = privateGoalTarget(context.roster, botId)
  let goal = null; let invalid = null
  try { if (target) goal = privateGoal(context.roster.byId[botId]?.extras?.goal) } catch (failure) { invalid = goalFailure(failure) }
  const readable = shown && !context.cached && mode === 'ready' && target !== null && typeof context.actions?.deckRefreshGoals === 'function'
  const writable = readable && !context.roster?.readOnly && !invalid
  const canRun = privateGoalCanRun(context.roster, botId)
  const identity = JSON.stringify([target, context.epoch, context.selection, context.cached, shown, mode, Boolean(context.roster?.readOnly), canRun])
  latest.current = { identity, target, goal, readable, writable, canRun }
  const usable = () => latest.current.identity === identity && latest.current.readable && visible(node.current)
  useLayoutEffect(() => {
    setMessage(null)
    return () => {
      const pending = request.current; request.current = null
      if (pending) { pending.controller.abort(); operations.uncertain(pending.operation, '原界面已关闭或上下文变化，结果待确认；请查询服务器状态。') }
    }
  }, [identity])
  const act = async (action, base = goal, patch, expectedTarget = target) => {
    if (!usable() || !latest.current.writable || request.current) return false
    if (['start', 'resume'].includes(action) && !latest.current.canRun) {
      setMessage('请先在服务器中将消息发送方式设为 steer，或跟随基础设置中的 steer，再手动启动或恢复目标。'); return false
    }
    let payload
    try {
      if (JSON.stringify(target) !== JSON.stringify(expectedTarget) || (['pause', 'stop'].includes(action) ? goal?.id !== base?.id : goalStamp(goal) !== goalStamp(base))) {
        setMessage('目标或私聊已变化；编辑内容已保留，请核对最新状态后重新调整。'); return false
      }
      payload = goalRequest(target, base, action, patch)
    } catch (failure) { setMessage(goalFailure(failure)); return false }
    return send('write', payload)
  }
  const send = async (kind, payload) => {
    if (!usable() || request.current) return false
    let operation
    try { operation = operations.begin(target, kind) } catch (failure) { setMessage(goalFailure(failure)); return false }
    const controller = new AbortController(); const pending = { controller, operation }; request.current = pending; setMessage(null)
    const current = () => request.current === pending && !controller.signal.aborted && usable()
    try {
      let receipt = null
      if (kind === 'write') {
        const value = await call('extra-goal-control', payload, controller.signal)
        if (!current()) throw new Error('context-changed')
        receipt = goalReply(value, payload)
      }
      // 显式读取完整状态；不从普通回复、流式片段或本地按钮状态推断目标结果。
      const roster = await context.actions.deckRefreshGoals(controller.signal)
      if (!current()) throw new Error('context-changed')
      const refreshed = privateGoalTarget(roster, botId)
      if (!refreshed || refreshed.sessionId !== target.sessionId) throw new Error('session-changed')
      observedGoal(roster.byId[botId]?.extras?.goal, receipt)
      operations.finish(operation)
      setMessage(kind === 'write' ? '目标操作已返回，已重新读取服务器当前状态。' : '已重新读取当前目标；旧请求不会自动重发，请核对状态后再操作。')
      return true
    } catch (failure) {
      operations.uncertain(operation, current() ? goalFailure(failure) : '操作或状态读取已中断，结果待确认；请查询服务器状态。')
      return false
    } finally { if (request.current === pending) request.current = null }
  }
  return { node, target, goal, mode, readable, writable, canRun, message: invalid ?? message, operation: operations.get(botId), act, refresh: () => send('read') }
}
function GoalFeedback({ view }) {
  return h('div', { className: 'deck-goal-feedback' },
    view.operation?.phase === 'busy' ? h('p', { role: 'status' }, '正在等待服务器确认…') : null,
    view.operation?.message ? h('p', { role: 'alert' }, view.operation.message) : null,
    view.message ? h('p', { role: 'status' }, view.message) : null,
    view.operation?.phase === 'unknown' ? h('button', { type: 'button', className: 'bt-soft', disabled: !view.readable, onClick: () => { void view.refresh() } }, '查询服务器状态') : null)
}
export function PrivateGoalSettings({ botId, Card }) {
  const view = usePrivateGoal(botId)
  const [draft, setDraft] = useState(null); const [confirmStop, setConfirmStop] = useState(null)
  const { goal, target } = view
  // 进展和正常换段不覆盖输入；换段后必须核对新目标与会话再提交。
  const identity = botId
  useLayoutEffect(() => { setDraft(null); setConfirmStop(null) }, [identity])
  useLayoutEffect(() => { setConfirmStop(null) }, [goal?.id, goal?.status, view.readable])
  if (view.mode === 'missing') return null
  if (view.mode === 'incompatible' || !target) return h(Card, { title: '私聊目标模式' }, h('p', { className: 'deck-goal-hint' }, '此服务器的目标协议不兼容，或 Bot 当前私聊不可用。'))
  const locked = !view.writable || Boolean(view.operation)
  const currentDraft = draft?.identity === identity ? draft : null
  const changed = currentDraft && (goalStamp(currentDraft.base) !== goalStamp(goal) || currentDraft.target.sessionId !== target.sessionId)
  const edit = () => { setDraft({ identity, target, base: goal, objective: goalLive(goal) ? goal.objective : '', acceptance: goalLive(goal) ? goal.acceptance : '' }); setConfirmStop(null) }
  const submit = async () => {
    if (!currentDraft || changed) return
    const ok = await view.act(goalLive(currentDraft.base) ? 'revise' : 'start', currentDraft.base, currentDraft, currentDraft.target)
    if (ok) setDraft(value => value === currentDraft ? null : value)
  }
  const field = (name, label) => h('label', { className: 'bt-set-row bt-bs-row bt-bs-stack' }, h('span', { className: 'bt-bs-label' }, label),
    h('textarea', { className: 'bt-bs-input bt-bs-area', value: currentDraft[name], maxLength: 4000, disabled: locked, 'aria-label': label,
      onChange: event => { const text = event.target.value; setDraft(value => value === currentDraft ? { ...value, [name]: text } : value) } }))
  return h(Card, { title: '私聊目标模式' }, h('div', { ref: view.node, className: 'deck-goal-settings' },
    h('p', { className: 'deck-goal-hint' }, '为当前长任务设置目标和验收标准。仅有效消息发送方式为 steer 时可启动或恢复，支持 Bot 独立设置或跟随基础设置；切离后保留目标并暂停，切回须手动恢复。开启后由服务器持续推进，等待审批、问题或其他工作时暂停推进；不会额外授予权限。'),
    !view.canRun ? h('p', { className: 'deck-goal-hint', role: 'status' }, '请先在服务器的 Bot 设置中将消息发送方式设为 steer，或跟随基础设置中的 steer，才能启动或恢复目标。') : null,
    goal ? h('div', { className: 'deck-goal-current' },
      h('strong', null, GOAL_LABELS[goal.status]), h('p', null, goal.objective),
      h('details', null, h('summary', null, '验收、进展与证据'),
        h('dl', null, h('dt', null, '验收标准'), h('dd', null, goal.acceptance),
          h('dt', null, '最近进展'), h('dd', null, goal.progress || '尚未记录'),
          h('dt', null, '完成／进展证据'), h('dd', null, goal.evidence || '尚未记录')),
        h('p', { className: 'deck-goal-hint' }, `已请求自动续跑 ${goal.rounds} 次。证据由 Bot 报告，需要按验收标准核对。`)),
      goal.reason ? h('p', { className: 'deck-goal-reason' }, goal.reason) : null) : h('p', { className: 'deck-goal-hint' }, '普通聊天不会自动开启目标。'),
    currentDraft ? h('div', null, field('objective', '目标'), field('acceptance', '验收标准'),
      changed ? h('p', { role: 'alert', className: 'deck-goal-hint' }, '服务器目标或当前私聊已更新，输入已保留。请先比较上面的当前目标，再重新编辑。') : null,
      h('div', { className: 'deck-goal-actions' },
        h('button', { type: 'button', className: 'bt-soft', disabled: locked || changed || !goalLive(currentDraft.base) && !view.canRun || !currentDraft.objective.trim() || !currentDraft.acceptance.trim(), onClick: () => { void submit() } }, goalLive(currentDraft.base) ? '保存目标调整' : '启动目标'),
        changed ? h('button', { type: 'button', className: 'bt-soft', disabled: locked, onClick: () => setDraft(value => value === currentDraft ? { ...value, base: goal, target } : value) }, '已核对，保留输入重新编辑') : null,
        h('button', { type: 'button', className: 'bt-soft', disabled: view.operation?.phase === 'busy', onClick: () => setDraft(null) }, '取消编辑'))) : null,
    h('div', { className: 'deck-goal-actions' },
      !currentDraft ? h('button', { type: 'button', className: 'bt-soft', disabled: locked, onClick: edit }, goalLive(goal) ? '调整目标' : '设置新目标') : null,
      goalLive(goal) ? h('button', { type: 'button', className: 'bt-soft', disabled: locked || goal.status !== 'active' && !view.canRun, onClick: () => { void view.act(goal.status === 'active' ? 'pause' : 'resume') } }, goal.status === 'active' ? '暂停自动推进' : '恢复目标') : null,
      goalLive(goal) ? h('button', { type: 'button', className: 'bt-soft', disabled: locked, onClick: () => setConfirmStop(goal.id) }, '终止目标') : null,
      h('button', { type: 'button', className: 'bt-soft', disabled: !view.readable || view.operation?.phase === 'busy', onClick: () => { void view.refresh() } }, '重新读取状态')),
    goalLive(goal) && confirmStop === goal.id ? h('div', { className: 'deck-goal-confirm' }, h('p', null, '确认终止这个目标的后续自动推进？当前轮次可能仍在执行。'),
      h('button', { type: 'button', className: 'bt-soft', disabled: locked, onClick: () => { void view.act('stop').then(ok => { if (ok) setConfirmStop(null) }) } }, '确认终止'),
      h('button', { type: 'button', className: 'bt-soft', onClick: () => setConfirmStop(null) }, '取消')) : null,
    h('p', { className: 'deck-goal-hint' }, '暂停或终止只停止后续自动推进。立即结束当前工作请使用聊天停止按钮；恢复会继续使用模型额度。'),
    h(GoalFeedback, { view })))
}
