import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { commandsSchema } from '@dovo/protocol'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { GitService } from '../git/git'
import { ForgeConnections } from '../forges/integration/forge-connections'
import { ForgePullRequests } from '../forges/integration/forge-pulls'
import { ForgeWork } from './forge-work'
import { GitForgeWork } from './forge-work-git'
const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})
function setup() {
  const db = openDatabase(':memory:')
  cleanup.push(() => db.close())
  const store = new WorkspaceStore(db)
  store.update((workspace) => ({
    ...workspace,
    repositories: [
      {
        id: 'repo',
        name: 'Repo',
        path: '/repo',
        branch: 'main',
      },
    ],
  }))
  const git = new GitService()
  vi.spyOn(git, 'command').mockImplementation(async (_cwd, args) => {
    if (args.length === 1 && args[0] === 'remote') return 'origin\n'
    expect(args).toEqual(['remote', 'get-url', 'origin'])
    return 'https://github.com/me/app.git\n'
  })
  const github = vi.spyOn(git, 'github').mockResolvedValue(
    JSON.stringify({
      nameWithOwner: 'me/app',
      url: 'https://github.com/me/app',
    }),
  )
  const connections = new ForgeConnections(db)
  const pulls = new ForgePullRequests(git, connections, store)
  vi.spyOn(git, 'githubCredential').mockResolvedValue({
    host: 'github.com',
    token: 'fixture-token',
    onUnauthorized: () => {},
  })
  vi.spyOn(git, 'githubAccount').mockResolvedValue(
    JSON.stringify({ id: 1, login: 'fixture-account' }),
  )
  const service = new ForgeWork(db, store, git, connections, pulls, () =>
    decode(commandsSchema, {}),
  )
  return {
    db,
    service,
    connections,
    pulls,
    git,
    github,
  }
}
it('replaces invalid persisted cache entries instead of blocking issue loading', async () => {
  const { db, service } = setup()
  const load = vi.spyOn(GitForgeWork.prototype, 'issues').mockResolvedValue({
    items: [],
    next: undefined,
  })
  await service.request('repo', 'issues/list', {})
  db.prepare('UPDATE forge_work_cache SET value=?').run('{broken')
  await expect(service.request('repo', 'issues/list', {})).resolves.toMatchObject({
    items: [],
  })
  expect(load).toHaveBeenCalledTimes(2)
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({
    count: 1,
  })
})
it('isolates search results by query and reuses a repeated search', async () => {
  const { service } = setup()
  const load = vi.spyOn(GitForgeWork.prototype, 'issues').mockResolvedValue({
    items: [],
    next: undefined,
  })
  await service.request('repo', 'issues/list', {
    query: 'login',
  })
  await service.request('repo', 'issues/list', {
    query: 'logout',
  })
  await service.request('repo', 'issues/list', {
    query: ' login ',
  })
  expect(load).toHaveBeenCalledTimes(2)
  expect(load).toHaveBeenNthCalledWith(1, 'open', undefined, 'login')
  expect(load).toHaveBeenNthCalledWith(2, 'open', undefined, 'logout')
})
it('rejects a saved GitHub adapter after its selected profile changes', async () => {
  const { connections, pulls, git } = setup()
  const connection = connections.save({
    provider: 'github',
    name: 'GitHub',
    baseUrl: 'https://github.com',
    credential: 'gh',
    cliProfile: 'first-user',
  })
  const api = vi.spyOn(git, 'githubAccount')
  const adapter = pulls.adapter(connection.id, 'me/app', '/checkout')
  connections.save({
    ...connection,
    cliProfile: 'second-user',
  })
  await expect(
    adapter.create({
      title: 'Draft',
      body: '',
      head: 'feature',
      base: 'main',
      draft: true,
    }),
  ).rejects.toThrow('account changed')
  expect(api).not.toHaveBeenCalled()
})
it('keeps an in-flight pre-mutation read from repopulating the invalidated cache', async () => {
  const { db, service } = setup()
  let resolveRead: (value: Awaited<ReturnType<GitForgeWork['issues']>>) => void = () => {
    throw new Error('Read not started')
  }
  const load = vi.spyOn(GitForgeWork.prototype, 'issues').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve
      }),
  )
  vi.spyOn(GitForgeWork.prototype, 'createIssue').mockResolvedValue({
    id: '2',
    url: 'https://github.com/me/app/issues/2',
    message: 'Created',
  })
  const reading = service.request('repo', 'issues/list', {})
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  await service.request('repo', 'issues/create', {
    title: 'New issue',
    body: '',
  })
  resolveRead({
    items: [],
    next: undefined,
  })
  await expect(reading).resolves.toMatchObject({
    stale: true,
  })
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({
    count: 0,
  })
})
it('treats local repositories with no remote as empty issue sources', async () => {
  const { service, github } = setup()
  github.mockRejectedValue(
    Object.assign(
      new Error('Command failed: gh repo view --json nameWithOwner,url\nno git remotes found\n'),
      {
        stderr: 'no git remotes found\n',
      },
    ),
  )
  await expect(
    service.request('repo', 'options', {
      area: 'issues',
    }),
  ).resolves.toMatchObject({
    issues: false,
    pipelines: false,
  })
  expect(
    await service.request('repo', 'options', {
      area: 'issues',
    }),
  ).not.toHaveProperty('issueNotice')
  await expect(service.request('repo', 'issues/list', {})).resolves.toEqual({
    items: [],
  })
  await expect(service.request('repo', 'pipelines/list', {})).resolves.toEqual({
    items: [],
  })
})
it.each([
  'gh auth login: authentication required',
  'Could not resolve host: api.github.com',
  'fatal: not a git repository',
  'ENOENT: no such file or directory',
  'a different error mentioning no git remotes found inside it',
])('preserves discovery failures that are not the no-remotes diagnostic: %s', async (message) => {
  const { service, github } = setup()
  github.mockRejectedValue(new Error(message))
  await expect(
    service.request('repo', 'options', {
      area: 'issues',
    }),
  ).rejects.toThrow(message)
})

