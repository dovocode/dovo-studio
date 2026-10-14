import type { Agent, ApprovalPolicy, SandboxMode, ProjectTaskDefaults } from '../workspace.js'
import { accessLabel } from './access.js'
import { delegatedAccess } from '../tasks/delegation.js'

export type PermissionPolicy = Pick<
  Agent,
  'provider' | 'permission' | 'approvalPolicy' | 'sandboxMode'
>

/** Selecting a preset deliberately replaces custom controls, including on repeat selection. */
export function selectPermissionPreset<T extends { permission: Agent['permission'] }>(
  value: T,
  permission: Agent['permission'],
) {
  return { ...value, permission, approvalPolicy: undefined, sandboxMode: undefined }
}

/** Null resets an inherited control; undefined continues to inherit it. */
export function selectDefaultPermissionPreset(
  value: ProjectTaskDefaults,
  permission: Agent['permission'] | undefined,
  controlsSupported = true,
): ProjectTaskDefaults {
  // An old runtime cannot persist explicit resets of inherited advanced controls.
  if (!controlsSupported) return { ...value, permission }
  return {
    ...value,
    permission,
    approvalPolicy: permission ? null : undefined,
    sandboxMode: permission ? null : undefined,
  }
}

export function resolveDefaultPermissionPolicy(
  harness: PermissionPolicy,
  ...layers: (
    | Pick<ProjectTaskDefaults, 'permission' | 'approvalPolicy' | 'sandboxMode'>
    | undefined
  )[]
): PermissionPolicy {
  let result = harness
  for (const layer of layers) {
    if (!layer) continue
    result = {
      ...result,
      permission: layer.permission ?? result.permission,
      approvalPolicy:
        layer.approvalPolicy === undefined
          ? result.approvalPolicy
          : (layer.approvalPolicy ?? undefined),
      sandboxMode:
        layer.sandboxMode === undefined ? result.sandboxMode : (layer.sandboxMode ?? undefined),
    }
  }
  return result
}

export function permissionPolicyLabel(value: PermissionPolicy) {
  return value.approvalPolicy || value.sandboxMode ? 'Custom' : accessLabel(value.permission)
}

export function permissionPolicySummary(value: PermissionPolicy) {
  const policy = effectivePermissionPolicy(value)
  const approvals = policy.automaticReview
    ? 'provider auto-review'
    : policy.autoAcceptEdits
      ? 'edits automatic, other actions ask'
      : policy.approvalPolicy
  const sandbox = value.provider === 'codex' ? policy.sandboxMode : 'not exposed'
  return `${accessLabel(value.permission)} · approvals: ${approvals} · sandbox: ${sandbox}${value.provider !== 'codex' && policy.readOnly ? ' · read-only tools' : ''}`
}

const approvals: readonly ApprovalPolicy[] = ['untrusted', 'on-failure', 'on-request', 'never']
const sandboxes: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const mediatedApprovals: readonly ApprovalPolicy[] = ['on-request', 'never']

/** Capabilities describe execution guarantees, independently of model discovery. */
export function permissionPolicyCapabilities(provider: Agent['provider']) {
  return {
    approvalPolicies:
      provider === 'codex'
        ? approvals
        : ['claude', 'acp', 'copilot', 'opencode'].includes(provider)
          ? mediatedApprovals
          : [],
    sandboxModes: provider === 'codex' ? sandboxes : [],
    approvalDescription:
      provider === 'codex'
        ? 'Codex enforces the selected approval policy.'
        : ['claude', 'acp', 'copilot', 'opencode'].includes(provider)
          ? 'Controls provider permission requests and Dovo tool callbacks. The provider controls which native actions request approval.'
          : 'This provider does not support separate approval controls. Use its access mode.',
    sandboxDescription:
      provider === 'codex'
        ? 'Codex enforces the selected filesystem sandbox.'
        : 'This provider does not expose an equivalent filesystem sandbox. Use its access mode.',
  }
}

export function permissionPolicyIssue(agent: PermissionPolicy): string | undefined {
  const capabilities = permissionPolicyCapabilities(agent.provider)
  if (agent.approvalPolicy && !capabilities.approvalPolicies.includes(agent.approvalPolicy))
    return `${agent.provider} does not support approval policy ${agent.approvalPolicy}`
  if (agent.sandboxMode && !capabilities.sandboxModes.includes(agent.sandboxMode))
    return `${agent.provider} does not support sandbox mode ${agent.sandboxMode}`
  return undefined
}

function defaultApproval(agent: PermissionPolicy): ApprovalPolicy {
  return ['read-only', 'full-access'].includes(agent.permission) ? 'never' : 'on-request'
}

function defaultSandbox(agent: PermissionPolicy): SandboxMode {
  if (agent.permission === 'read-only') return 'read-only'
  if (agent.provider !== 'codex' || agent.permission === 'full-access') return 'danger-full-access'
  return agent.permission === 'ask' ? 'read-only' : 'workspace-write'
}

