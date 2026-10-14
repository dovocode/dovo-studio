import { expect, it } from 'vite-plus/test'
import { workflowGraph } from './workflow-graph'
import { pipelineGraphColumns, type ForgePipelineJob } from '@dovo/protocol'
const job = (id: string, name: string): ForgePipelineJob => ({
  id,
  name,
  status: 'success',
  url: 'https://github.com/o/r/actions/runs/1',
})
it('maps static and matrix names, dependencies, and retains unknown live jobs', () => {
  const graph = workflowGraph(
    `jobs:
  check:
    name: Tests
  browser:
    needs: check
  publish:
    needs: [check, browser]
  dynamic:
    name: "Build \${{ matrix.os }}"
`,
    [job('1', 'Tests'), job('2', 'browser (0)'), job('3', 'browser (1)'), job('4', 'Build Linux')],
  )
  expect(graph[0].jobIds).toEqual(['1'])
  expect(graph[1].jobIds).toEqual(['2', '3'])
  expect(graph[2].needs).toEqual(['check', 'browser'])
  expect(graph.at(-1)).toMatchObject({ id: 'live:4', jobIds: ['4'], needs: [] })
  expect(pipelineGraphColumns(graph, []).map((column) => column.map((node) => node.id))).toEqual([
    ['check', 'dynamic', 'live:4'],
    ['browser'],
    ['publish'],
  ])
})
it('does not guess when two definitions have the same displayed name', () => {
  const graph = workflowGraph('jobs:\n  a: {name: Same}\n  b: {name: Same}', [job('1', 'Same')])
  expect(graph.map((node) => node.jobIds)).toEqual([[], [], ['1']])
  expect(
    pipelineGraphColumns(graph, [job('1', 'Same')])
      .flat()
      .map((node) => node.jobIds),
  ).toEqual([[], [], ['1']])
})
it('rejects malformed workflow definitions and aliases without executing expressions', () => {
  for (const text of [
    'jobs: [broken',
    'jobs: [one, two]',
    'jobs: {a: {needs: 12}}',
    'jobs: {a: &job {}, b: *job}',
  ])
    expect(() => workflowGraph(text, [])).toThrow(Error)
})
it('keeps graph status complete after fetching more job pages', () => {
  const graph = workflowGraph('jobs: {browser: {}}', [job('2', 'browser (1)')])
  expect(
    pipelineGraphColumns(graph, [job('1', 'browser (0)'), job('2', 'browser (1)')])[0][0].jobIds,
  ).toEqual(['2', '1'])
})
it('handles unavailable and cyclic dependencies without recursion failures', () => {
  expect(
    pipelineGraphColumns(
      [
        { id: 'a', name: 'A', needs: ['b'], jobIds: [] },
        { id: 'b', name: 'B', needs: ['a', 'missing'], jobIds: [] },
      ],
      [],
    ).flat(),
  ).toHaveLength(2)
})
it('retains unmatched jobs from later pages without guessing overlapping matrix names', () => {
  const graph = workflowGraph('jobs: {a: {name: Test}, b: {name: "Test (Linux)"}}', [
    job('1', 'Test (Linux)'),
  ])
  expect(graph.map((node) => node.jobIds)).toEqual([[], [], ['1']])
  const nodes = pipelineGraphColumns(graph, [
    job('1', 'Test (Linux)'),
    job('2', 'Dynamic Mac'),
  ]).flat()
  expect(nodes.find((node) => node.id === 'live:2')).toMatchObject({ jobIds: ['2'] })
  expect(
    nodes.filter((node) => node.id === 'a' || node.id === 'b').map((node) => node.jobIds),
  ).toEqual([[], []])
})
