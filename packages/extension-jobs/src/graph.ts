import { automationIssues } from '@dovo/studio-core'
import type { Automation, AutomationNode, Workspace } from '@dovo/studio-core'

export function validateGraph(flow: Automation, workspace: Workspace): string[] {
  return automationIssues(flow, workspace)
}

export function newNode(
  kind: AutomationNode['data']['kind'],
  workspace: Workspace,
  index: number,
): AutomationNode {
  return {
    id: crypto.randomUUID(),
    type: 'automation',
    position: { x: 80 + index * 320, y: 80 },
    data: {
      kind,
      label: kind === 'trigger' ? 'Trigger' : kind === 'task' ? 'Agent task' : 'Human review',
      trigger: 'manual',
      schedule: '0 9 * * 1-5',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      objective: '',
      agentId: workspace.agents[0]?.id ?? '',
      repositoryId: workspace.repositories[0]?.id ?? '',
    },
  }
}

export function canConnect(
  flow: Automation,
  source: string | null,
  target: string | null,
): boolean {
  if (!source || !target || source === target) return false
  if (
    !flow.nodes.some((n) => n.id === source) ||
    !flow.nodes.some((n) => n.id === target && n.data.kind !== 'trigger')
  )
    return false
  if (flow.edges.some((edge) => edge.source === source && edge.target === target)) return false
  const visited = new Set<string>()
  const pending = [target]
  while (pending.length) {
    const id = pending.pop()!
    if (id === source) return false
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...flow.edges.filter((edge) => edge.source === id).map((edge) => edge.target))
  }
  return true
}
