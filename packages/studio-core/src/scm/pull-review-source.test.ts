import { expect, it, vi } from 'vite-plus/test'
import {
  decode,
  repositorySchema,
  pullDetailSchema,
  type ForgeSourceIdentity,
} from '@dovo/protocol'
import { pullReviewRepositories, resolvePullReviewSource } from './pull-review-source'
import type { WorkspaceRequest } from '../workspace/context'

const url = 'https://github.com/acme/repo/pull/42'
const repository = (id: string, identity: string) =>
  decode(repositorySchema, { id, name: id, path: '/' + id, branch: 'main', pullIdentity: identity })
const detail = (url: string, headSha = 'a'.repeat(40)) =>
  decode(pullDetailSchema, {
    pull: {
      number: 42,
      title: 'PR',
      body: '',
      url,
      repositoryUrl: url.replace(/\/pull\/42$/, ''),
      state: 'open',
      draft: false,
      author: 'owner',
      updatedAt: '',
      head: 'topic',
      base: 'main',
      headSha,
      baseSha: 'b'.repeat(40),
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      mergeable: true,
      labels: [],
      reviewers: [],
      assignees: [],
    },
    files: [],
    comments: [],
    checks: [],
    warnings: [],
  })

it('selects projects by forge identity instead of origin-local IDs, including HTTP forges', () => {
  const repos = [
    repository('other-id', 'github.com/acme/repo'),
    repository('origin-id', 'github.com/unrelated/repo'),
  ]
  expect(pullReviewRepositories(url, repos).map((item) => item.id)).toEqual(['other-id'])
  const lan = repository('lan', 'forge.lan/team/repo')
  expect(pullReviewRepositories('http://forge.lan/team/repo/pulls/42', [lan])).toEqual([lan])
})

it('pins the destination computer account and reads with destination-local project identity', async () => {
  const inputs: unknown[] = []
  const request: WorkspaceRequest = async (path, input, schema) => {
    inputs.push(input)
    return decode(
      schema,
      path.endsWith('/identity')
        ? { readerIdentity: 'remote-reader', destination: 'remote-account' }
        : detail(url),
    )
  }
  let pin: ForgeSourceIdentity | undefined
  const result = await resolvePullReviewSource({
    detail: detail(url),
    repositoryId: 'remote-project',
    request,
    remember: (value) => {
      pin = value
    },
  })
  expect(inputs).toEqual([
    { repositoryId: 'remote-project', refresh: true },
    {
      repositoryId: 'remote-project',
      number: 42,
      section: 'overview',
      refresh: true,
      expectedReaderIdentity: 'remote-reader',
      expectedDestination: 'remote-account',
    },
  ])
  expect(result.destination).toBe('remote-account')
  expect(pin?.destination).toBe('remote-account')
  // Retry retains the old identity rather than silently selecting a changed account.
  inputs.length = 0
  await resolvePullReviewSource({
    detail: detail(url),
    repositoryId: 'remote-project',
    request,
    pin,
    remember: () => {},
  })
  expect(inputs).toHaveLength(1)
})

it('rejects a different project, revision, or stale remote response', async () => {
  for (const remote of [
    detail('https://github.com/other/repo/pull/42'),
    detail(url, 'c'.repeat(40)),
    { ...detail(url), stale: true },
  ]) {
    const request: WorkspaceRequest = async (path, _input, schema) =>
      decode(
        schema,
        path.endsWith('/identity')
          ? { readerIdentity: 'reader', destination: 'destination' }
          : remote,
      )
    await expect(
      resolvePullReviewSource({
        detail: detail(url),
        repositoryId: 'remote',
        request,
        remember: vi.fn<(identity: ForgeSourceIdentity) => void>(),
      }),
    ).rejects.toThrow(/different project|PR changed|unavailable/)
  }
})

it('keeps the pinned account after a rejected read instead of discovering a replacement', async () => {
  const paths: string[] = []
  const pin = { destination: 'original-account', readerIdentity: 'original-reader' }
  const request: WorkspaceRequest = async (path, input) => {
    paths.push(path)
    expect(input).toMatchObject({
      expectedDestination: pin.destination,
      expectedReaderIdentity: pin.readerIdentity,
    })
    throw new Error('The source account changed.')
  }
  await expect(
    resolvePullReviewSource({
      detail: detail(url),
      repositoryId: 'remote',
      request,
      pin,
      remember: () => {},
    }),
  ).rejects.toThrow('source account changed')
  expect(paths).toEqual(['/api/scm/pulls/detail'])
})
