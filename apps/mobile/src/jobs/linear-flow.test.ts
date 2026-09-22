import { describe, expect, it } from 'vite-plus/test'
import type { Automation } from '@dovo/protocol'
import { linearNodes, newAutomationNode, withLinearNodes } from './linear-flow'

const defaults = { repositoryId: 'project', agentId: 'agent', timezone: 'Europe/Amsterdam' }
function fixture(): Automation {
  return withLinearNodes({ id: 'flow', name: 'Review', enabled: false, nodes: [], edges: [] }, [
    newAutomationNode('trigger', 'trigger', defaults),
    {
      ...newAutomationNode('task', 'task', defaults),
      data: {
        ...newAutomationNode('task', 'task', defaults).data,
        objective: 'Review the repository',
      },
    },
    newAutomationNode('review', 'review', defaults),
  ])
}
describe('mobile automation editing', () => {
  it('follows connections rather than canvas array order', () => {
    const flow = fixture()
    flow.nodes.reverse()
    expect(linearNodes(flow)?.map((node) => node.id)).toEqual(['trigger', 'task', 'review'])
  })
  it('refuses branches, disconnected nodes and cycles instead of flattening them', () => {
    const flow = fixture()
    expect(
      linearNodes({
        ...flow,
        edges: [
          { id: '1', source: 'trigger', target: 'task' },
          { id: '2', source: 'trigger', target: 'review' },
        ],
      }),
    ).toBeNull()
    expect(linearNodes({ ...flow, edges: flow.edges.slice(1) })).toBeNull()
    expect(
      linearNodes({
        ...flow,
        edges: [
          { id: '1', source: 'trigger', target: 'task' },
          { id: '2', source: 'task', target: 'trigger' },
        ],
      }),
    ).toBeNull()
  })
  it('reorders steps without losing objectives, identity or trigger enablement', () => {
    const flow = fixture()
    const result = withLinearNodes(flow, [flow.nodes[0], flow.nodes[2], flow.nodes[1]])
    expect(result.enabled).toBe(false)
    expect(result.nodes.at(-1)?.data.objective).toBe('Review the repository')
    expect(linearNodes(result)?.map((node) => node.id)).toEqual(['trigger', 'review', 'task'])
    expect(result.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['trigger', 'review'],
      ['review', 'task'],
    ])
  })
})
