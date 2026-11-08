import { expect, it } from 'vite-plus/test'
import {
  planAwaitingApproval,
  planModeAgent,
  planModeIssue,
  planModeRequested,
} from './plan-mode.js'
import { effectivePermissionPolicy } from '../../auth/permission-policy.js'

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

it('narrows only to the read-only preset and refuses harnesses without one', () => {
  const codex = {
    provider: 'codex' as const,
    permission: 'full-access' as const,
    approvalPolicy: 'never' as const,
    sandboxMode: 'danger-full-access' as const,
  }
  expect(planModeAgent(codex)).toEqual({
    provider: 'codex',
    permission: 'read-only',
    approvalPolicy: undefined,
    sandboxMode: undefined,
  })
  expect(effectivePermissionPolicy(planModeAgent(codex))).toMatchObject({
    readOnly: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  })
  expect(planModeIssue(codex)).toBeUndefined()
  expect(planModeIssue({ provider: 'cursor' })).toBeUndefined()
  for (const provider of ['hermes', 'grok', 'muse'] as const)
    expect(planModeIssue({ provider })).toContain('no read-only mode')
  expect(planModeIssue(undefined)).toBeDefined()
})

it('keeps plan mode until a later prompt, ignoring review comments and child results', () => {
  const plan = { id: 'p', role: 'user' as const, text: 'Plan it', plan: true }
  const reply = { id: 'a', role: 'assistant' as const, text: '1. Step' }
  expect(planModeRequested([plan])).toBe(true)
  expect(
    planModeRequested([
      plan,
      reply,
      {
        id: 'c',
        role: 'user',
        text: 'Comment',
        diffComment: { side: 'additions', start: 1, end: 1, excerpt: '', body: 'Fix' },
      },
      { id: 'r', role: 'user', text: 'Child done', subagentResultId: 'child' },
    ]),
  ).toBe(true)
  expect(planModeRequested([plan, reply, { id: 'n', role: 'user', text: 'Implement' }])).toBe(false)
  expect(planModeRequested([])).toBe(false)
})
