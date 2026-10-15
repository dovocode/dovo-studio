import { expect, it } from 'vite-plus/test'
import {
  combinePipelineSections,
  matchingPipelineSection,
  pipelineRevision,
  type ForgePipelineDetail,
} from './forge-work'

const overview: ForgePipelineDetail = {
  destination: 'account-repository',
  run: {
    id: '42',
    title: 'Build',
    url: 'https://github.com/team/project/actions/runs/42',
    status: 'in_progress',
    sha: 'a'.repeat(40),
    ref: 'main',
    attempt: 2,
    createdAt: '',
    updatedAt: '2026-10-15T10:00:00Z',
    actor: 'dominic',
  },
  jobs: [],
}
const job = { id: '1', name: 'Build', status: 'success', url: overview.run.url }
it('keeps the overview usable while independent pipeline sections load or fail', () => {
  expect(combinePipelineSections(overview, undefined, undefined)).toEqual(overview)
  const jobs = {
    ...overview,
    run: { ...overview.run, status: 'failure' },
    jobs: [job],
    next: '2',
    stale: true,
    refreshError: 'Jobs unavailable',
  }
  const graph = { ...overview, graph: [{ id: 'build', name: 'Build', needs: [], jobIds: ['1'] }] }
  const result = combinePipelineSections(overview, jobs, graph)
  expect(result).toMatchObject({
    run: { status: 'in_progress' },
    jobs: [job],
    next: '2',
    graph: graph.graph,
  })
  expect(result?.stale).toBeUndefined()
  expect(result?.refreshError).toBeUndefined()
})
it.each([
  { ...overview, destination: 'other-account' },
  { ...overview, run: { ...overview.run, attempt: 3 } },
  { ...overview, run: { ...overview.run, sha: 'b'.repeat(40) } },
  { ...overview, run: { ...overview.run, id: '43' } },
  {
    ...overview,
    run: { ...overview.run, url: 'https://github.com/other/project/actions/runs/42' },
  },
])('never mixes jobs or dependencies from another account, run or attempt', (section) => {
  const value = {
    ...section,
    jobs: [job],
    next: '2',
    graph: [{ id: 'old', name: 'Old', needs: [], jobIds: ['1'] }],
  }
  expect(matchingPipelineSection(overview, value)).toBe(false)
  expect(combinePipelineSections(overview, value, value)).toEqual(overview)
})
it('pins GitHub attempts while using update time for providers without attempts', () => {
  expect(pipelineRevision(overview.run)).toBe(
    pipelineRevision({ ...overview.run, updatedAt: 'later' }),
  )
  expect(pipelineRevision({ ...overview.run, attempt: undefined })).not.toBe(
    pipelineRevision({ ...overview.run, attempt: undefined, updatedAt: 'later' }),
  )
})
