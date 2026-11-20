import { expect, it } from 'vite-plus/test'
import { approvalActions, inputPreviewApprovalDecision } from './index'

const approval = { title: 'Run tests', rememberRule: null }

it('accepts only an approval action that the request offers', () => {
  const restricted = { ...approval, scopes: { session: true, always: false } }
  // Older renderers send a boolean. It maps to Allow once or Deny.
  expect(inputPreviewApprovalDecision(approval, { answer: true })).toBe('approve')
  expect(inputPreviewApprovalDecision(approval, { answer: false })).toBe('deny')
  expect(
    inputPreviewApprovalDecision(
      { ...approval, scopes: { session: true, always: true } },
      { answer: true, decision: 'always' },
    ),
  ).toBe('always')
  // A decision must agree with allow or deny.
  expect(() =>
    inputPreviewApprovalDecision(approval, { answer: false, decision: 'approve' }),
  ).toThrow('Invalid response')
  expect(() => inputPreviewApprovalDecision(approval, { answer: null })).toThrow('Invalid response')
  // A scope the provider did not offer is never sent.
  expect(() =>
    inputPreviewApprovalDecision(approval, { answer: true, decision: 'session' }),
  ).toThrow('not available')
  // Without a single-use scope, a boolean or explicit Allow once is rejected.
  const noOnce = { ...approval, scopes: { once: false, session: true, always: false } }
  expect(() => inputPreviewApprovalDecision(noOnce, { answer: true })).toThrow('not available')
  expect(() => inputPreviewApprovalDecision(noOnce, { answer: true, decision: 'approve' })).toThrow(
    'not available',
  )
  expect(inputPreviewApprovalDecision(noOnce, { answer: false })).toBe('deny')
  expect(inputPreviewApprovalDecision(noOnce, { answer: true, decision: 'session' })).toBe(
    'session',
  )
  for (const action of approvalActions(restricted))
    expect(
      inputPreviewApprovalDecision(restricted, {
        answer: action.decision !== 'deny',
        decision: action.decision,
      }),
    ).toBe(action.decision)
})
