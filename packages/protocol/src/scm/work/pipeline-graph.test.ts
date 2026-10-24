import { expect, it } from 'vite-plus/test'
import { pipelineFailureImpact } from './pipeline-graph.js'
import type { ForgePipelineGraphNode, ForgePipelineJob } from '../forges/forge-work.js'

const job = (id: string, status: string): ForgePipelineJob => ({
  id,
  name: id,
  status,
  url: 'https://github.com/team/repo/actions/runs/1',
})
it('traces failed dependencies transitively without marking independent jobs', () => {
  const graph: ForgePipelineGraphNode[] = [
    { id: 'publish', name: 'publish', needs: ['build'], jobIds: ['publish'] },
    { id: 'build', name: 'build', needs: ['test'], jobIds: ['build'] },
    { id: 'test', name: 'test', needs: [], jobIds: ['test'] },
    { id: 'lint', name: 'lint', needs: [], jobIds: ['lint'] },
  ]
  const result = pipelineFailureImpact(graph, [
    job('test', 'timed_out'),
    job('build', 'skipped'),
    job('publish', 'skipped'),
    job('lint', 'success'),
  ])
  expect([...result.failed]).toEqual(['test'])
  expect([...result.affected].sort()).toEqual(['build', 'publish', 'test'])
})
it('handles missing graphs, errors, cycles and recovery', () => {
  expect([
    ...pipelineFailureImpact(undefined, [{ ...job('test', 'success'), errors: ['Runner error'] }])
      .failed,
  ]).toEqual(['test'])
  const graph = [
    { id: 'a', name: 'a', needs: ['b'], jobIds: ['a'] },
    { id: 'b', name: 'b', needs: ['a'], jobIds: ['b'] },
  ]
  expect(pipelineFailureImpact(graph, [job('a', 'failure')]).affected.size).toBe(2)
  expect(pipelineFailureImpact(graph, [job('a', 'success')]).affected.size).toBe(0)
})
