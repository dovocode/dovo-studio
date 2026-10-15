import { expect, it } from 'vite-plus/test'
import { githubPipelineTarget } from './pipeline-links'

it('recognizes run and job permalinks while retaining URL context', () => {
  for (const suffix of ['', '/job/456#step:2:1', '?check_suite_focus=true'])
    expect(githubPipelineTarget(`https://github.com/team/repo/actions/runs/123${suffix}`)).toEqual({
      id: '123',
      identity: 'github.com/team/repo',
      url: `https://github.com/team/repo/actions/runs/123${suffix}`,
    })
  for (const url of [
    'javascript:alert(1)',
    'https://github.com.evil/team/repo/actions/runs/123',
    'https://user@github.com/team/repo/actions/runs/123',
    'https://github.com/team/repo/actions/runs/0',
  ])
    expect(githubPipelineTarget(url)).toBeNull()
})
