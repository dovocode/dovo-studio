import { describe, expect, it } from 'vite-plus/test'
import { forgePipelineSchema } from '@dovo/protocol'
import { matchesPipelineCommit } from './work-list'

const sha = 'aa11bb22cc33dd44ee55ff6677889900aabbccdd'
const run = forgePipelineSchema.parse({
  id: '42',
  title: `Build ${sha}`,
  url: 'https://github.com/team/repo/actions/runs/42',
  ref: 'fix/test',
  sha,
  actor: 'developer',
  status: 'failed',
  createdAt: '',
  updatedAt: '',
})

describe('PR pipeline scope', () => {
  it('only includes runs for the full head commit, including case differences', () => {
    expect(matchesPipelineCommit(run, sha)).toBe(true)
    expect(matchesPipelineCommit(run, sha.toUpperCase())).toBe(true)
    expect(matchesPipelineCommit(run, sha.slice(0, 8))).toBe(false)
    expect(matchesPipelineCommit({ ...run, sha: 'another-commit' }, sha)).toBe(false)
  })

  it('does not fall back to showing every pipeline when a commit is missing', () => {
    expect(matchesPipelineCommit(run, undefined)).toBe(false)
    expect(matchesPipelineCommit(run, '')).toBe(false)
    expect(matchesPipelineCommit({ ...run, sha: '' }, '')).toBe(false)
  })
})
