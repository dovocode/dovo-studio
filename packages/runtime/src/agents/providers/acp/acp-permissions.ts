import { effectivePermissionPolicy, type Agent, type PermissionPolicy } from '@dovo/protocol'
import type { AcpLaunch, AgentRun } from '../../execution/types.js'
import { toolPolicyDisposition } from '../shared/permission-policy.js'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, sep } from 'node:path'

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

export async function acpPermissionDisposition(
  run: AgentRun,
  operation: Parameters<typeof toolPolicyDisposition>[1],
  provider: AcpPermissionProvider,
  tool?: { locations?: unknown; content?: unknown; rawInput?: unknown },
) {
  const disposition = toolPolicyDisposition(run, operation)
  const policy = effectivePermissionPolicy(run.agent)
  if (
    disposition !== 'deny' &&
    (provider === 'antigravity' || provider === 'grok') &&
    policy.automaticReview
  )
    return 'ask'
  if (
    disposition === 'allow' &&
    operation === 'edit' &&
    policy.autoAcceptEdits &&
    !run.sandbox &&
    !(await editInThreadFolders(run, tool))
  )
    return 'ask'
  return disposition
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
}

async function existingAncestor(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const entry = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'ENOENT') throw cause
    })
    if (entry || dirname(path) === path) throw error
    return existingAncestor(dirname(path))
  }
}

async function editInThreadFolders(
  run: AgentRun,
  tool: Parameters<typeof acpPermissionDisposition>[3],
) {
  const paths: unknown[] = []
  if (Array.isArray(tool?.locations)) {
    for (const location of tool.locations) paths.push(record(location)?.path)
  }
  if (Array.isArray(tool?.content)) {
    for (const item of tool.content) {
      const diff = record(item)
      if (diff?.type !== 'diff') continue
      if (Array.isArray(diff.changes)) {
        for (const change of diff.changes) paths.push(record(change)?.path)
      } else paths.push(diff.path)
    }
  }
  const input = record(tool?.rawInput)
  for (const key of ['path', 'filePath', 'file_path']) {
    if (input && key in input) paths.push(input[key])
  }
  if (!paths.length) return false
  const roots = await Promise.all(
    [
      run.cwd,
      ...(run.linkedDirectories ?? [])
        .filter((link) => link.access === 'edit')
        .map((link) => link.path),
    ].map((root) => realpath(root).catch(() => undefined)),
  )
  for (const path of new Set(paths)) {
    if (
      typeof path !== 'string' ||
      !path.trim() ||
      path.includes('\0') ||
      path.split(/[\\/]/).includes('..') ||
      (!isAbsolute(path) && /^[a-z]:/i.test(path))
    )
      return false
    const absolute = isAbsolute(path) ? path : run.cwd + sep + path
    const resolved = await existingAncestor(absolute).catch(() => undefined)
    if (
      !resolved ||
      !roots.some((root) => {
        if (!root) return false
        const rel = relative(root, resolved)
        return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
      })
    )
      return false
  }
  return true
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
