/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vitest'
import { PullRequests } from './pulls.js'
import { GitService } from './git.js'
import { actOnGithubPull, createGithubPull } from './github-actions.js'
import type { GithubJSON, GithubLocation } from './github-api.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { commandsSchema } from '@dovo/protocol'

const sha = 'a'.repeat(40)
const repo: GithubLocation = {
  nameWithOwner: 'team/project',
  url: 'https://github.example.com/team/project',
  host: 'github.example.com',
  repository: 'github.example.com/team/project',
  path: 'repos/team/project',
}
const current = { number: 7, html_url: `${repo.url}/pull/7`, head: { sha } }
const scope = { number: 7, headSha: sha }
afterEach(() => vi.restoreAllMocks())

it('creates a draft with explicit branches and exact multiline body, without pushing or forking', async () => {
  const json = vi.fn<GithubJSON>().mockResolvedValue(current)
  expect(
    await createGithubPull(json, repo, {
      title: 'Runtime fix',
      body: 'Keep `taskId`.\n\nSecond paragraph.',
      head: 'contributor:fix',
      base: 'main',
      draft: true,
    }),
  ).toEqual({ number: 7, url: current.html_url, status: 'created' })
  expect(json).toHaveBeenCalledExactlyOnceWith([
    'api',
    '--hostname',
    repo.host,
    `${repo.path}/pulls`,
    '--method',
    'POST',
    '-f',
    'title=Runtime fix',
    '-f',
    'body=Keep `taskId`.\n\nSecond paragraph.',
    '-f',
    'head=contributor:fix',
    '-f',
    'base=main',
    '-F',
    'draft=true',
  ])
})

it('pins review decisions to the displayed commit, allows empty approvals and requires text for other reviews', async () => {
  const json = vi
    .fn<GithubJSON>()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ html_url: current.html_url + '#review-2' })
  await expect(
    actOnGithubPull(json, repo, { ...scope, action: 'review', body: '', event: 'approve' }),
  ).resolves.toMatchObject({ status: 'submitted' })
  expect(json).toHaveBeenLastCalledWith(
    expect.arrayContaining(['POST', 'event=APPROVE', `commit_id=${sha}`, 'body=']),
  )
  json.mockClear()
  for (const event of ['comment', 'request-changes'] as const)
    await expect(
      actOnGithubPull(json, repo, { ...scope, action: 'review', body: '', event }),
    ).rejects.toThrow('Write a review')
  expect(json).not.toHaveBeenCalled()
})

it('rejects every mutation before writing when the displayed head is stale', async () => {
  const json = vi.fn<GithubJSON>().mockResolvedValue({ ...current, head: { sha: 'b'.repeat(40) } })
  await expect(
    actOnGithubPull(json, repo, { ...scope, action: 'comment', body: 'Please retry.' }),
  ).rejects.toThrow('This PR changed')
  expect(json).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(['GET']))
})

it('routes a reply through its root review comment and rejects comments from another PR', async () => {
  const json = vi
    .fn<GithubJSON>()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({
      id: 8,
      in_reply_to_id: 4,
      pull_request_url: `https://github.example.com/api/v3/${repo.path}/pulls/7`,
    })
    .mockResolvedValueOnce({ html_url: current.html_url + '#reply' })
  await actOnGithubPull(json, repo, {
    ...scope,
    action: 'reply',
    commentId: 'inline-8',
    body: 'Updated.',
  })
  expect(json).toHaveBeenLastCalledWith(
    expect.arrayContaining([`${repo.path}/pulls/7/comments/4/replies`, 'POST', 'body=Updated.']),
  )
  json
    .mockReset()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({
      id: 8,
      pull_request_url: `https://github.example.com/api/v3/${repo.path}/pulls/99`,
    })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'reply',
      commentId: 'inline-8',
      body: 'Wrong PR',
    }),
  ).rejects.toThrow('another pull request')
  expect(json).toHaveBeenCalledTimes(2)
})

it('checks thread ownership and permissions before resolving, and treats its existing state as success', async () => {
  const thread = {
    __typename: 'PullRequestReviewThread',
    isResolved: false,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    pullRequest: { number: 7, repository: { nameWithOwner: repo.nameWithOwner } },
  }
  const json = vi
    .fn<GithubJSON>()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ data: { node: thread } })
    .mockResolvedValueOnce({
      data: { resolveReviewThread: { thread: { id: 'thread-1', isResolved: true } } },
    })
  await actOnGithubPull(json, repo, {
    ...scope,
    action: 'resolve',
    threadId: 'thread-1',
    resolved: true,
  })
  expect(json.mock.calls[2][0]).toContain(
    'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}',
  )
  json
    .mockReset()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ data: { node: { ...thread, viewerCanResolve: false } } })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'resolve',
      threadId: 'thread-1',
      resolved: true,
    }),
  ).rejects.toThrow('cannot change')
  expect(json).toHaveBeenCalledTimes(2)
  json
    .mockReset()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ data: { node: { ...thread, isResolved: true } } })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'resolve',
      threadId: 'thread-1',
      resolved: true,
    }),
  ).resolves.toMatchObject({ status: 'updated' })
  expect(json).toHaveBeenCalledTimes(2)
  json
    .mockReset()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({
      data: {
        node: {
          ...thread,
          pullRequest: { number: 7, repository: { nameWithOwner: 'elsewhere/project' } },
        },
      },
    })
  await expect(
    actOnGithubPull(json, repo, {
      ...scope,
      action: 'resolve',
      threadId: 'thread-1',
      resolved: true,
    }),
  ).rejects.toThrow('another pull request')
})