it('serves a stale entry at once, refreshes it once behind the response and shares in-flight loads', async () => {
  const { service, db } = setup()
  let release: (value: { items: never[]; next: undefined }) => void = () => {}
  const load = vi
    .spyOn(GitForgeWork.prototype, 'issues')
    .mockImplementation(() => new Promise((resolve) => (release = resolve)))
  const first = service.request('repo', 'issues/list', {})
  const second = service.request('repo', 'issues/list', {})
  await new Promise((resolve) => setImmediate(resolve))
  expect(load).toHaveBeenCalledTimes(1)
  release({ items: [], next: undefined })
  await Promise.all([first, second])
  db.prepare('UPDATE forge_work_cache SET updated=?').run(Date.now() - 60_000)
  load.mockResolvedValue({ items: [], next: undefined })
  const served = await service.request('repo', 'issues/list', {})
  expect(served).toMatchObject({ stale: true })
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(await service.request('repo', 'issues/list', {})).not.toMatchObject({ stale: true })
  expect(load).toHaveBeenCalledTimes(2)
})

it('caches pipeline sections independently and rejects a persisted section from an earlier attempt', async () => {
  const { service, db } = setup()
  let attempt = 1
  const load = vi
    .spyOn(GitForgeWork.prototype, 'pipeline')
    .mockImplementation(async (_id, _cursor, section) => ({
      run: {
        id: '42',
        title: 'Build',
        url: 'https://github.com/me/app/actions/runs/42',
        status: 'success',
        sha: 'a'.repeat(40),
        ref: 'main',
        actor: 'me',
        createdAt: '',
        updatedAt: '',
        attempt,
      },
      jobs:
        section === 'jobs'
          ? [
              {
                id: 'job',
                name: `Attempt ${attempt}`,
                status: 'success',
                url: 'https://github.com/me/app/actions/runs/42',
              },
            ]
          : [],
      graph:
        section === 'graph' ? [{ id: 'build', name: 'Build', needs: [], jobIds: [] }] : undefined,
    }))
  for (const section of ['overview', 'jobs', 'graph']) {
    await service.request('repo', 'pipelines/detail', { id: '42', section })
    await service.request('repo', 'pipelines/detail', { id: '42', section })
  }
  expect(load).toHaveBeenCalledTimes(3)
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 3 })
  attempt = 2
  await expect(
    service.request('repo', 'pipelines/detail', {
      id: '42',
      section: 'jobs',
      revision: JSON.stringify(['a'.repeat(40), 2]),
    }),
  ).resolves.toMatchObject({ run: { attempt: 2 }, jobs: [{ name: 'Attempt 2' }] })
  expect(load).toHaveBeenCalledTimes(4)
})

it('shows background refresh errors, backs off failed reads and allows an explicit retry', async () => {
  const { service, db } = setup()
  const load = vi
    .spyOn(GitForgeWork.prototype, 'issues')
    .mockResolvedValue({ items: [], next: undefined })
  await service.request('repo', 'issues/list', {})
  db.prepare('UPDATE forge_work_cache SET updated=?').run(Date.now() - 60_000)
  load.mockRejectedValue(new Error('Provider unavailable'))
  await expect(service.request('repo', 'issues/list', {})).resolves.toMatchObject({ stale: true })
  await vi.waitFor(async () =>
    expect(await service.request('repo', 'issues/list', {})).toMatchObject({
      stale: true,
      refreshError: 'Provider unavailable',
    }),
  )
  expect(load).toHaveBeenCalledTimes(2)
  await service.request('repo', 'issues/list', {})
  expect(load).toHaveBeenCalledTimes(2)
  load.mockResolvedValue({ items: [], next: undefined })
  expect(await service.request('repo', 'issues/list', { refresh: true })).not.toHaveProperty(
    'refreshError',
  )
  expect(load).toHaveBeenCalledTimes(3)
})