/** Legacy modes remain defaults; hard restrictions always take precedence. */
export function effectivePermissionPolicy(
  agent: PermissionPolicy,
  restrictions: { textOnly?: boolean; readOnlyCheckout?: boolean } = {},
) {
  const textOnly = restrictions.textOnly === true
  const readOnly =
    textOnly ||
    restrictions.readOnlyCheckout === true ||
    agent.permission === 'read-only' ||
    agent.sandboxMode === 'read-only'
  return {
    approvalPolicy: readOnly ? 'never' : (agent.approvalPolicy ?? defaultApproval(agent)),
    sandboxMode: readOnly ? 'read-only' : (agent.sandboxMode ?? defaultSandbox(agent)),
    readOnly,
    textOnly,
    automaticReview: !readOnly && !agent.approvalPolicy && agent.permission === 'auto',
    autoAcceptEdits: !readOnly && !agent.approvalPolicy && agent.permission === 'workspace-write',
  }
}

/** Also usable by host-owned tools which must check the current saved policy. */
export function permissionPolicyReadOnly(agent: PermissionPolicy | undefined) {
  return !!agent && effectivePermissionPolicy(agent).readOnly
}

const approvalRank: Record<ApprovalPolicy, number> = {
  untrusted: 0,
  'on-request': 1,
  'on-failure': 2,
  never: 3,
}
const sandboxRank: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

export type PermissionLimits = Partial<
  Pick<PermissionPolicy, 'permission' | 'approvalPolicy' | 'sandboxMode'>
>

/** A child follows the parent except for deliberately narrower dimensions. */
export function inheritedPermissionPolicy(
  parent: PermissionPolicy,
  child: PermissionPolicy,
  limits: PermissionLimits = {},
  readOnlyCheckout = false,
): PermissionPolicy {
  const permission = delegatedAccess(
    readOnlyCheckout ? 'read-only' : parent.permission,
    limits.permission ?? parent.permission,
  )
  const inherited = {
    ...child,
    permission,
    approvalPolicy: parent.approvalPolicy,
    sandboxMode: parent.sandboxMode,
  }
  const policy = effectivePermissionPolicy(inherited, { readOnlyCheckout })
  return {
    ...inherited,
    approvalPolicy:
      limits.approvalPolicy &&
      approvalRank[limits.approvalPolicy] < approvalRank[policy.approvalPolicy]
        ? limits.approvalPolicy
        : parent.approvalPolicy,
    sandboxMode: readOnlyCheckout
      ? undefined
      : limits.sandboxMode && sandboxRank[limits.sandboxMode] < sandboxRank[policy.sandboxMode]
        ? limits.sandboxMode
        : parent.sandboxMode,
  }
}

/** Upgrade legacy children without widening restrictions saved before inheritance metadata. */
export function narrowerPermissionLimits(
  parent: PermissionPolicy,
  child: PermissionPolicy,
): PermissionLimits {
  const parentPolicy = effectivePermissionPolicy(parent)
  const childPolicy = effectivePermissionPolicy(child)
  return {
    ...(parent.permission !== child.permission &&
    delegatedAccess(parent.permission, child.permission) === child.permission
      ? { permission: child.permission }
      : {}),
    ...(child.approvalPolicy &&
    approvalRank[childPolicy.approvalPolicy] < approvalRank[parentPolicy.approvalPolicy]
      ? { approvalPolicy: child.approvalPolicy }
      : {}),
    ...(child.sandboxMode &&
    sandboxRank[childPolicy.sandboxMode] < sandboxRank[parentPolicy.sandboxMode]
      ? { sandboxMode: child.sandboxMode }
      : {}),
  }
}

export function samePermissionPolicy(
  left: PermissionPolicy | undefined,
  right: PermissionPolicy | undefined,
) {
  return (
    left?.provider === right?.provider &&
    left?.permission === right?.permission &&
    left?.approvalPolicy === right?.approvalPolicy &&
    left?.sandboxMode === right?.sandboxMode
  )
}

/** Compare effective guarantees, including legacy presets, for live authority invalidation. */
export function permissionPolicyTightened(before: PermissionPolicy, after: PermissionPolicy) {
  const old = effectivePermissionPolicy(before)
  const next = effectivePermissionPolicy(after)
  return (
    delegatedAccess(before.permission, after.permission) !== before.permission ||
    approvalRank[next.approvalPolicy] < approvalRank[old.approvalPolicy] ||
    sandboxRank[next.sandboxMode] < sandboxRank[old.sandboxMode] ||
    (old.automaticReview && !next.automaticReview && next.approvalPolicy !== 'never') ||
    (old.autoAcceptEdits && !next.autoAcceptEdits && next.approvalPolicy !== 'never')
  )
}

/** Clearing an inherited explicit control cannot evade the parent's effective ceiling. */
export function permissionPolicyWithinCeiling(
  parent: PermissionPolicy,
  child: PermissionPolicy,
  readOnlyCheckout = false,
) {
  const access = readOnlyCheckout ? 'read-only' : parent.permission
  if (delegatedAccess(access, child.permission) !== child.permission) return false
  if (
    (parent.approvalPolicy || child.approvalPolicy) &&
    approvalRank[child.approvalPolicy ?? defaultApproval(child)] >
      approvalRank[parent.approvalPolicy ?? defaultApproval(parent)]
  )
    return false
  if (
    (parent.sandboxMode || child.sandboxMode) &&
    sandboxRank[effectivePermissionPolicy(child).sandboxMode] >
      sandboxRank[effectivePermissionPolicy(parent, { readOnlyCheckout }).sandboxMode]
  )
    return false
  return true
}
