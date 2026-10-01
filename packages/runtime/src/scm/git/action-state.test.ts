import { describe, expect, it } from 'vite-plus/test'
import { gitActionState } from './action-state.js'

describe('Git action state', () => {
  it('distinguishes changed files from branch headers and tracks unpublished commits', () => {
    expect(
      gitActionState(
        '# branch.head feature\n# branch.upstream origin/feature\n# branch.ab +2 -0\n? image.png\n',
        'origin\n',
      ),
    ).toEqual({
      dirty: true,
      branch: 'feature',
      ahead: 2,
      behind: 0,
      tracking: true,
      canPush: true,
    })
  })
  it('recognizes clean branches behind their upstream', () => {
    expect(
      gitActionState(
        '# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -3\n',
        'origin',
      ),
    ).toMatchObject({ dirty: false, ahead: 0, behind: 3 })
  })
  it('does not offer pushing detached or ambiguous untracked branches', () => {
    expect(gitActionState('# branch.head (detached)\n', 'origin').canPush).toBe(false)
    expect(gitActionState('# branch.head feature\n', 'first\nsecond').canPush).toBe(false)
  })
  it('offers publishing to the sole remote', () => {
    expect(gitActionState('# branch.head feature\n', 'upstream')).toMatchObject({
      tracking: false,
      canPush: true,
    })
  })
})
