import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, forgeSourceIdentitySchema, pullDetailSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { GithubTransport } from '../scm/git/github-transport'
import { GitForgeWork } from '../scm/work/forge-work-git'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const sha = 'a'.repeat(40)
it('rejects a mismatched explicit project account before reading provider data or identity', async () => {
  const f = await setup()
  for (const path of ['source/identity', 'pulls/detail', 'pulls/action']) {
    const response = await f.call(path, {
      repositoryId: 'repo',
      connectionId: 'other-account',
      number: 7,
      section: 'overview',
      action: 'close',
      headSha: sha,
    })
    expect(response.status).toBe(409)
  }
  expect(f.reads).toEqual([])
  expect(f.writes).toEqual([])
})
async function setup(provider: 'forgejo' | 'github' = 'forgejo') {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const owner = 'scm-destination-test-owner-token-with-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  cleanup.push(() => runtime.close())
  const s = runtime.services
  f.workspace.repositories[0]!.path = f.directory
  s.store.update(() => f.workspace)
  const clientFetch = fetch
  let account = 17
  let credential = 'secret-one'
  let repository = 'old/project'
  let userFailure = false
  let privateReadFailure: 401 | 403 | undefined
  const writes: string[] = []
  const reads: string[] = []
  const repo = () => ({
    id: 1,
    name: 'project',
    full_name: repository,
    html_url: `https://forge.example/${repository}`,
    clone_url: `https://forge.example/${repository}.git`,
    default_branch: 'main',
  })
  const pull = () => ({
    number: 7,
    title: 'Private pull',
    html_url: `https://forge.example/${repository}/pulls/7`,
    state: 'open',
    merged: false,
    user: { login: 'author' },
    updated_at: '2026-10-14',
    head: { label: 'author:fix', ref: 'fix', sha, repo: repo() },
    base: { label: 'main', ref: 'main', sha: 'b'.repeat(40), repo: repo() },
    labels: [],
    body: 'Private body',
    additions: 0,
    deletions: 0,
    changed_files: 0,
    requested_reviewers: [],
    assignees: [],
  })
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    expect(url.hostname).toBe('forge.example')
    expect(new Headers(init?.headers).get('authorization')).toBe(`token ${credential}`)
    if ((init?.method ?? 'GET') !== 'GET') {
      writes.push(url.pathname)
      return Response.json({ id: 1 })
    }
    reads.push(url.pathname)
    if (url.pathname === '/api/v1/user')
      return userFailure
        ? new Response('private provider data', { status: 401 })
        : Response.json({ id: account, login: 'viewer' })
    if (url.pathname.endsWith('/version')) return Response.json({ version: '13.0.0' })
    if (url.pathname.endsWith(`/repos/${repository}`)) return Response.json(repo())
    if (url.pathname.endsWith('/pulls/7')) {
      if (privateReadFailure)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('private provider data'))
            },
          }),
          { status: privateReadFailure },
        )
      return Response.json(pull())
    }
    if (url.pathname.endsWith('/pulls/7.diff')) return new Response('')
    if (url.pathname.includes('/commits/') && url.pathname.endsWith('/status'))
      return Response.json({ state: 'success', statuses: [] })
    return Response.json([])
  })
  vi.stubGlobal('fetch', fetcher)
  const githubReads: string[] = []
  const githubWrites: Array<{ token: string; path: string }> = []
  vi.spyOn(GithubTransport.prototype, 'send').mockImplementation(async (request, token) => {
    if (request.method === 'GET') githubReads.push(request.path)
    if (request.path === 'user') return JSON.stringify({ id: account, login: 'viewer' })
    if (request.method !== 'GET') {
      githubWrites.push({ token, path: request.path })
      return JSON.stringify({ html_url: `https://github.com/${repository}/pull/7` })
    }
    if (request.path.includes('/pulls?')) return JSON.stringify([{ ...pull(), merged_at: null }])
    if (request.path.endsWith('/pulls/7'))
      return JSON.stringify({
        ...pull(),
        html_url: `https://github.com/${repository}/pull/7`,
        head: {
          label: 'author:fix',
          ref: 'fix',
          sha,
          repo: { clone_url: `https://github.com/${repository}.git` },
        },
        base: { label: 'main', ref: 'main', sha: 'b'.repeat(40) },
        merged: false,
        merged_at: null,
        draft: false,
        mergeable: true,
      })
    return '{}'
  })
  const connection = s.forges.save({
    name: 'Source',
    provider,
    baseUrl: provider === 'github' ? 'https://github.com' : 'https://forge.example',
    credential: 'token',
    token: credential,
  })
  const bind = () =>
    s.store.update((w) => ({
      ...w,
      repositories: w.repositories.map((r) => ({
        ...r,
        forge: {
          connectionId: connection.id,
          repository,
          revision: s.forges.get(connection.id).revision,
        },
      })),
    }))
  bind()
  const call = async (path: string, body: unknown, token = owner) => {
    const response = await clientFetch(`http://127.0.0.1:${runtime.port}/api/scm/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, data: (await response.json()) as unknown }
  }
  const identity = async () =>
    decode(
      forgeSourceIdentitySchema,
      (await call('source/identity', { repositoryId: 'repo' })).data,
    )
  return {
    s,
    call,
    identity,
    writes,
    reads,
    githubWrites,
    githubReads,
    connection,
    f,
    bind,
    setRepository: (value: string) => {
      repository = value
      bind()
    },
    setAccount: (value: number) => {
      account = value
      // Changing accounts changes the captured credential, not the user behind an unchanged token.
      credential = `account-${value}`
      s.forges.save({ ...s.forges.get(connection.id), token: credential })
      bind()
    },
    rejectUser: () => {
      userFailure = true
      credential = 'rejected-credential'
      s.forges.save({ ...s.forges.get(connection.id), token: credential })
      bind()
    },
    rejectPrivateRead: (status: 401 | 403) => {
      privateReadFailure = status
    },
    rotate: (value: string) => {
      credential = value
      s.forges.save({ ...connection, token: value })
      bind()
    },
  }
}
it.each(['forgejo', 'github'] as const)(
  'rejects a pre-request %s rebind with identical PR number/SHA before provider writes',
  async (provider) => {
    const f = await setup(provider)
    const before = await f.identity()
    f.setRepository('new/project')
    const result = await f.call('pulls/action', {
      repositoryId: 'repo',
      number: 7,
      headSha: sha,
      action: 'comment',
      body: 'Keep my draft',
      expectedDestination: before.destination,
    })
    expect(result.status).toBe(409)
    expect(f.writes).toEqual([])
    expect(f.githubWrites).toEqual([])
    const current = await f.identity()
    expect(current.readerIdentity).toBe(before.readerIdentity)
    expect(current.destination).not.toBe(before.destination)
    const accepted = await f.call('pulls/action', {
      repositoryId: 'repo',
      number: 7,
      headSha: sha,
      action: 'comment',
      body: 'Correct destination',
      expectedDestination: current.destination,
    })
    expect(accepted.status).toBe(200)
    expect(provider === 'github' ? f.githubWrites[0]?.path : f.writes[0]).toContain(
      'new/project/issues/7/comments',
    )
  },
)
it('separates stable verified reader identity from binding IDs and credential revisions', async () => {
  const f = await setup('github')
  const first = await f.identity()
  f.rotate('secret-two')
  const second = await f.identity()
  expect(second.readerIdentity).toBe(first.readerIdentity)
  expect(second.destination).not.toBe(first.destination)
  const duplicate = f.s.forges.save({
    name: 'Another reader',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'token',
    token: 'secret-two',
  })
  f.s.store.update((w) => ({
    ...w,
    repositories: [
      ...w.repositories,
      {
        ...w.repositories[0]!,
        id: 'reader-two',
        path: '/different-checkout',
        forge: { connectionId: duplicate.id, repository: 'another/repository' },
      },
    ],
  }))
  const other = decode(
    forgeSourceIdentitySchema,
    (await f.call('source/identity', { repositoryId: 'reader-two' })).data,
  )
  expect(other.readerIdentity).toBe(first.readerIdentity)
  expect(JSON.stringify(other)).not.toMatch(/secret-|viewer|github.com/)
  f.setAccount(18)
  const result = await f.call('pulls/action', {
    repositoryId: 'repo',
    number: 7,
    headSha: sha,
    action: 'comment',
    body: 'Draft',
    expectedDestination: second.destination,
  })
  expect(result.status).toBe(409)
  expect(f.githubWrites).toEqual([])
})
it('checks discovered reader identity before cached private reads and authenticates discovery', async () => {
  const f = await setup()
  const first = await f.identity()
  const detail = await f.call('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
    expectedReaderIdentity: first.readerIdentity,
  })
  expect(detail.status).toBe(200)
  const loaded = decode(pullDetailSchema, detail.data)
  expect(loaded.destination).toBe(first.destination)
  expect(loaded.pull.destination).toBe(first.destination)
  f.setAccount(18)
  const result = await f.call('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
    expectedReaderIdentity: first.readerIdentity,
  })
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).not.toContain('Private body')
  f.rejectUser()
  const unauthorized = await f.call('pulls/detail', { repositoryId: 'repo', number: 7 })
  expect(unauthorized.status).toBe(401)
  expect(JSON.stringify(unauthorized.data)).not.toContain('private provider data')
  expect(
    (await f.call('source/identity', { repositoryId: 'repo' }, 'wrong-device-token')).status,
  ).toBe(401)
  expect((await f.call('source/identity', {})).status).toBe(400)
  expect(
    (await f.call('source/identity', { repositoryId: 'repo', jiraSourceId: 'jira' })).status,
  ).toBe(400)
})
it.each([401, 403] as const)(
  'preserves an interrupted HTTP %i rejection rather than returning cached private PR data',
  async (status) => {
    const f = await setup()
    expect((await f.call('pulls/detail', { repositoryId: 'repo', number: 7 })).status).toBe(200)
    f.rejectPrivateRead(status)
    const result = await f.call('pulls/detail', { repositoryId: 'repo', number: 7, refresh: true })
    expect(result.status).toBe(status)
    expect(JSON.stringify(result.data)).not.toContain('Private body')
    expect(JSON.stringify(result.data)).not.toContain('private provider data')
    expect(f.writes).toEqual([])
  },
)
it('applies destination/account guards to issue and pipeline mutations at the HTTP boundary', async () => {
  const f = await setup()
  const first = await f.identity()
  const issue = vi.spyOn(GitForgeWork.prototype, 'actOnIssue')
  const pipeline = vi.spyOn(GitForgeWork.prototype, 'actOnPipeline')
  f.setRepository('new/project')
  expect(
    (
      await f.call('work/issues/action', {
        repositoryId: 'repo',
        action: 'comment',
        id: '7',
        revision: 'same-revision',
        body: 'Draft',
        expectedDestination: first.destination,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await f.call('work/pipelines/action', {
        repositoryId: 'repo',
        action: 'cancel',
        id: '7',
        expectedDestination: first.destination,
      })
    ).status,
  ).toBe(409)
  expect(issue).not.toHaveBeenCalled()
  expect(pipeline).not.toHaveBeenCalled()
  expect(f.writes).toEqual([])
})
it('preserves a matching project account for URL-only PRs and reports unrelated multiaccount ambiguity', async () => {
  const f = await setup('github')
  f.s.forges.save({
    name: 'Other',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'token',
    token: 'different-account',
  })
  const matched = f.s.pulls.urlTarget('https://github.com/old/project/pull/7')
  expect(await matched.sourceIdentity()).toMatchObject({
    readerIdentity: (await f.identity()).readerIdentity,
  })
  expect(() => f.s.pulls.urlTarget('https://github.com/unrelated/private/pull/7')).toThrow(
    'Multiple GitHub accounts',
  )
  const ambiguous = await f.call('pulls/detail', {
    repositoryId: 'https://github.com/unrelated/private/pull/7',
    number: 7,
  })
  expect(ambiguous.status).toBe(409)
  const selected = f.s.pulls.urlTarget(
    'https://github.com/unrelated/private/pull/7',
    f.connection.id,
  )
  const destination = (await selected.sourceIdentity()).destination
  f.rotate('secret-two')
  expect(
    (
      await f.call('pulls/action', {
        repositoryId: 'https://github.com/unrelated/private/pull/7',
        connectionId: f.connection.id,
        number: 7,
        action: 'comment',
        body: 'Draft',
        headSha: sha,
        expectedDestination: destination,
      })
    ).status,
  ).toBe(409)
  expect(f.githubWrites).toEqual([])
})
it('rejects an account switch between HTTP reader verification and cache execution before private provider reads', async () => {
  const f = await setup()
  const first = await f.identity()
  const source = f.s.pulls.sourceContext.bind(f.s.pulls)
  let calls = 0
  vi.spyOn(f.s.pulls, 'sourceContext').mockImplementation(async (cwd) => {
    const result = await source(cwd)
    if (++calls === 1) f.setAccount(18)
    return result
  })
  const result = await f.call('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
    expectedReaderIdentity: first.readerIdentity,
  })
  expect(result.status).toBe(409)
  expect(f.reads.some((path) => path.endsWith('/pulls/7'))).toBe(false)
})
it('rejects an account switch between cache scope resolution and detail loading before provider dispatch', async () => {
  const f = await setup()
  const source = f.s.pulls.sourceContext.bind(f.s.pulls)
  let calls = 0
  vi.spyOn(f.s.pulls, 'sourceContext').mockImplementation(async (cwd) => {
    const result = await source(cwd)
    if (++calls === 1) f.setAccount(18)
    return result
  })
  const result = await f.call('pulls/detail', { repositoryId: 'repo', number: 7 })
  expect(result.status).toBe(409)
  expect(f.reads.some((path) => path.endsWith('/pulls/7'))).toBe(false)
})

it('uses the linked thread project account for a PR in another GitHub repository', async () => {
  const f = await setup('github')
  const other = f.s.forges.save({
    name: 'Other',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'token',
    token: 'other-account',
  })
  const url = 'https://github.com/unrelated/private/pull/7'
  const task = f.s.tasks.create({
    title: 'Linked PR',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Review',
  })
  f.s.store.updateTask(task.id, (task) => ({
    ...task,
    linkedPullRequests: [
      { number: 7, url, title: 'Linked PR', repositoryUrl: 'https://github.com/unrelated/private' },
    ],
  }))
  const reader = vi.spyOn(f.s.git, 'githubAccount')
  const source = f.s.pulls.urlTarget(url)
  const identity = await source.sourceIdentity()
  expect(identity.readerIdentity).toBe((await f.identity()).readerIdentity)
  expect(reader.mock.calls[0]?.[2]).toBe(f.s.store.get().repositories[0].path)
  expect(reader.mock.calls[0]?.[3]?.token).toBe('secret-one')
  await f.s.pulls.urlTarget(url, other.id).sourceIdentity()
  expect(reader.mock.calls.at(-1)?.[3]?.token).toBe('other-account')
  const scope = identity.destination
  f.rotate('secret-two')
  await expect(source.guard({ expectedDestination: scope })).rejects.toThrow('account changed')
})

it('uses the originating project gh environment when a linked PR has no explicit forge binding', async () => {
  const f = await setup('github')
  f.s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({ ...repo, forge: undefined })),
  }))
  const url = 'https://github.com/unrelated/private/pull/7'
  const task = f.s.tasks.create({
    title: 'CLI account',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Review',
  })
  f.s.store.updateTask(task.id, (task) => ({
    ...task,
    linkedPullRequests: [
      { number: 7, url, title: 'Linked PR', repositoryUrl: 'https://github.com/unrelated/private' },
    ],
  }))
  const credential = vi
    .spyOn(f.s.git, 'githubCredential')
    .mockResolvedValue({ host: 'github.com', token: 'project-cli-token' })
  await f.s.pulls.urlTarget(url).sourceIdentity()
  expect(credential).toHaveBeenCalledWith(
    f.s.store.get().repositories[0].path,
    'github.com',
    undefined,
    true,
  )
})

it('loads and caches a guarded GitHub overview without reading files, discussion or checks', async () => {
  const f = await setup('github')
  const identity = await f.identity()
  const input = {
    repositoryId: 'repo',
    number: 7,
    section: 'overview',
    expectedReaderIdentity: identity.readerIdentity,
    expectedDestination: identity.destination,
  }
  for (let i = 0; i < 2; i++) {
    const result = await f.call('pulls/detail', input)
    expect(result.status).toBe(200)
    expect(decode(pullDetailSchema, result.data).pull.body).toBe('Private body')
  }
  expect(f.githubReads.filter((path) => path !== 'user')).toEqual(['repos/old/project/pulls/7'])
  expect((await f.call('pulls/detail', { ...input, refresh: true })).status).toBe(200)
  expect(f.githubReads.filter((path) => path.endsWith('/pulls/7'))).toHaveLength(2)
  const before = f.githubReads.length
  expect(
    (await f.call('pulls/detail', { ...input, expectedDestination: 'different' })).status,
  ).toBe(409)
  expect(f.githubReads.slice(before).every((path) => path === 'user')).toBe(true)
  f.setAccount(18)
  expect((await f.call('pulls/detail', input)).status).toBe(409)
  expect(f.githubReads.filter((path) => path.endsWith('/pulls/7'))).toHaveLength(2)
})
it('checks URL section destinations before returning cached PR data', async () => {
  const f = await setup('github')
  const input = {
    repositoryId: 'https://github.com/old/project/pull/7',
    number: 7,
    connectionId: f.connection.id,
    section: 'overview',
  }
  const first = await f.call('pulls/detail', input)
  expect(first.status).toBe(200)
  const detail = decode(pullDetailSchema, first.data)
  expect(
    (await f.call('pulls/detail', { ...input, expectedDestination: detail.destination })).status,
  ).toBe(200)
  expect(
    (await f.call('pulls/detail', { ...input, expectedDestination: 'different' })).status,
  ).toBe(409)
  expect(f.githubReads.filter((path) => path.endsWith('/pulls/7'))).toHaveLength(1)
  expect((await f.call('pulls/detail', { ...input, section: 'stack' })).status).toBe(400)
})

it('reuses one verified context per list request and one account check across cached reads', async () => {
  const f = await setup('github')
  const identity = await f.identity()
  const context = vi.spyOn(f.s.pulls, 'sourceContext')
  const input = {
    repositoryId: 'repo',
    expectedReaderIdentity: identity.readerIdentity,
    expectedDestination: identity.destination,
  }
  for (let index = 0; index < 2; index++) {
    const response = await f.call('pulls/overview', input)
    expect(response.status).toBe(200)
  }
  expect(context).toHaveBeenCalledTimes(2)
  expect(f.githubReads.filter((path) => path === 'user')).toHaveLength(1)
  expect(f.githubReads.filter((path) => path.includes('/pulls?'))).toHaveLength(1)
  expect((await f.call('pulls/overview', { ...input, refresh: true })).status).toBe(200)
  expect(context).toHaveBeenCalledTimes(3)
  expect(f.githubReads.filter((path) => path === 'user')).toHaveLength(2)
  expect(f.githubReads.filter((path) => path.includes('/pulls?'))).toHaveLength(2)
})
