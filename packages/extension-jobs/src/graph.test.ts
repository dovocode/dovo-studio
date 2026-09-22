import { describe, expect, it } from 'vitest'
import { createWorkspace } from '../../studio-core/src/workspace/seed'
import { canConnect, validateGraph } from './graph'
describe('automation validation', () => {
  it('accepts a connected configured workflow', () => {
    const workspace = createWorkspace()
    expect(validateGraph(workspace.automations[0], workspace)).toEqual([])
  })
  it('rejects circular, disconnected and dangling edges', () => {
    const workspace = createWorkspace(),
      flow = workspace.automations[0]
    expect(
      validateGraph(
        { ...flow, edges: [...flow.edges, { id: 'cycle', source: 'review', target: 'task' }] },
        workspace,
      ),
    ).toContain('Remove circular connections.')
    expect(validateGraph({ ...flow, edges: [] }, workspace)).toContain(
      'Connect every node to the trigger.',
    )
    expect(
      validateGraph(
        {
          ...flow,
          edges: [...flow.edges, { id: 'missing', source: 'trigger', target: 'missing' }],
        },
        workspace,
      ),
    ).toContain('Remove connections to missing nodes.')
  })
  it('rejects missing configuration and invalid schedule', () => {
    const workspace = createWorkspace(),
      flow = workspace.automations[0]
    const invalid = {
      ...flow,
      nodes: flow.nodes.map((node) => ({
        ...node,
        data: { ...node.data, schedule: 'invalid', agentId: 'missing', objective: '' },
      })),
    }
    const errors = validateGraph(invalid, workspace)
    expect(errors).toContain('Enter a valid cron expression and time zone.')
    expect(errors.some((error) => error.startsWith('Choose an agent'))).toBe(true)
    expect(errors.some((error) => error.startsWith('Add instructions'))).toBe(true)
  })
})

it('rejects invalid connections before editing the graph', () => {
  const flow = createWorkspace().automations[0]
  expect(canConnect(flow, 'trigger', 'task')).toBe(false)
  expect(canConnect(flow, 'review', 'task')).toBe(false)
  expect(canConnect(flow, 'task', 'trigger')).toBe(false)
  expect(canConnect(flow, 'task', 'task')).toBe(false)
  expect(canConnect(flow, 'missing', 'task')).toBe(false)
  expect(canConnect({ ...flow, edges: [] }, 'trigger', 'task')).toBe(true)
})
