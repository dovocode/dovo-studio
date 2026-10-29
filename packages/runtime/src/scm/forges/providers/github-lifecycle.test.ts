import { expect, it, vi } from 'vite-plus/test'
import { actOnGithubPull } from './github-actions.js'
import type { GithubJSON, GithubLocation } from './github-api.js'
import type { githubLifecycle } from './github-lifecycle.js'

const headSha = 'a'.repeat(40)
const repo: GithubLocation = {
  nameWithOwner: 'team/project',
  url: 'https://github.com/team/project',
  host: 'github.com',
  repository: 'github.com/team/project',
  path: 'repos/team/project',
}
const state: Awaited<ReturnType<typeof githubLifecycle>> = {
  id: 'PR_7',
  headRefOid: headSha,
  state: 'OPEN',
  isDraft: false,
  mergeStateStatus: 'BLOCKED',
  isInMergeQueue: false,
  viewerCanUpdate: true,
  viewerCanEnableAutoMerge: true,
  viewerCanDisableAutoMerge: true,
  autoMergeRequest: null,
}
const scope = { number: 7, headSha }
function client(value = state) {
  return vi
    .fn<GithubJSON>()
    .mockResolvedValueOnce({ number: 7, html_url: `${repo.url}/pull/7`, head: { sha: headSha } })
    .mockResolvedValueOnce({ data: { repository: { pullRequest: value } } })
}

it.each([true, false])(
  'changes draft state to %s with a confirmed GitHub response',
  async (draft) => {
    const mutation = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
    const json = client({ ...state, isDraft: !draft }).mockResolvedValueOnce({
      data: { [mutation]: { pullRequest: { id: state.id, isDraft: draft } } },
    })
    await expect(
      actOnGithubPull(json, repo, { ...scope, action: 'draft', draft }),
    ).resolves.toMatchObject({ status: 'updated' })
    expect(json).toHaveBeenLastCalledWith(
      expect.arrayContaining(['id=PR_7', expect.stringContaining(mutation)]),
    )
  },
)

it('pins auto-merge to the reviewed head and chosen merge method', async () => {
  const json = client().mockResolvedValueOnce({
    data: {
      enablePullRequestAutoMerge: {
        pullRequest: { id: state.id, autoMergeRequest: { mergeMethod: 'SQUASH' } },
      },
    },
  })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'auto-merge',
      enabled: true,
      method: 'squash',
    }),
  ).resolves.toMatchObject({ status: 'updated' })
  expect(json).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      `head=${headSha}`,
      'method=SQUASH',
      expect.stringContaining('expectedHeadOid:$head'),
    ]),
  )
})

it('disables auto-merge without changing its merge method', async () => {
  const json = client({
    ...state,
    autoMergeRequest: { mergeMethod: 'SQUASH' },
  }).mockResolvedValueOnce({
    data: {
      disablePullRequestAutoMerge: {
        pullRequest: { id: state.id, autoMergeRequest: null },
      },
    },
  })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'auto-merge',
      enabled: false,
      method: 'merge',
    }),
  ).resolves.toMatchObject({ status: 'updated' })
  expect(json.mock.calls[2]?.[0].join(' ')).not.toContain('method=')
})

it('does not confirm a different auto-merge method enabled while confirmation was open', async () => {
  const json = client({ ...state, autoMergeRequest: { mergeMethod: 'MERGE' } })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'auto-merge',
      enabled: true,
      method: 'squash',
    }),
  ).rejects.toThrow('different merge method')
  expect(json).toHaveBeenCalledTimes(2)
})

it.each([
  { autoMergeRequest: { mergeMethod: 'SQUASH' }, enabled: true, method: 'squash' as const },
  { autoMergeRequest: null, enabled: false, method: 'merge' as const },
])(
  'accepts an already confirmed auto-merge state without another mutation: %j',
  async ({ autoMergeRequest, enabled, method }) => {
    const json = client({ ...state, autoMergeRequest })
    await expect(
      actOnGithubPull(json, repo, { ...scope, action: 'auto-merge', enabled, method }),
    ).resolves.toMatchObject({ status: 'updated' })
    expect(json).toHaveBeenCalledTimes(2)
  },
)

it.each([
  { headRefOid: 'b'.repeat(40) },
  { state: 'CLOSED' as const },
  { isInMergeQueue: true },
  { viewerCanUpdate: false },
])('rejects stale, closed, queued or unauthorized draft changes: %j', async (change) => {
  const json = client({ ...state, ...change })
  await expect(
    actOnGithubPull(json, repo, { ...scope, action: 'draft', draft: true }),
  ).rejects.toThrow(/PR|pull request|GitHub account/)
  expect(json).toHaveBeenCalledTimes(2)
})

it.each([{ isDraft: true }, { viewerCanEnableAutoMerge: false }])(
  'rejects unavailable auto-merge: %j',
  async (change) => {
    const json = client({ ...state, ...change })
    await expect(
      actOnGithubPull(json, repo, {
        ...scope,
        action: 'auto-merge',
        enabled: true,
        method: 'merge',
      }),
    ).rejects.toThrow(/auto-merge|ready for review/)
    expect(json).toHaveBeenCalledTimes(2)
  },
)

it('does not report success when GitHub has not confirmed the mutation', async () => {
  const json = client().mockResolvedValueOnce({
    data: {
      convertPullRequestToDraft: {
        pullRequest: { id: state.id, isDraft: false },
      },
    },
  })
  await expect(
    actOnGithubPull(json, repo, { ...scope, action: 'draft', draft: true }),
  ).rejects.toThrow('did not confirm')
})
