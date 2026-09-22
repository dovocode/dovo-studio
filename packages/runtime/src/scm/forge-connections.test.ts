/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ForgeConnections } from './forge-connections'
import { openDatabase } from '../storage/database'
import { startRuntime } from '../index'

const db = openDatabase(':memory:')
afterEach(() => {
  db.prepare('DELETE FROM forge_connections').run()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const store = new ForgeConnections(db)
const input = {
  name: 'Forge',
  provider: 'forgejo',
  baseUrl: 'https://forge.example/team/',
  credential: 'token',
  token: 'secret-value',
}
it('keeps credentials outside public connection metadata and preserves them only for the same account', () => {
  const saved = store.save(input)
  expect(saved.baseUrl).toBe('https://forge.example/team')
  expect(JSON.stringify(store.list())).not.toContain('secret-value')
  expect(store.secret(saved.id)).toBe('secret-value')
  const edited = store.save({ ...saved, name: 'Renamed' })
  expect(edited.revision).not.toBe(saved.revision)
  expect(store.secret(saved.id)).toBe('secret-value')
  expect(() => store.save({ ...saved, baseUrl: 'https://other.example' })).toThrow(
    'Enter an API token',
  )
  expect(store.get(saved.id).baseUrl).toBe(saved.baseUrl)
})
it('scopes Git authorization to the configured instance and rejects credential-bearing remotes', () => {
  const saved = store.save(input)
  expect(store.gitAuthorization(saved.id, 'https://forge.example/team/owner/repo.git')).toMatch(
    /^Basic /,
  )
  for (const url of [
    'https://other.example/repo.git',
    'https://forge.example/team-other/repo.git',
    'https://token@forge.example/team/repo.git',
  ])
    expect(() => store.gitAuthorization(saved.id, url)).toThrow(
      'outside this source control connection',
    )
  const bb = store.save({
    name: 'Bitbucket',
    provider: 'bitbucket',
    baseUrl: 'https://api.bitbucket.org/2.0',
    credential: 'token',
    username: 'me@example.com',
    token: 'bb-secret',
  })
  expect(store.gitAuthorization(bb.id, 'https://bitbucket.org/team/repo.git')).toBe(
    `Basic ${Buffer.from('x-bitbucket-api-token-auth:bb-secret').toString('base64')}`,
  )
  expect(store.authorization(bb.id)).toBe(
    `Basic ${Buffer.from('me@example.com:bb-secret').toString('base64')}`,
  )
  expect(() => store.gitAuthorization(bb.id, 'https://api.bitbucket.org/2.0/repo.git')).toThrow(
    'outside this source control connection',
  )
})
it('uses environment references without persisting their values and handles missing credentials explicitly', () => {
  const saved = store.save({
    ...input,
    credential: 'environment',
    token: undefined,
    tokenEnv: 'DOVO_TEST_FORGE_TOKEN',
  })
  expect(() => store.secret(saved.id)).toThrow('Set DOVO_TEST_FORGE_TOKEN')
  process.env.DOVO_TEST_FORGE_TOKEN = 'environment-secret'
  try {
    expect(store.secret(saved.id)).toBe('environment-secret')
    expect(JSON.stringify(db.prepare('SELECT * FROM forge_connections').all())).not.toContain(
      'environment-secret',
    )
  } finally {
    delete process.env.DOVO_TEST_FORGE_TOKEN
  }
})
it('rejects unsupported hosted API variants instead of applying Cloud payloads to a different protocol', () => {
  expect(() =>
    store.save({
      ...input,
      provider: 'bitbucket',
      username: 'me@example.com',
      baseUrl: 'https://bitbucket.internal',
    }),
  ).toThrow('Data Center')
  expect(() =>
    store.save({
      ...input,
      provider: 'azure-devops',
      baseUrl: 'https://azure.internal/collection',
    }),
  ).toThrow('Services')
  expect(() => store.save({ ...input, provider: 'github' })).toThrow('GitHub CLI')
  for (const baseUrl of ['http://dev.azure.com/org', 'https://dev.azure.com:444/org'])
    expect(() => store.save({ ...input, provider: 'azure-devops', baseUrl })).toThrow('Services')
})

it('rejects GitHub URL components the CLI host adapter cannot represent', () => {
  const github = { ...input, provider: 'github', credential: 'gh', token: undefined }
  for (const baseUrl of [
    'http://github.example.com',
    'https://github.example.com:444',
    'https://github.example.com/git',
    'https://github.example.com/api/v3',
  ])
    expect(() => store.save({ ...github, baseUrl })).toThrow('HTTPS GitHub hostname')
  for (const baseUrl of ['https://github.com', 'https://github.example.com/'])
    expect(store.save({ ...github, baseUrl }).baseUrl).toBe(baseUrl.replace(/\/$/, ''))
})

it('migrates legacy environment connections once and keeps fingerprints private', () => {
  vi.stubEnv('DOVO_TEST_FORGE_TOKEN', 'first-private-account')
  const saved = store.save({
    ...input,
    credential: 'environment',
    token: undefined,
    tokenEnv: 'DOVO_TEST_FORGE_TOKEN',
  })
  // A pre-fingerprint installation cannot establish which account produced its old cache.
  db.prepare('UPDATE forge_connections SET value=? WHERE id=?').run(JSON.stringify(saved), saved.id)
  const onRevision = vi.fn<(id: string, revision: string) => void>()
  const reopened = new ForgeConnections(db, onRevision)
  const migrated = reopened.get(saved.id)
  expect(migrated.revision).not.toBe(saved.revision)
  expect(onRevision).toHaveBeenCalledExactlyOnceWith(saved.id, migrated.revision)
  expect(reopened.list()[0].revision).toBe(migrated.revision)
  expect(onRevision).toHaveBeenCalledTimes(1)
  const metadata = JSON.stringify(reopened.list())
  expect(metadata).not.toContain('first-private-account')
  expect(metadata).not.toContain('environmentFingerprint')
  expect(JSON.stringify(db.prepare('SELECT value FROM forge_connections').all())).not.toContain(
    'first-private-account',
  )
})

it('rotates persisted and client cache identities before startup snapshots, including missing and restored tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-forge-rotation-'))
  const options = {
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: 'forge-rotation-test-owner-token-with-32-characters',
    port: 0,
  }
  let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined
  vi.stubEnv('DOVO_TEST_FORGE_TOKEN', 'first-private-account')
  try {
    runtime = await startRuntime(options)
    const first = runtime.services
    const connection = first.forges.save({
      ...input,
      credential: 'environment',
      token: undefined,
      tokenEnv: 'DOVO_TEST_FORGE_TOKEN',
    })
    first.store.update((workspace) => ({
      ...workspace,
      repositories: [
        {
          id: 'repo',
          name: 'Repository',
          path: '/fixture/repository',
          branch: 'main',
          forge: {
            connectionId: connection.id,
            repository: 'owner/repository',
            revision: connection.revision,
          },
        },
      ],
    }))
    const oldIdentity = await first.pulls.identity('/fixture/repository')
    vi.spyOn(first.pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
    expect((await first.pullCache.list('/fixture/repository', 'open', 1)).cachedAt).toBeDefined()
    await runtime.close()
    runtime = undefined

    vi.stubEnv('DOVO_TEST_FORGE_TOKEN', 'second-private-account')
    runtime = await startRuntime(options)
    const second = runtime.services
    // Inspect the snapshot first: no provider request should be needed to invalidate client caches.
    const revised = second.store.get().repositories[0].forge!.revision
    expect(revised).not.toBe(connection.revision)
    expect(second.forges.get(connection.id).revision).toBe(revised)
    expect(await second.pulls.identity('/fixture/repository')).not.toBe(oldIdentity)
    vi.spyOn(second.pulls, 'list').mockRejectedValue(new Error('Provider offline'))
    await expect(second.pullCache.list('/fixture/repository', 'open', 1)).rejects.toThrow(
      'Provider offline',
    )

    vi.stubEnv('DOVO_TEST_FORGE_TOKEN', undefined)
    const missing = second.forges.get(connection.id).revision
    expect(missing).not.toBe(revised)
    expect(second.store.get().repositories[0].forge!.revision).toBe(missing)
    expect(() => second.forges.secret(connection.id)).toThrow('Set DOVO_TEST_FORGE_TOKEN')
    await expect(second.pullCache.list('/fixture/repository', 'open', 1)).rejects.toThrow(
      'Provider offline',
    )

    vi.stubEnv('DOVO_TEST_FORGE_TOKEN', 'first-private-account')
    const restored = second.forges.get(connection.id).revision
    expect(new Set([connection.revision, revised, missing, restored]).size).toBe(4)
    expect(second.store.get().repositories[0].forge!.revision).toBe(restored)
    expect(await second.pulls.identity('/fixture/repository')).not.toBe(oldIdentity)
    await expect(second.pullCache.list('/fixture/repository', 'open', 1)).rejects.toThrow(
      'Provider offline',
    )
    const publicData = JSON.stringify({
      connections: second.forges.list(),
      workspace: second.store.get(),
      activity: second.db.prepare('SELECT payload FROM activity').all(),
      cache: second.db.prepare('SELECT value FROM pull_cache').all(),
    })
    for (const privateValue of [
      'first-private-account',
      'second-private-account',
      'environmentFingerprint',
    ])
      expect(publicData).not.toContain(privateValue)
  } finally {
    await runtime?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
