import { expect, it } from 'vite-plus/test'
import { restorableAutomation } from './restore.js'
import { defaultTaskHarness, type Automation } from '../workspace.js'

const flow = (secret: string): Automation => ({
  id: 'flow',
  name: secret,
  enabled: true,
  edges: [],
  nodes: [
    {
      id: 'task',
      type: 'automation',
      position: { x: 0, y: 0 },
      data: {
        kind: 'task',
        label: 'Task',
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: 'Report',
        repositoryId: '',
        agentId: '',
        harness: {
          ...defaultTaskHarness('codex'),
          endpoint: secret,
          env: { TOKEN: secret },
          envSecrets: { TOKEN: { provider: 'environment', reference: 'TOKEN' } },
          args: [secret],
          executablePath: secret,
          configDirectory: secret,
        },
      },
    },
  ],
})
it('restores graph and instructions, keeps current credentials and pauses triggers', () => {
  const old = flow('old-secret'),
    current = flow('current-secret')
  const result = restorableAutomation(old, current)
  expect(result.name).toBe('old-secret')
  expect(result.enabled).toBe(false)
  expect(result.nodes[0].data.harness).toEqual(current.nodes[0].data.harness)
  expect(current.enabled).toBe(true)
  const missing = restorableAutomation(old, { ...current, nodes: [] })
  expect(missing.nodes[0].data.harness?.endpoint).toBe('')
  expect(missing.nodes[0].data.harness?.env).toBeUndefined()
})

it('keeps a changed provider and its model with the current connection credentials', () => {
  const historical = flow('old'),
    current = flow('current')
  current.nodes[0].data.harness = {
    ...defaultTaskHarness('claude'),
    model: 'current-model',
    env: { TOKEN: 'current-token' },
  }
  expect(restorableAutomation(historical, current).nodes[0].data.harness).toMatchObject({
    provider: 'claude',
    model: 'current-model',
    env: { TOKEN: 'current-token' },
  })
})
