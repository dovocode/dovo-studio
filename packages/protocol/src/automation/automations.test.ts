import { describe, expect, it } from 'vitest'
import { defaultTaskHarness, automationSchema } from '../workspace.js'
import { defaultGithubTrigger } from './triggers.js'
import { decode } from '../shared/schema.js'
import { automationIssues } from './automations.js'
import type { Automation, AutomationData, Workspace } from '../workspace.js'

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

it('validates direct harnesses without predefined agents and checks provider permissions', () => {
  const automation = flow()
  const data = automation.nodes[1].data
  data.agentId = ''
  data.harness = {
    ...defaultTaskHarness('codex'),
    model: 'gpt-5',
    reasoning: 'high',
    permission: 'ask',
  }
  expect(automationIssues(automation, { ...workspace, agents: [] })).toEqual([])
  data.harness = { ...defaultTaskHarness('acp') }
  expect(automationIssues(automation, workspace)).toContain(
    'Choose an installed ACP agent or executable for Review.',
  )
  data.harness = { ...data.harness, acpInstallationId: 'installed-agent' }
  expect(automationIssues(automation, workspace)).toEqual([])
})

it('validates GitHub configuration and preserves it through workspace decoding', () => {
  const automation = flow()
  const trigger = automation.nodes[0].data
  trigger.trigger = 'github'
  expect(automationIssues(automation, workspace)).toContain(
    'Enter a GitHub repository as owner/repository.',
  )
  trigger.github = { ...defaultGithubTrigger, repository: 'team/project' }
  expect(automationIssues(automation, workspace)).toEqual([])
  expect(decode(automationSchema, automation).nodes[0].data.github).toEqual(trigger.github)
  trigger.github.host = 'https://github.com/path'
  expect(automationIssues(automation, workspace)).toContain(
    'Enter a GitHub hostname, such as github.com.',
  )
  trigger.github.host = 'github.com'
  trigger.github.event = 'pull_request.synchronized'
  trigger.github.requireWriteAccess = true
  expect(automationIssues(automation, workspace)).toContain(
    'PR synchronization polling cannot filter by pusher or write access.',
  )
})
