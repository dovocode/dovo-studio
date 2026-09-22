import type { Automation, AutomationData, AutomationNode } from '@dovo/protocol'

/** Mobile edits a single ordered path; never flatten a canvas with branches or missing nodes. */
export function linearNodes(flow: Automation): AutomationNode[] | null {
  const trigger = flow.nodes.filter((node) => node.data.kind === 'trigger')
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]))
  if (
    trigger.length !== 1 ||
    nodes.size !== flow.nodes.length ||
    flow.edges.length !== nodes.size - 1
  )
    return null
  const ordered: AutomationNode[] = []
  let current: AutomationNode | undefined = trigger[0]
  while (current && !ordered.some((node) => node.id === current?.id)) {
    const id: string = current.id
    if (flow.edges.filter((edge) => edge.target === id).length !== (ordered.length ? 1 : 0))
      return null
    ordered.push(current)
    const next = flow.edges.filter((edge) => edge.source === id)
    if (next.length > 1) return null
    current = next[0] ? nodes.get(next[0].target) : undefined
  }
  return !current && ordered.length === nodes.size ? ordered : null
}

export function withLinearNodes(flow: Automation, nodes: AutomationNode[]): Automation {
  return {
    ...flow,
    nodes: nodes.map((node, index) => ({ ...node, position: { x: 60 + index * 340, y: 170 } })),
    edges: nodes.slice(1).map((node, index) => {
      const source = nodes[index].id
      return (
        flow.edges.find((edge) => edge.source === source && edge.target === node.id) ?? {
          id: `${source}:${node.id}`,
          source,
          target: node.id,
        }
      )
    }),
  }
}

export function newAutomationNode(
  id: string,
  kind: AutomationData['kind'],
  defaults: { repositoryId: string; agentId: string; timezone: string },
): AutomationNode {
  return {
    id,
    type: 'automation',
    position: { x: 60, y: 170 },
    data: {
      kind,
      label:
        kind === 'trigger'
          ? 'Start'
          : kind === 'review'
            ? 'Review before continuing'
            : 'Agent task',
      trigger: 'manual',
      schedule: '0 9 * * 1-5',
      timezone: defaults.timezone,
      objective: '',
      repositoryId: defaults.repositoryId,
      agentId: defaults.agentId,
      execution: 'worktree',
    },
  }
}

export const scheduleChoices = [
  { id: '0 9 * * 1-5', name: 'Weekdays at 09:00' },
  { id: '0 9 * * *', name: 'Every day at 09:00' },
  { id: '0 * * * *', name: 'Every hour' },
  { id: 'custom', name: 'Custom schedule' },
]

export function triggerSummary(flow: Automation) {
  const trigger = flow.nodes.find((node) => node.data.kind === 'trigger')?.data
  if (trigger?.trigger === 'schedule')
    return `${scheduleChoices.find((choice) => choice.id === trigger.schedule)?.name ?? trigger.schedule} · ${trigger.timezone}`
  return trigger?.trigger === 'webhook' ? 'Webhook' : 'Manual'
}
