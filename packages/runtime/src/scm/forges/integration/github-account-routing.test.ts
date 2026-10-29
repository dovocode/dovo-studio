import { afterEach, expect, it, vi } from 'vite-plus/test'
import { writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../../testing/fixture'
import { startRuntime } from '../../../index'
import type { AgentRun, AgentAdapter } from '../../../agents/execution/types'
import { runtimeIntegration } from '../../../testing/integration'
import { GithubTransport } from '../../git/github-transport'
vi.setConfig(runtimeIntegration)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
it('isolates named and wrapper accounts across repositories, worktrees, pushes and agent turns', async () => {
  const personal = await fixture(),
    work = await fixture()
  cleanup.push(personal.cleanup, work.cleanup)
  const gh = join(personal.directory, 'fixture-gh.cjs')
  await writeFile(
    gh,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const userIndex = args.indexOf('--user');
const login = process.env.GH_ACCOUNT || (userIndex >= 0 ? args[userIndex + 1] : process.env.GH_TOKEN?.replace('fixture-token-', ''));
if (args[0] === 'auth' && args[1] === 'token') {
  if (!login || process.env.GH_TOKEN && (userIndex >= 0 || process.env.GH_ACCOUNT)) process.exit(7);
  process.stdout.write('fixture-token-' + login);
} else process.exit(8);
`,
    { mode: 0o700 },
  )
  // gh only mints tokens; API requests carry the minted token to GitHub.
  vi.spyOn(GithubTransport.prototype, 'send').mockImplementation(async (request, token) => {
    const login = token.replace(/^fixture-token-/, '')
    if (request.path === 'user') return JSON.stringify({ id: login === 'personal' ? 1 : 2, login })
    if (request.path.startsWith('user/repos'))
      return JSON.stringify([
        {
          id: 1,
          name: 'app',
          full_name: `${login}/app`,
          html_url: `https://github.com/${login}/app`,
          clone_url: `https://github.com/${login}/app.git`,
          default_branch: 'main',
        },
      ])
    throw new Error(`Unexpected GitHub request ${request.path}`)
  })
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'github-account-fixture-owner-token-with-32-characters',
    port: 0,
  })
  cleanup.push(() => runtime.close())
  const s = runtime.services
  s.commands.save({ ...s.commands.get(), gh })
  const named = s.forges.save({
    name: 'Personal',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh',
    cliProfile: 'personal',
  })
  const wrapper = s.forges.save({
    name: 'Work',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh-wrapper',
    cliEnv: { GH_ACCOUNT: 'work' },
  })
  personal.workspace.repositories = [
    {
      ...personal.workspace.repositories[0]!,
      path: await realpath(personal.directory),
      forge: { connectionId: named.id, repository: 'personal/app', revision: named.revision },
    },
    {
      ...work.workspace.repositories[0]!,
      id: 'work',
      path: await realpath(work.directory),
      forge: { connectionId: wrapper.id, repository: 'work/app', revision: wrapper.revision },
    },
  ]
  s.store.update(() => personal.workspace)
  const { runtimeSnapshot } = await import('../../../http/support/runtime-snapshot.js')
  const { Effect } = await import('effect')
  const identity = vi
    .spyOn(s.git, 'cachedRepositoryIdentity')
    .mockReturnValue(Promise.resolve('github.com/clone/app'))
  const snapshot = await Effect.runPromise(runtimeSnapshot(s, { id: 'owner', owner: true }))
  expect(
    snapshot.workspace.repositories.filter((repo) => !repo.kind).map((repo) => repo.pullIdentity),
  ).toEqual(['github.com/personal/app', 'github.com/work/app'])
  expect(
    snapshot.workspace.repositories.filter((repo) => !repo.kind).map((repo) => repo.gitIdentity),
  ).toEqual(['github.com/clone/app', 'github.com/clone/app'])
  identity.mockRestore()
  vi.stubEnv('GH_TOKEN', 'ambient-token')
  const originalSelector = process.env.GH_ACCOUNT
  const [first, second] = await Promise.all([
    s.git.github(personal.directory, ['api', '--hostname', 'github.com', 'user']),
    s.git.github(work.directory, ['api', '--hostname', 'github.com', 'user']),
  ])
  expect(JSON.parse(first)).toEqual({ id: 1, login: 'personal' })
  expect(JSON.parse(second)).toEqual({ id: 2, login: 'work' })
  // Selecting a new account from another project's checkout must not inherit its wrapper selector.
  const listed = await s.pulls.adapter(named.id, 'personal/app', work.directory).repositories(1)
  expect(listed.repositories[0]?.fullName).toBe('personal/app')
  const worktree = join(work.directory, 'linked-checkout')
  await s.git.command(work.directory, ['worktree', 'add', '--detach', worktree])
  expect(await s.git.githubEnvironment(worktree)).toMatchObject({
    GH_ACCOUNT: 'work',
    GH_TOKEN: 'fixture-token-work',
  })
  const personalIdentity = await s.pulls.identity(personal.directory)
  const workIdentity = await s.pulls.identity(worktree)
  expect(personalIdentity).not.toBe(workIdentity)
  expect(personalIdentity).toMatch(/^[a-f0-9]{64}$/)
  expect(workIdentity).toMatch(/^[a-f0-9]{64}$/)
  expect(personalIdentity + workIdentity).not.toContain('fixture-token')
  await s.git.command(work.directory, [
    'remote',
    'add',
    'origin',
    'https://github.com/work/app.git',
  ])
  const command = s.git.command.bind(s.git)
  const push = vi
    .spyOn(s.git, 'command')
    .mockImplementation(async (cwd, args, env) =>
      args.includes('push') ? '' : command(cwd, args, env),
    )
  await s.git.push(work.directory)
  expect(push).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['push']),
    expect.objectContaining({ GH_ACCOUNT: 'work', GH_TOKEN: 'fixture-token-work' }),
  )
  push.mockRestore()
  const runs: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Work',
    repositoryId: 'work',
    agentId: 'agent',
    objective: 'Check',
  })
  await (
    await s.tasks.start(task.id)
  ).done
  expect(runs[0]?.agent.env).toMatchObject({ GH_ACCOUNT: 'work', GH_TOKEN: 'fixture-token-work' })
  expect(JSON.stringify(s.store.get())).not.toContain('fixture-token-work')
  expect(JSON.stringify(s.forges.list())).not.toContain('fixture-token')
  expect(process.env.GH_TOKEN).toBe('ambient-token')
  expect(process.env.GH_ACCOUNT).toBe(originalSelector)
})