it('requests users and teams separately and preserves merge refusal instead of reporting success', async () => {
  const json = vi.fn<GithubJSON>().mockResolvedValueOnce(current).mockResolvedValueOnce({})
  await actOnGithubPull(json, repo, {
    ...scope,
    action: 'reviewers',
    operation: 'add',
    reviewers: ['dominic'],
    teams: ['maintainers'],
  })
  expect(json).toHaveBeenLastCalledWith(
    expect.arrayContaining(['reviewers[]=dominic', 'team_reviewers[]=maintainers']),
  )
  json
    .mockReset()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ merged: false, message: 'Required checks are pending.' })
  await expect(
    actOnGithubPull(json, repo, { ...scope, action: 'merge', method: 'squash' }),
  ).rejects.toThrow('Required checks are pending')
  expect(json).toHaveBeenLastCalledWith(
    expect.arrayContaining(['PUT', `sha=${sha}`, 'merge_method=squash']),
  )
})

it.each(['close', 'reopen'] as const)(
  'writes explicit %s state after the head check',
  async (action) => {
    const json = vi.fn<GithubJSON>().mockResolvedValueOnce(current).mockResolvedValueOnce({})
    await actOnGithubPull(json, repo, { ...scope, action })
    expect(json).toHaveBeenLastCalledWith(
      expect.arrayContaining(['PATCH', `state=${action === 'close' ? 'closed' : 'open'}`]),
    )
  },
)

it('targets a saved GitHub host and repository instead of the checkout default remote', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'githubAccount').mockResolvedValue(JSON.stringify(current))
  await new PullRequests(git, { host: repo.host, repository: repo.nameWithOwner }).create(
    '/checkout',
    { title: 'Fix', body: '', head: 'fix', base: 'main', draft: false },
  )
  expect(run).toHaveBeenCalledExactlyOnceWith(
    expect.arrayContaining(['--hostname', repo.host, `${repo.path}/pulls`]),
    { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    '/checkout',
    undefined,
  )
  await expect(
    new PullRequests(git, { host: repo.host, repository: '../project' }).create('/checkout', {
      title: 'Fix',
      body: '',
      head: 'fix',
      base: 'main',
      draft: false,
    }),
  ).rejects.toThrow('Use a GitHub owner/repository name')
})

it('runs a saved GitHub connection from the selected directory without inspecting a Git checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-github-account-'))
  try {
    const command = join(directory, 'github.cjs')
    await writeFile(
      command,
      `#!/usr/bin/env node\nif(process.cwd() !== require('node:fs').realpathSync(${JSON.stringify(directory)}) || !process.argv.includes('repos/team/project/pulls'))process.exit(9);\nprocess.stdout.write(${JSON.stringify(JSON.stringify(current))});\n`,
      { mode: 0o700 },
    )
    const git = new GitService(() => commandsSchema.parse({ gh: command }))
    const inspect = vi.spyOn(git, 'inspect')
    await expect(
      new PullRequests(git, { host: repo.host, repository: repo.nameWithOwner }).create(directory, {
        title: 'From non-checkout',
        body: '',
        head: 'fix',
        base: 'main',
        draft: false,
      }),
    ).resolves.toMatchObject({ status: 'created', number: 7 })
    expect(inspect).not.toHaveBeenCalled()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('removes only explicitly selected review requests using the removal endpoint', async () => {
  const json = vi.fn<GithubJSON>().mockResolvedValueOnce(current).mockResolvedValueOnce({})
  await actOnGithubPull(json, repo, {
    ...scope,
    action: 'reviewers',
    operation: 'remove',
    reviewers: ['reviewer'],
    teams: ['maintainers'],
  })
  expect(json).toHaveBeenLastCalledWith(
    expect.arrayContaining(['DELETE', 'reviewers[]=reviewer', 'team_reviewers[]=maintainers']),
  )
})

it('uses the selected GitHub profile only in the command environment from its checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-github-profile-'))
  const originalToken = process.env.GH_TOKEN
  try {
    const command = join(directory, 'github.cjs')
    const token = 'fixture-selected-profile-token'
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require('node:fs');
if (process.cwd() !== fs.realpathSync(${JSON.stringify(directory)})) process.exit(9);
if (process.env.GH_TOKEN !== ${JSON.stringify(token)} || process.env.GH_ENTERPRISE_TOKEN !== ${JSON.stringify(token)} || process.env.GH_HOST !== ${JSON.stringify(repo.host)}) process.exit(10);
if (process.argv.some(arg => arg.includes(${JSON.stringify(token)}))) process.exit(11);
process.stdout.write(${JSON.stringify(JSON.stringify(current))});
`,
      { mode: 0o700 },
    )
    const audit = vi.fn<NonNullable<ConstructorParameters<typeof GitService>[1]>>()
    const git = new GitService(() => commandsSchema.parse({ gh: command }), audit)
    const profileToken = vi.fn<(cwd: string) => Promise<string>>().mockResolvedValue(token)
    await new PullRequests(git, {
      host: repo.host,
      repository: repo.nameWithOwner,
      profile: 'selected-user',
      token: profileToken,
    }).create(directory, { title: 'Fix', body: '', head: 'fix', base: 'main', draft: false })
    expect(profileToken).toHaveBeenCalledExactlyOnceWith(directory)
    expect(JSON.stringify(audit.mock.calls)).not.toContain(token)
    expect(process.env.GH_TOKEN).toBe(originalToken)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
