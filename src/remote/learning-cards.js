// SPDX-License-Identifier: Apache-2.0
// 复用原网页学习差异卡；只连接当前私聊的提案和原学习审批接口。
import { createElement as h, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { call } from '@dsbot/client/api.js'
import { ProposalCard } from '@dsbot/client/learning-card.js'
import { LearningAnswers, learningFailure, learningProposals, learningRequest, learningTarget } from '../shared/learning-model.ts'
import { DeckError } from '../shared/validation.ts'
import { ResourceContext } from './resource-read.js'
import { useDetailAvailability } from './tool-detail.js'
const answers = new LearningAnswers()
export function LearningCards({ sessionId }) {
  const context = useContext(ResourceContext); const shown = useDetailAvailability()
  const node = useRef(null); const latest = useRef(null); const request = useRef(null)
  const [message, setMessage] = useState(''); const [refreshing, setRefreshing] = useState(false)
  useSyncExternalStore(answers.subscribe, () => answers.revision)
  const target = learningTarget(context.roster, sessionId)
  let proposals = { pending: [], settled: [] }; let invalid = ''
  try { proposals = learningProposals(context.roster, target) } catch (error) { invalid = error.message }
  const readable = shown && !context.cached && context.selection === sessionId && target !== null
  const writable = readable && context.mode === 'phone' && !context.roster?.readOnly && !invalid
  const identity = JSON.stringify([target, context.epoch, context.selection, context.cached, shown, context.mode, Boolean(context.roster?.readOnly)])
  latest.current = { identity, roster: context.roster, readable, writable }
  const usable = () => latest.current.identity === identity && latest.current.readable && node.current?.isConnected
    && document.visibilityState === 'visible' && !document.body.hasAttribute('data-deck-cached') && !node.current.closest('[data-leaving]')
  useEffect(() => { if (readable && !invalid) answers.reconcile(target, proposals.settled) }, [identity, invalid, context.roster?.learningSettled])
  useLayoutEffect(() => {
    setMessage(''); setRefreshing(false)
    return () => {
      const pending = request.current; request.current = null
      if (pending) {
        pending.controller.abort()
        if (pending.operation) answers.fail(pending.operation, { code: 'bot/outcome-unknown' })
      }
    }
  }, [identity])
  const refresh = async () => {
    if (!usable() || request.current) return
    const pending = { controller: new AbortController() }; request.current = pending; setRefreshing(true)
    try {
      await context.actions.deckRefreshLearning(pending.controller.signal)
      if (request.current === pending && usable()) setMessage('已刷新服务器提案；尚未确认的审批不会自动重发。')
    } catch {
      if (request.current === pending && usable()) setMessage('学习提案刷新未完成，请恢复连接后重试。')
    } finally { if (request.current === pending) { request.current = null; setRefreshing(false) } }
  }
  const answer = async (proposal, approve) => {
    if (!usable() || !latest.current.writable) throw new DeckError('bot/read-only', '当前界面不可提交学习审批。')
    if (request.current) throw new DeckError('bot/busy', '正在处理学习审批，请等待当前请求完成。')
    const payload = learningRequest(latest.current.roster, target, proposal, approve)
    const operation = answers.begin(target, proposal.id)
    const pending = { controller: new AbortController(), operation }; request.current = pending; setMessage('')
    try {
      const value = await call('learning-answer', payload, pending.controller.signal)
      if (request.current !== pending || !usable()) throw new DeckError('bot/outcome-unknown', '原界面已变化，学习审批结果待确认。')
      answers.finish(operation, value, approve)
      // 回执已确认时立即折叠；后续刷新失败不能把已批准/拒绝降回可提交。
      setRefreshing(true)
      await context.actions.deckRefreshLearning(pending.controller.signal).catch(() => {})
    } catch (error) {
      answers.fail(operation, error)
      throw new DeckError(error?.code ?? 'bot/outcome-unknown', learningFailure(error))
    } finally { if (request.current === pending) { request.current = null; setRefreshing(false) } }
  }
  if (!readable) return null
  const settledIds = new Set(proposals.settled.map(proposal => proposal.id))
  const cards = [...proposals.settled, ...proposals.pending.filter(proposal => !settledIds.has(proposal.id))]
  if (cards.length === 0 && !invalid && !message) return null
  const sending = cards.some(proposal => answers.get(proposal.id)?.phase === 'busy')
  const reason = context.mode !== 'phone' ? '当前配对权限不能批准学习提案；请在服务器处理，或使用手机配对码连接。'
    : context.roster?.readOnly ? '服务器当前只读，学习提案可查看，暂不能批准或拒绝。' : ''
  return h('section', { ref: node, className: 'bt-learning-stack deck-learning-cards', 'aria-label': '学习提案审批' },
    reason ? h('p', { className: 'bt-hint', role: 'note' }, reason) : null,
    invalid || message ? h('p', { className: 'bt-learning-error', role: 'status' }, invalid || message) : null,
    cards.map(proposal => {
      const operation = proposal.outcome ? undefined : answers.get(proposal.id)
      const confirmed = operation && ['approved', 'declined'].includes(operation.phase) ? { ...proposal, outcome: operation.phase } : proposal
      return h('div', { key: JSON.stringify([target, proposal.id]), className: 'bt-q-inline' },
        operation?.message ? h('p', { className: 'bt-learning-error', role: 'status' }, operation.message) : null,
        operation?.phase === 'stale' ? null : h(ProposalCard, { proposal: confirmed, disabled: !writable || refreshing || sending || operation !== undefined,
          actions: { learningAnswer: (_id, approve) => answer(proposal, approve) }, onResolved: () => {}, onFailure: () => {} }))
    }),
    h('button', { type: 'button', className: 'bt-soft', disabled: !readable || refreshing || sending, onClick: refresh }, refreshing ? '正在刷新提案…' : '刷新学习提案'))
}