it('backs off uncached failures without delaying an explicit retry', async () => {
  const { service } = setup()
  const load = vi
    .spyOn(GitForgeWork.prototype, 'issues')
    .mockRejectedValue(new Error('Rate limited'))
  await expect(service.request('repo', 'issues/list', {})).rejects.toThrow('Rate limited')
  await expect(service.request('repo', 'issues/list', {})).rejects.toThrow('Rate limited')
  expect(load).toHaveBeenCalledTimes(1)
  load.mockResolvedValue({ items: [], next: undefined })
  await service.request('repo', 'issues/list', { refresh: true })
  expect(load).toHaveBeenCalledTimes(2)
})

it('starts a fresh post-write read while the pre-write read is still pending', async () => {
  const { db, service } = setup()
  let release: (value: Awaited<ReturnType<GitForgeWork['issues']>>) => void = () => {
    throw new Error('Read not started')
  }
  const load = vi
    .spyOn(GitForgeWork.prototype, 'issues')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    .mockResolvedValue({ items: [], next: undefined })
  vi.spyOn(GitForgeWork.prototype, 'createIssue').mockResolvedValue({
    id: '2',
    url: 'https://github.com/me/app/issues/2',
    message: 'Created',
  })
  const before = service.request('repo', 'issues/list', {})
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  await service.request('repo', 'issues/create', { title: 'New issue', body: '' })
  await service.request('repo', 'issues/list', {})
  expect(load).toHaveBeenCalledTimes(2)
  release({ items: [], next: undefined })
  await expect(before).resolves.toMatchObject({ stale: true })
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 1 })
})

it('reserves GitHub quota for automatic pipeline reads while explicit refreshes stay interactive', async () => {
  const { service, git } = setup()
  const api = vi.spyOn(git, 'githubAccount')
  api.mockImplementation(async (args) =>
    args.includes('user')
      ? JSON.stringify({ id: 1, login: 'fixture-account' })
      : JSON.stringify({ workflow_runs: [] }),
  )
  await service.request('repo', 'pipelines/list', {})
  const background = api.mock.calls.find(([args]) =>
    args.some((arg) => arg.includes('actions/runs')),
  )
  expect(background?.[4]).toBe(true)
  api.mockClear()
  await service.request('repo', 'pipelines/list', { refresh: true })
  expect(
    api.mock.calls.find(([args]) => args.some((arg) => arg.includes('actions/runs')))?.[4],
  ).toBe(false)
  api.mockClear()
  await service.request('repo', 'pipelines/list', { refresh: true }, true)
  expect(
    api.mock.calls.find(([args]) => args.some((arg) => arg.includes('actions/runs')))?.[4],
  ).toBe(true)
})

it('isolates PR commit and page reads from unfiltered repository pipelines', async () => {
  const { service } = setup()
  const load = vi
    .spyOn(GitForgeWork.prototype, 'pipelines')
    .mockResolvedValue({ items: [], next: undefined })
  const sha = 'a'.repeat(40)
  await service.request('repo', 'pipelines/list', {})
  await service.request('repo', 'pipelines/list', { sha })
  await service.request('repo', 'pipelines/list', { sha: 'b'.repeat(64) })
  await service.request('repo', 'pipelines/list', { sha, cursor: '2' })
  await service.request('repo', 'pipelines/list', { sha: sha.toUpperCase() })
  expect(load).toHaveBeenCalledTimes(4)
  expect(load).toHaveBeenNthCalledWith(1, undefined, undefined)
  expect(load).toHaveBeenNthCalledWith(2, undefined, sha)
  expect(load).toHaveBeenNthCalledWith(3, undefined, 'b'.repeat(64))
  expect(load).toHaveBeenNthCalledWith(4, '2', sha)
})

it('rejects commit filters on operations that cannot honor them', async () => {
  const { service } = setup()
  const load = vi.spyOn(GitForgeWork.prototype, 'issues')
  await expect(service.request('repo', 'issues/list', { sha: 'a'.repeat(40) })).rejects.toThrow(
    'only supported for pipeline lists',
  )
  expect(load).not.toHaveBeenCalled()
})
