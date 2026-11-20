import { expect, it } from 'vite-plus/test'
import { recordedApprovalOutcome, selectTaskApprovals } from './approval-selection'

const requests = [{ id: 'first' }, { id: 'target' }]
it('selects only the exact visible approval', () => {
  expect(selectTaskApprovals(requests, 'target')).toEqual([{ id: 'target' }])
})
it('never falls back when the exact request is resolved, removed, or outside this task family', () => {
  expect(selectTaskApprovals(requests, 'missing')).toEqual([])
  expect(selectTaskApprovals([], 'target')).toEqual([])
  expect(selectTaskApprovals([{ id: 'first' }], 'target')).toEqual([])
})
it('shows ordinary pending requests only when no exact request was selected', () => {
  expect(selectTaskApprovals(requests)).toBe(requests)
})

it('recovers only the exact recorded decision after a submission reply is lost', () => {
  const event = {
    id: 'event',
    time: '',
    kind: 'approval',
    scope: 'child',
    summary: '',
    payload: JSON.stringify({ id: 'target', status: 'resolved', decision: 'session' }),
  }
  const ignored = [
    { ...event, scope: 'other' },
    { ...event, kind: 'tool' },
    { ...event, payload: '{broken' },
    {
      ...event,
      payload: JSON.stringify({ id: 'target', status: 'requested', decision: 'approve' }),
    },
    { ...event, payload: JSON.stringify({ id: 'next', status: 'resolved', decision: 'deny' }) },
  ]
  // The parent's family includes the child that asked. Unrelated threads never count.
  const family = new Set(['parent', 'child'])
  expect(recordedApprovalOutcome([...ignored, event], family, 'target')).toEqual({
    decision: 'session',
  })
  expect(recordedApprovalOutcome(ignored, family, 'target')).toBeUndefined()
  expect(recordedApprovalOutcome([event], new Set(['parent']), 'target')).toBeUndefined()
})

it('shows that a request ended without a decision, rather than a recorded denial', () => {
  const ended = (reason?: string) => ({
    id: 'event',
    time: '',
    kind: 'approval',
    scope: 'child',
    summary: '',
    payload: JSON.stringify({
      id: 'target',
      status: 'resolved',
      allow: false,
      decision: 'deny',
      ...(reason ? { reason } : {}),
    }),
  })
  const family = new Set(['parent', 'child'])
  for (const reason of ['withdrawn', 'expired', 'access-changed', 'cancelled'] as const)
    expect(recordedApprovalOutcome([ended(reason)], family, 'target')).toEqual({ ended: reason })
  // A newer runtime's reason is still not a decision.
  expect(recordedApprovalOutcome([ended('superseded')], family, 'target')).toEqual({
    ended: 'other',
  })
  // Older runtimes record no reason. Their denial stays a denial.
  expect(recordedApprovalOutcome([ended()], family, 'target')).toEqual({ decision: 'deny' })
})
