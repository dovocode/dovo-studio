import { effectivePermissionPolicy, permissionPolicyIssue, type Agent } from '@dovo/protocol'
import type { AgentRun } from '../../execution/types.js'

/** Validate before provider launch; restrict callbacks as well as native settings. */
export function checkedPolicyRun(run: AgentRun, provider: Agent['provider']): AgentRun {
  const issue = permissionPolicyIssue({ ...run.agent, provider })
  if (issue) throw new Error(issue)
  const policy = effectivePermissionPolicy(run.agent, { textOnly: run.tools === 'none' })
  return policy.readOnly && run.agent.permission !== 'read-only'
    ? { ...run, agent: { ...run.agent, permission: 'read-only' } }
    : run
}

/** Only governs operations mediated by Dovo; it cannot create a native sandbox. */
export function toolPolicyDisposition(
  run: AgentRun,
  operation: 'read' | 'edit' | 'execute' | 'other',
): 'allow' | 'ask' | 'deny' {
  const policy = effectivePermissionPolicy(run.agent, { textOnly: run.tools === 'none' })
  if (policy.textOnly) return 'deny'
  if (policy.readOnly) return operation === 'read' ? 'allow' : 'deny'
  if (operation === 'read') return 'allow'
  if (policy.approvalPolicy === 'never') return 'allow'
  if (policy.autoAcceptEdits && operation === 'edit') return 'allow'
  return 'ask'
}
