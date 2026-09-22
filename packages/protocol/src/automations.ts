import { CronExpressionParser } from 'cron-parser'
import type { Automation, Workspace } from './workspace.js'

export function automationIssues(
  flow: Automation,
  workspace: Pick<Workspace, 'agents' | 'repositories'>,
): string[] {
  const errors: string[] = []
  if (!flow.name.trim()) errors.push('Give the automation a name.')
  const ids = new Set(flow.nodes.map((node) => node.id))
  if (ids.size !== flow.nodes.length) errors.push('Use unique node ids.')
  const triggers = flow.nodes.filter((node) => node.data.kind === 'trigger')
  if (triggers.length !== 1) errors.push('Use exactly one trigger.')
  if (!flow.nodes.some((node) => node.data.kind === 'task')) errors.push('Add at least one task.')
  const links = new Set<string>()
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      errors.push('Remove connections to missing nodes.')
    const key = JSON.stringify([edge.source, edge.target])
    if (links.has(key)) errors.push('Remove duplicate connections.')
    links.add(key)
    if (triggers.some((node) => node.id === edge.target))
      errors.push('A trigger cannot have an incoming connection.')
  }
  const visited = new Set<string>(),
    visiting = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) {
      errors.push('Remove circular connections.')
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const edge of flow.edges.filter((edge) => edge.source === id)) visit(edge.target)
    visiting.delete(id)
    visited.add(id)
  }
  for (const trigger of triggers) visit(trigger.id)
  if (flow.nodes.some((node) => !visited.has(node.id)))
    errors.push('Connect every node to the trigger.')
  for (const node of flow.nodes) {
    const data = node.data
    if (!data.label.trim()) errors.push('Give every node a name.')
    if (data.kind === 'trigger' && data.trigger === 'schedule') {
      try {
        if (!data.schedule.trim() || !data.timezone.trim()) throw new Error('Missing schedule')
        new Intl.DateTimeFormat('en', { timeZone: data.timezone })
        CronExpressionParser.parse(data.schedule, { tz: data.timezone }).next()
      } catch {
        errors.push('Enter a valid cron expression and time zone.')
      }
    }
    if (data.kind === 'task') {
      if (!data.objective.trim()) errors.push(`Add instructions to ${data.label}.`)
      if (!workspace.agents.some((agent) => agent.id === data.agentId))
        errors.push(`Choose an agent for ${data.label}.`)
      if (!workspace.repositories.some((repo) => repo.id === data.repositoryId))
        errors.push(`Choose a repository for ${data.label}.`)
    }
  }
  return [...new Set(errors)]
}
