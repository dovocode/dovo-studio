import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { randomBytes } from 'node:crypto'
import { listDirectories } from './directories.js'
import { listGithubRepositories } from './github-repositories.js'
import { GitService } from './git.js'
import { startRuntime } from '../index.js'
import { addRepositorySchema, directoryPageSchema } from '@dovo/protocol'
import { repositoryPath } from './paths.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'dovo-picker-test-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return realpath(path)
}

it('browses only folders, supports hidden folders and symlinks, and resolves parent navigation', async () => {
  const path = await directory()
  await Promise.all(['project', '.hidden', '.git'].map((name) => mkdir(join(path, name))))
  await writeFile(join(path, 'file.txt'), 'not a folder')
  await symlink(join(path, 'project'), join(path, 'linked'))
  await symlink(join(path, 'missing'), join(path, 'broken'))
  const result = await listDirectories({ path })
  expect(result.path).toBe(path)
  expect(result.home).toBe(homedir())
  expect(result.total).toBe(2)
  expect(result.breadcrumbs?.[0]).toEqual({ name: parse(path).root, path: parse(path).root })
  expect(result.breadcrumbs?.at(-1)?.path).toBe(path)
  expect(
    result.breadcrumbs
      ?.slice(1)
      .every((crumb, index) => dirname(crumb.path) === result.breadcrumbs?.[index]?.path),
  ).toBe(true)
  expect(result.entries.map((entry) => entry.name)).toEqual(['linked', 'project'])
  expect(
    (await listDirectories({ path, hidden: true })).entries.map((entry) => entry.name),
  ).toEqual(['.hidden', 'linked', 'project'])
  const nested = await listDirectories({ path: join(path, 'linked') })
  expect(nested.path).toBe(join(path, 'project'))
  expect(nested.parent).toBe(path)
  expect(nested.entries).toEqual([])
  expect(nested.breadcrumbs?.at(-1)).toEqual({ name: 'project', path: join(path, 'project') })
  expect((await listDirectories({ path: parse(path).root })).parent).toBeNull()
})

it('paginates directories without truncating and filters across all pages', async () => {
  const path = await directory()
  await Promise.all(
    Array.from({ length: 105 }, (_, index) =>
      mkdir(join(path, `project-${String(index).padStart(3, '0')}`)),
    ),
  )
  const first = await listDirectories({ path })
  expect(first.entries).toHaveLength(100)
  expect(first.nextOffset).toBe(100)
  expect(first.total).toBe(105)
  const last = await listDirectories({ path, offset: first.nextOffset })
  expect(last.entries).toHaveLength(5)
  expect(last.nextOffset).toBeNull()
  expect(last.total).toBe(105)
  expect(new Set([...first.entries, ...last.entries].map((entry) => entry.path)).size).toBe(105)
  expect((await listDirectories({ path, query: 'PROJECT-104' })).entries).toEqual([
    { name: 'project-104', path: join(path, 'project-104') },
  ])
  expect((await listDirectories({ path, query: 'PROJECT-104' })).total).toBe(1)
})

it('sorts folder numbers naturally and breaks equivalent-name ties consistently', async () => {
  const path = await directory()
  await Promise.all(
    ['folder-10', 'folder-2', 'folder-1', 'folder-01'].map((name) => mkdir(join(path, name))),
  )
  const page = await listDirectories({ path })
  expect(page.entries.map((entry) => entry.name)).toEqual([
    'folder-01',
    'folder-1',
    'folder-2',
    'folder-10',
  ])
})

it('ignores directory links whose targets pass through a file', async () => {
  const path = await directory()
  await mkdir(join(path, 'project'))
  await writeFile(join(path, 'file'), 'not a directory')
  await symlink(join(path, 'file', 'child'), join(path, 'broken'))
  expect((await listDirectories({ path })).entries).toEqual([
    { name: 'project', path: join(path, 'project') },
  ])
})

it('preserves folder whitespace through browsing and project registration input', async () => {
  const path = await directory()
  const spaced = join(path, 'project ')
  await mkdir(spaced)
  const page = await listDirectories({ path })
  expect(page.entries[0]?.path).toBe(spaced)
  expect((await listDirectories({ path: page.entries[0]?.path })).path).toBe(spaced)
  expect(
    addRepositorySchema.parse({ source: 'local', name: 'Project', path: spaced }),
  ).toMatchObject({ path: spaced })
  expect(
    addRepositorySchema.parse({
      source: 'github',
      name: 'Project',
      repository: 'me/app',
      directory: spaced,
    }),
  ).toMatchObject({ directory: spaced })
})

