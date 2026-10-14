import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import {
  agentSchema,
  defaultTaskHarness,
  resolveTaskAgent,
  taskModelSchema,
  type Agent,
} from '../workspace.js'
import { changeAgentProvider } from '../tasks/agent-configuration.js'
import {
  effectivePermissionPolicy,
  permissionPolicyCapabilities,
  permissionPolicyIssue,
  permissionPolicyWithinCeiling,
} from './permission-policy.js'

const agent: Agent = {
  ...defaultTaskHarness('codex'),
  id: 'agent',
  name: 'Agent',
}

it('keeps legacy documents optional and clears both task overrides independently', () => {
  expect(decode(agentSchema, agent)).not.toHaveProperty('approvalPolicy')
  expect(decode(agentSchema, agent)).not.toHaveProperty('sandboxMode')
  const harness = {
    ...agent,
    approvalPolicy: 'untrusted' as const,
    sandboxMode: 'workspace-write' as const,
  }
  const resolved = resolveTaskAgent(
    {
      id: 'task',
      agentId: agent.id,
      harness,
      agentOverrides: decode(taskModelSchema, { approvalPolicy: null, sandboxMode: null }),
    },
    [],
  )
  expect(resolved?.approvalPolicy).toBeUndefined()
  expect(resolved?.sandboxMode).toBeUndefined()
  expect(() => decode(agentSchema, { ...agent, approvalPolicy: 'always' })).toThrow(
    /approvalPolicy|untrusted/,
  )
  expect(() => decode(taskModelSchema, { sandboxMode: 'sandboxed' })).toThrow(
    /sandboxMode|read-only/,
  )
})

it('advertises native guarantees only where adapters implement them', () => {
  expect(permissionPolicyCapabilities('codex').approvalPolicies).toEqual([
    'untrusted',
    'on-failure',
    'on-request',
    'never',
  ])
  expect(permissionPolicyCapabilities('codex').sandboxModes).toHaveLength(3)
  for (const provider of ['claude', 'acp', 'copilot', 'opencode'] as const) {
    expect(permissionPolicyCapabilities(provider).approvalPolicies).toEqual(['on-request', 'never'])
    expect(permissionPolicyCapabilities(provider).sandboxModes).toEqual([])
    expect(permissionPolicyIssue({ ...agent, provider, approvalPolicy: 'on-failure' })).toContain(
      'on-failure',
    )
  }
  for (const provider of ['hermes', 'cursor', 'grok', 'muse'] as const) {
    expect(permissionPolicyCapabilities(provider).approvalPolicies).toEqual([])
    expect(permissionPolicyIssue({ ...agent, provider, approvalPolicy: 'never' })).toContain(
      'does not support',
    )
  }
})

it('hard restrictions dominate both fields without changing legacy supervised behavior', () => {
  expect(effectivePermissionPolicy({ ...agent, permission: 'ask' }).readOnly).toBe(false)
  const configured = {
    ...agent,
    approvalPolicy: 'on-failure' as const,
    sandboxMode: 'danger-full-access' as const,
  }
  for (const restrictions of [{ textOnly: true }, { readOnlyCheckout: true }]) {
    expect(effectivePermissionPolicy(configured, restrictions)).toMatchObject({
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      readOnly: true,
      automaticReview: false,
    })
  }
  expect(effectivePermissionPolicy({ ...configured, permission: 'read-only' })).toMatchObject({
    sandboxMode: 'read-only',
    readOnly: true,
  })
  expect(
    effectivePermissionPolicy({ ...agent, permission: 'auto', approvalPolicy: 'on-request' })
      .automaticReview,
  ).toBe(false)
})

it('enforces independent ceilings including clearing controls and cross-provider loss of confinement', () => {
  const parent = {
    ...agent,
    approvalPolicy: 'on-request' as const,
    sandboxMode: 'workspace-write' as const,
  }
  expect(
    permissionPolicyWithinCeiling(parent, {
      ...parent,
      approvalPolicy: 'untrusted',
      sandboxMode: 'read-only',
    }),
  ).toBe(true)
  for (const child of [
    { ...parent, approvalPolicy: 'never' as const },
    { ...parent, approvalPolicy: undefined },
    { ...parent, sandboxMode: 'danger-full-access' as const },
    { ...parent, sandboxMode: undefined },
    { ...parent, provider: 'claude' as const, sandboxMode: undefined },
  ])
    expect(permissionPolicyWithinCeiling(parent, child)).toBe(false)
  expect(permissionPolicyWithinCeiling(parent, { ...parent, permission: 'read-only' }, true)).toBe(
    true,
  )
  expect(
    permissionPolicyWithinCeiling(
      { ...agent, permission: 'ask' },
      { ...agent, provider: 'claude', permission: 'ask' },
    ),
  ).toBe(true)
})

it('clears provider-specific controls with conservative defaults, preserving unrepresentable restrictions', () => {
  const restricted = {
    ...agent,
    approvalPolicy: 'untrusted' as const,
    sandboxMode: 'workspace-write' as const,
  }
  expect(changeAgentProvider(restricted, 'claude')).toMatchObject({
    permission: 'read-only',
    approvalPolicy: undefined,
    sandboxMode: undefined,
  })
  const unsupported = changeAgentProvider(restricted, 'hermes')
  expect(unsupported.permission).toBe('read-only')
  expect(changeAgentProvider({ ...agent, approvalPolicy: 'on-request' }, 'claude').permission).toBe(
    'ask',
  )
  expect(changeAgentProvider(restricted, 'codex')).toBe(restricted)
})

it('makes repeat preset selection replace custom controls rather than merely relabel them', async () => {
  const { selectPermissionPreset, permissionPolicyLabel } = await import('./permission-policy')
  const custom = {
    ...agent,
    permission: 'full-access' as const,
    approvalPolicy: 'on-request' as const,
    sandboxMode: 'workspace-write' as const,
  }
  expect(permissionPolicyLabel(custom)).toBe('Custom')
  const selected = selectPermissionPreset(custom, 'full-access')
  expect(permissionPolicyLabel(selected)).toBe('Full access')
  expect(effectivePermissionPolicy(selected)).toMatchObject({
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  })
})

it('describes native confinement and legacy automatic approval modes without promising unsupported guarantees', async () => {
  const { permissionPolicySummary } = await import('./permission-policy')
  expect(
    permissionPolicySummary({ ...agent, provider: 'claude', permission: 'read-only' }),
  ).toContain('sandbox: not exposed · read-only tools')
  expect(permissionPolicySummary({ ...agent, provider: 'cursor', permission: 'auto' })).toContain(
    'approvals: provider auto-review',
  )
  expect(permissionPolicySummary({ ...agent, permission: 'workspace-write' })).toContain(
    'approvals: edits automatic, other actions ask',
  )
  expect(
    permissionPolicySummary({ ...agent, permission: 'auto', approvalPolicy: 'on-request' }),
  ).toContain('approvals: on-request')
})