it.each(['gh', 'gh-wrapper'] as const)(
  'invalidates the actual bound %s credential source on 401 without retrying a mutation',
  async (credential) => {
    const { ForgeCliAccounts } = await import('./forge-cli-accounts.js')
    let token = 'fixture-old-token'
    const mint = vi
      .spyOn(ForgeCliAccounts.prototype, 'githubToken')
      .mockImplementation(async () => token)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'github-rejected-test-owner-token-with-32-characters',
      port: 0,
    })
    cleanup.push(() => runtime.close())
    const s = runtime.services
    const connection = s.forges.save({
      name: 'Bound',
      provider: 'github',
      baseUrl: 'https://github.com',
      credential,
      ...(credential === 'gh' ? { cliProfile: 'viewer' } : { cliEnv: { GH_ACCOUNT: 'viewer' } }),
    })
    const rejected = vi.fn<(token: string) => void>()
    vi.spyOn(GithubTransport.prototype, 'send').mockImplementation(
      async (request, supplied, options) => {
        if (request.path === 'user') return JSON.stringify({ id: 17, login: 'viewer' })
        if (request.path.endsWith('/pulls/7'))
          return JSON.stringify({
            number: 7,
            head: { sha: 'a'.repeat(40) },
            state: 'open',
            merged: false,
            html_url: 'https://github.com/owner/project/pull/7',
          })
        rejected(supplied)
        options?.onUnauthorized?.()
        const { GithubApiError } = await import('../../git/github-transport.js')
        throw new GithubApiError(401, 'GitHub API HTTP 401')
      },
    )
    const adapter = s.pulls.adapter(connection.id, 'owner/project', '/fixture')
    await expect(
      adapter.act({ action: 'comment', number: 7, headSha: 'a'.repeat(40), body: 'Private draft' }),
    ).rejects.toThrow('HTTP 401')
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(rejected).toHaveBeenCalledWith('fixture-old-token')
    token = 'fixture-new-token'
    await expect(s.forges.githubToken(connection.id, '/fixture')).resolves.toBe('fixture-new-token')
    expect(mint).toHaveBeenCalledTimes(2)
  },
)
it('rechecks destination immediately before a budget-queued GitHub mutation dispatches', async () => {
  const { GitService } = await import('../../git/git.js')
  const { HttpError } = await import('../../../errors.js')
  const git = new GitService()
  const release: Array<() => void> = []
  const writes = vi.fn<() => void>()
  vi.spyOn(GithubTransport.prototype, 'send').mockImplementation(async (request) => {
    if (request.method === 'GET')
      return new Promise<string>((resolve) => release.push(() => resolve('{}')))
    writes()
    return '{}'
  })
  const account = { host: 'github.com', token: 'fixture-budget-token' }
  const reading = Array.from({ length: 4 }, () =>
    git.githubAccount(['api', '--hostname', 'github.com', 'user'], undefined, '/fixture', account),
  )
  await vi.waitFor(() => expect(release).toHaveLength(4))
  let destination = 'original'
  const queued = git.githubAccount(
    [
      'api',
      '--hostname',
      'github.com',
      'repos/owner/project/issues/7/comments',
      '--method',
      'POST',
    ],
    undefined,
    '/fixture',
    {
      ...account,
      beforeDispatch: () => {
        if (destination !== 'original')
          throw new HttpError(409, 'Destination changed before dispatch')
      },
    },
  )
  const rejected = queued.then(
    () => undefined,
    (error: unknown) => error,
  )
  destination = 'rebound'
  release[0]!()
  expect(await rejected).toMatchObject({ status: 409 })
  for (const finish of release.slice(1)) finish()
  await Promise.all(reading)
  expect(writes).not.toHaveBeenCalled()
})
