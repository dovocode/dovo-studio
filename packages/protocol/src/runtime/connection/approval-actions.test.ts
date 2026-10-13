import { expect, it } from 'vite-plus/test'
import { approvalActions } from './runtime.js'

it('offers only once and deny without native scopes or a remember rule', () => {
  expect(approvalActions({ title: 'Apply file changes', rememberRule: null })).toEqual([
    { decision: 'approve', label: 'Allow once' },
    { decision: 'deny', label: 'Deny' },
  ])
})

it('offers native session and always scopes in widening order', () => {
  expect(
    approvalActions({
      title: 'Run shell command',
      rememberRule: null,
      scopes: { session: true, always: true },
    }),
  ).toEqual([
    { decision: 'approve', label: 'Allow once' },
    { decision: 'session', label: 'Allow for session' },
    { decision: 'always', label: 'Always allow' },
    { decision: 'deny', label: 'Deny' },
  ])
})

it('labels a remembered command rule instead of a generic always action', () => {
  expect(
    approvalActions({
      title: 'Run shell command',
      rememberRule: 'command',
      scopes: { session: false, always: true },
    }).map((action) => action.label),
  ).toEqual(['Allow once', 'Always allow in this project', 'Deny'])
  expect(
    approvalActions({ title: 'WebFetch', rememberRule: 'web' }).map((action) => action.label),
  ).toEqual(['Allow once', 'Always allow web in this project', 'Deny'])
})