it('resolves home shorthand consistently for browsing and project paths', async () => {
  const home = await realpath(homedir())
  expect(await repositoryPath('~')).toBe(home)
  expect(await repositoryPath('~/')).toBe(home)
  expect(
    (await listDirectories({ path: '~', query: 'dovo-no-such-home-folder-fixture' })).path,
  ).toBe(home)
})

it('accepts legacy directory responses without navigation metadata', () => {
  const page = directoryPageSchema.parse({
    path: '/repo',
    parent: '/',
    entries: [],
    nextOffset: null,
  })
  expect(page.home).toBeUndefined()
  expect(page.breadcrumbs).toBeUndefined()
  expect(page.total).toBeUndefined()
})

it('rejects invalid requests and exposes unreadable paths as actionable errors', async () => {
  const path = await directory()
  await writeFile(join(path, 'file'), 'not a folder')
  for (const invalid of [join(path, 'missing'), join(path, 'file')])
    await expect(listDirectories({ path: invalid })).rejects.toThrow(
      'Check the path and folder permissions',
    )
  await expect(listDirectories({ path: '\0' })).rejects.toThrow('Invalid path')
  await expect(listDirectories({ offset: -1 })).rejects.toThrow('offset')
  await expect(listDirectories({ path: false })).rejects.toThrow('path')
})

it('lists the host account and organization repositories without requiring a checkout', async () => {
  const git = new GitService()
  const api = vi
    .spyOn(git, 'githubAccount')
    .mockResolvedValue(
      JSON.stringify([
        { name: 'project', full_name: 'organization/project', description: null, private: true },
      ]),
    )
  expect(await listGithubRepositories(git, { page: 2 })).toEqual({
    repositories: [
      { name: 'project', fullName: 'organization/project', description: '', private: true },
    ],
    nextPage: null,
  })
  expect(api).toHaveBeenCalledWith([
    'api',
    '--hostname',
    'github.com',
    '--method',
    'GET',
    'user/repos',
    '-f',
    'affiliation=owner,collaborator,organization_member',
    '-f',
    'sort=full_name',
    '-f',
    'direction=asc',
    '-f',
    'per_page=100',
    '-f',
    'page=2',
  ])
  api.mockResolvedValue(
    JSON.stringify(
      Array.from({ length: 100 }, (_, index) => ({
        name: `repo-${index}`,
        full_name: `owner/repo-${index}`,
        description: '',
        private: false,
      })),
    ),
  )
  expect((await listGithubRepositories(git, { page: 1 })).nextPage).toBe(2)
  api.mockResolvedValue('[]')
  expect(await listGithubRepositories(git, { page: 2 })).toEqual({
    repositories: [],
    nextPage: null,
  })
})

it('handles missing GitHub authentication and rejects malformed responses and page injection', async () => {
  const git = new GitService()
  const api = vi.spyOn(git, 'githubAccount').mockRejectedValue(new Error('not logged in'))
  await expect(listGithubRepositories(git, {})).rejects.toThrow(
    'gh auth login --hostname github.com',
  )
  api.mockResolvedValue('{"token":"must not return raw responses"}')
  await expect(listGithubRepositories(git, {})).rejects.toThrow(
    'Could not list GitHub repositories',
  )
  api.mockClear()
  await expect(listGithubRepositories(git, { page: '1; echo bad' })).rejects.toThrow('page')
  expect(api).not.toHaveBeenCalled()
})

it('requires authentication for both read-only pickers and never registers selections', async () => {
  const path = await directory()
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const api = vi.spyOn(runtime.services.git, 'githubAccount').mockResolvedValue('[]')
  const call = (endpoint: string, body: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const revision = runtime.services.store.version()
  for (const [endpoint, body] of [
    ['/api/scm/directories/read', { path }],
    ['/api/scm/repositories/github/read', {}],
  ] satisfies Array<[string, unknown]>) {
    expect((await call(endpoint, body, 'invalid')).status).toBe(401)
    expect((await call(endpoint, body)).status).toBe(200)
  }
  expect(api).toHaveBeenCalledTimes(1)
  expect(runtime.services.store.version()).toBe(revision)
  expect(runtime.services.store.get().repositories).toEqual([])
})
