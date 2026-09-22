import { describe, expect, it } from 'vitest'
import { automationIssues } from './automations.js'
import type { Automation, AutomationData, Workspace } from './workspace.js'

const workspace: Pick<Workspace, 'agents' | 'repositories'> = {
  agents: [
    {
      id: 'agent',
      name: 'Builder',
      provider: 'codex',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
    },
  ],
  repositories: [{ id: 'repo', name: 'App', path: '/app', branch: 'main' }],
}
function flow(): Automation {
  const data: AutomationData = {
    kind: 'trigger',
    label: 'Daily',
    trigger: 'schedule',
    schedule: '0 9 * * 1-5',
    timezone: 'Europe/Amsterdam',
    objective: 'Review changes',
    agentId: 'agent',
    repositoryId: 'repo',
  }
  return {
    id: 'flow',
    name: 'Daily review',
    nodes: [
      { id: 'trigger', type: 'automation', position: { x: 0, y: 0 }, data },
      {
        id: 'task',
        type: 'automation',
        position: { x: 320, y: 0 },
        data: { ...data, kind: 'task', label: 'Review' },
      },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'task' }],
  }
}
describe('shared automation validation', () => {
  it('accepts configured schedules and rejects missing or invalid schedule fields', () => {
    expect(automationIssues(flow(), workspace)).toEqual([])
    for (const changes of [
      { schedule: '' },
      { timezone: '' },
      { schedule: 'invalid' },
      { timezone: 'Mars/Base' },
    ]) {
      const automation = flow()
      Object.assign(automation.nodes[0].data, changes)
      expect(automationIssues(automation, workspace)).toContain(
        'Enter a valid cron expression and time zone.',
      )
    }
  })
  it('reports missing project, agent and task instructions together for mobile editors', () => {
    const automation = flow()
    automation.nodes[1].data.objective = ' '
    expect(automationIssues(automation, { agents: [], repositories: [] })).toEqual([
      'Add instructions to Review.',
      'Choose an agent for Review.',
      'Choose a repository for Review.',
    ])
  })
  it('rejects whitespace names, disconnected work and duplicate connections', () => {
    const automation = flow()
    automation.name = ' '
    automation.edges = []
    expect(automationIssues(automation, workspace)).toEqual([
      'Give the automation a name.',
      'Connect every node to the trigger.',
    ])
    automation.edges = [flow().edges[0], { ...flow().edges[0], id: 'duplicate' }]
    expect(automationIssues(automation, workspace)).toContain('Remove duplicate connections.')
  })
})
