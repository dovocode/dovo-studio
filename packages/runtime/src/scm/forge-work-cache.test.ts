import { afterEach, expect, it, vi } from 'vitest'
import { commandsSchema } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { GitService } from './git'
import { ForgeConnections } from './forge-connections'
import { ForgePullRequests } from './forge-pulls'
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
    repositories: [{ id: 'repo', name: 'Repo', path: '/repo', branch: 'main' }],
  }))
  const git = new GitService()
  const github = vi
    .spyOn(git, 'github')
    .mockResolvedValue(
      JSON.stringify({ nameWithOwner: 'me/app', url: 'https://github.com/me/app' }),
    )
  const connections = new ForgeConnections(db)
  const pulls = new ForgePullRequests(git, connections, store)
  vi.spyOn(pulls, 'identity').mockResolvedValue('fixture-account')
  const service = new ForgeWork(db, store, git, connections, pulls, () => commandsSchema.parse({}))
  return { db, service, connections, pulls, git, github }
}
it('replaces invalid persisted cache entries instead of blocking issue loading', async () => {
  const { db, service } = setup()
  const load = vi
    .spyOn(GitForgeWork.prototype, 'issues')
    .mockResolvedValue({ items: [], next: undefined })
  await service.request('repo', 'issues/list', {})
  db.prepare('UPDATE forge_work_cache SET value=?').run('{broken')
  await expect(service.request('repo', 'issues/list', {})).resolves.toMatchObject({ items: [] })
  expect(load).toHaveBeenCalledTimes(2)
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 1 })
})
it('isolates search results by query and reuses a repeated search', async () => {
  const { service } = setup()
  const load = vi
    .spyOn(GitForgeWork.prototype, 'issues')
    .mockResolvedValue({ items: [], next: undefined })
  await service.request('repo', 'issues/list', { query: 'login' })
  await service.request('repo', 'issues/list', { query: 'logout' })
  await service.request('repo', 'issues/list', { query: ' login ' })
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
  connections.save({ ...connection, cliProfile: 'second-user' })
  await expect(
    adapter.create({ title: 'Draft', body: '', head: 'feature', base: 'main', draft: true }),
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
  await service.request('repo', 'issues/create', { title: 'New issue', body: '' })
  resolveRead({ items: [], next: undefined })
  await expect(reading).resolves.toMatchObject({ stale: true })
  expect(db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 0 })
})

it('treats local repositories with no remote as empty issue sources', async () => {
  const { service, github } = setup()
  github.mockRejectedValue(
    Object.assign(
      new Error('Command failed: gh repo view --json nameWithOwner,url\nno git remotes found\n'),
      { stderr: 'no git remotes found\n' },
    ),
  )
  await expect(service.request('repo', 'options', { area: 'issues' })).resolves.toMatchObject({
    issues: false,
    pipelines: false,
  })
  expect(await service.request('repo', 'options', { area: 'issues' })).not.toHaveProperty(
    'issueNotice',
  )
  await expect(service.request('repo', 'issues/list', {})).resolves.toEqual({ items: [] })
  await expect(service.request('repo', 'pipelines/list', {})).resolves.toEqual({ items: [] })
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
  await expect(service.request('repo', 'options', { area: 'issues' })).rejects.toThrow(message)
})
