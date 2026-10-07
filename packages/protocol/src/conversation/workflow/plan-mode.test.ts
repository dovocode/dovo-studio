import { expect, it } from 'vite-plus/test'
import { planAwaitingApproval } from './plan-mode.js'

it('waits for approval only after the agent answered a plan-mode message', () => {
  const base = { status: 'review' as const, queue: [] }
  const plan = { id: 'u', role: 'user' as const, text: 'Add login', plan: true }
  const reply = { id: 'a', role: 'assistant' as const, text: '1. Do it' }
  expect(planAwaitingApproval({ ...base, messages: [plan, reply] })).toBe(true)
  expect(planAwaitingApproval({ ...base, messages: [plan] })).toBe(false)
  expect(planAwaitingApproval({ ...base, status: 'running', messages: [plan, reply] })).toBe(false)
  expect(
    planAwaitingApproval({
      ...base,
      messages: [plan, reply, { id: 'n', role: 'user', text: 'Go' }, reply],
    }),
  ).toBe(false)
})
