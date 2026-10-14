import { expect, it } from 'vite-plus/test'
import { defaultTaskHarness } from '@dovo/protocol'
import { permissionPolicyUIIssue } from './permission-policy'

it('legacy modes keep working on runtimes without separate policy support', () => {
  expect(permissionPolicyUIIssue(defaultTaskHarness('codex'), false)).toBeUndefined()
  expect(
    permissionPolicyUIIssue({ ...defaultTaskHarness('claude'), permission: 'ask' }, false),
  ).toBeUndefined()
})

it('explicit policy fields require confirmed support even when they match legacy defaults', () => {
  for (const policy of [
    { approvalPolicy: 'never' as const },
    { sandboxMode: 'danger-full-access' as const },
    { approvalPolicy: 'on-request' as const, sandboxMode: 'read-only' as const },
  ]) {
    expect(permissionPolicyUIIssue({ ...defaultTaskHarness('codex'), ...policy }, false)).toMatch(
      /Update this runtime/,
    )
    expect(
      permissionPolicyUIIssue({ ...defaultTaskHarness('codex'), ...policy }, true),
    ).toBeUndefined()
  }
})

it('unsupported saved policies remain actionable until the user clears them', () => {
  const claude = { ...defaultTaskHarness('claude'), sandboxMode: 'workspace-write' as const }
  expect(permissionPolicyUIIssue(claude, true)).toMatch(/does not support sandbox/)
  expect(
    permissionPolicyUIIssue(
      { ...claude, sandboxMode: undefined, approvalPolicy: 'on-request' },
      true,
    ),
  ).toBeUndefined()
  expect(
    permissionPolicyUIIssue({ ...defaultTaskHarness('cursor'), approvalPolicy: 'never' }, true),
  ).toMatch(/does not support approval/)
})
