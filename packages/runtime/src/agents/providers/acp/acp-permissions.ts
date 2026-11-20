import { effectivePermissionPolicy, type Agent, type PermissionPolicy } from '@dovo/protocol'
import type { AcpLaunch, AgentRun } from '../../execution/types.js'
import { toolPolicyDisposition } from '../shared/permission-policy.js'

export function acpPermissionProvider(launch: AcpLaunch, agent: Pick<Agent, 'acpInstallationId'>) {
  if (launch.authentication === 'grok') return 'grok'
  if (
    agent.acpInstallationId === 'antigravity-acp' ||
    (/^agy(?:\.exe|\.cmd)?$/i.test(launch.command.split(/[\\/]/).at(-1) ?? '') &&
      launch.args.includes('acp'))
  )
    return 'antigravity'
  if (
    launch.args.includes('--agent-engine=v3') &&
    (agent.acpInstallationId === 'kiro' ||
      /^kiro-cli(?:\.exe|\.cmd)?$/i.test(launch.command.split(/[\\/]/).at(-1) ?? ''))
  )
    return 'kiro'
}

export type AcpPermissionProvider = ReturnType<typeof acpPermissionProvider>

export function acpPermissionDisposition(
  run: AgentRun,
  operation: Parameters<typeof toolPolicyDisposition>[1],
  provider: AcpPermissionProvider,
) {
  const disposition = toolPolicyDisposition(run, operation)
  if (
    disposition !== 'deny' &&
    (provider === 'antigravity' || provider === 'grok') &&
    effectivePermissionPolicy(run.agent).automaticReview
  )
    return 'ask'
  return disposition
}

export function acpReadOnlyMode(choices: readonly string[]) {
  return choices.find((id) => /^(plan|read[-_ ]?only)$/i.test(id.slice(id.lastIndexOf('#') + 1)))
}

export function antigravityPermissionMode(
  choices: readonly string[],
  requested: string | undefined,
  agent: PermissionPolicy,
  restrictive: boolean,
) {
  if (restrictive) return acpReadOnlyMode(choices)
  const policy = effectivePermissionPolicy(agent)
  const unrestricted = agent.permission === 'full-access' && policy.approvalPolicy === 'never'
  const canUseAuto = policy.automaticReview || unrestricted
  // agy can reject yolo and auto_edit even when they are listed. Use its approval
  // requests in default, and use native Auto only when the session offers it.
  if (requested && choices.includes(requested)) {
    if (requested === 'default' || acpReadOnlyMode([requested])) return requested
    if (requested === 'auto' && canUseAuto) return requested
    if (unrestricted && !['auto', 'yolo', 'auto_edit'].includes(requested)) return requested
  }
  if (policy.automaticReview && choices.includes('auto')) return 'auto'
  return choices.includes('default') ? 'default' : undefined
}

export function acpPermissionModeOption(option: { category?: string | null }, id: string) {
  return (
    option.category === 'mode' ||
    option.category === 'collaboration_mode' ||
    (!option.category && id === 'mode')
  )
}

export function kiroAutopilot(agent: Partial<PermissionPolicy>) {
  return agent.permission === 'full-access' && !agent.approvalPolicy && !agent.sandboxMode
    ? 'on'
    : 'off'
}
