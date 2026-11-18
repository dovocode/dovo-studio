import { expect, it } from 'vite-plus/test'
import { recordedApprovalDecision, selectTaskApprovals } from './approval-selection'

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
  expect(recordedApprovalDecision([...ignored, event], 'child', 'target')).toBe('session')
  expect(recordedApprovalDecision(ignored, 'child', 'target')).toBeUndefined()
})
