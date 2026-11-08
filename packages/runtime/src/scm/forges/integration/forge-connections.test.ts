/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ForgeConnections } from './forge-connections'
import { ForgeCliAccounts } from './forge-cli-accounts'
import { SecretReferences } from '../../../agents/configuration/secret-references'
import { commandsSchema, decode } from '@dovo/protocol'
import { openDatabase } from '../../../storage/database'
import { WorkspaceStore } from '../../../storage/workspace'
import { startRuntime } from '../../../index'

const db = openDatabase(':memory:')
afterEach(() => {
  db.prepare('DELETE FROM forge_connections').run()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
  expect(() => store.save({ ...saved, name: 'Stale edit' })).toThrow(
    'Source control connection changed on another device',
  )
  expect(store.get(saved.id).name).toBe('Renamed')
  expect(() => store.save({ ...edited, baseUrl: 'https://other.example' })).toThrow(
    'Enter an API token',
  )
  expect(store.get(saved.id).baseUrl).toBe(saved.baseUrl)
})
it('rejects removal of a connection changed on another device', () => {
  const saved = store.save(input)
  store.save({ ...saved, name: 'Updated name' })
  expect(() => store.remove(saved.id, saved.revision)).toThrow(
    'source control connection changed on another device',
  )
  expect(store.get(saved.id).name).toBe('Updated name')
  store.remove(saved.id, store.get(saved.id).revision)
  expect(store.list()).toEqual([])
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
  expect(
    store.save({ ...input, provider: 'github', baseUrl: 'https://github.com' }).credential,
  ).toBe('token')
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
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ id: 17, login: 'fixture-account' })),
  )
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
    vi.spyOn(first.pulls, 'list').mockResolvedValue({
      pulls: [],
      page: 1,
      hasMore: false,
      destination: oldIdentity,
    })
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
      'Set DOVO_TEST_FORGE_TOKEN',
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
it('reuses a CLI credential briefly and asks the CLI again after the server rejects it', async () => {
  const cliDb = openDatabase(':memory:')
  try {
    const authorization = vi
      .fn<(...args: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce('Bearer first')
      .mockResolvedValueOnce('Bearer second')
    const connections = new ForgeConnections(cliDb, undefined, {
      authorization,
    } as unknown as ConstructorParameters<typeof ForgeConnections>[2])
    cliDb.prepare('INSERT INTO forge_connections VALUES (?, ?)').run(
      'az',
      JSON.stringify({
        id: 'az',
        name: 'Azure',
        provider: 'azure-devops',
        baseUrl: 'https://dev.azure.com/org',
        credential: 'cli',
        revision: '1',
      }),
    )
    const [first, second] = await Promise.all([
      connections.authorization('az'),
      connections.authorization('az'),
    ])
    expect([first, second, await connections.authorization('az')]).toEqual([
      'Bearer first',
      'Bearer first',
      'Bearer first',
    ])
    expect(authorization).toHaveBeenCalledTimes(1)
    connections.forgetCredentials('az')
    expect(await connections.authorization('az')).toBe('Bearer second')
    expect(authorization).toHaveBeenCalledTimes(2)
  } finally {
    cliDb.close()
  }
})
it('skips an unreadable stored connection instead of failing every read', () => {
  const badDb = openDatabase(':memory:')
  try {
    const connections = new ForgeConnections(badDb)
    const saved = connections.save(input)
    badDb.prepare('INSERT INTO forge_connections VALUES (?, ?)').run('broken', '{not json')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(new ForgeConnections(badDb).list().map((item) => item.id)).toEqual([saved.id])
    expect(error).toHaveBeenCalledOnce()
  } finally {
    badDb.close()
  }
})

it('rolls back the workspace projection with a failed enclosing forge revision update', () => {
  vi.stubEnv('DOVO_TEST_FORGE_TOKEN', 'original-account')
  const workspace = new WorkspaceStore(db)
  let fail = false
  const connections = new ForgeConnections(
    db,
    (_id, revision) => {
      workspace.update((current) => ({ ...current, runtimeAddress: revision }))
      if (fail) db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', 'duplicate')
    },
    undefined,
    (fn) => workspace.transaction(fn),
  )
  const saved = connections.save({
    ...input,
    credential: 'environment',
    token: undefined,
    tokenEnv: 'DOVO_TEST_FORGE_TOKEN',
  })
  const before = workspace.get()
  const projected = workspace.publicWorkspace()
  const revision = workspace.version()
  const connection = db.prepare('SELECT value FROM forge_connections WHERE id=?').get(saved.id)
  fail = true
  vi.stubEnv('DOVO_TEST_FORGE_TOKEN', 'changed-account')
  expect(() => connections.get(saved.id)).toThrow(/UNIQUE constraint/)
  expect(workspace.get()).toBe(before)
  expect(workspace.publicWorkspace()).toBe(projected)
  expect(workspace.version()).toBe(revision)
  expect(db.prepare('SELECT value FROM forge_connections WHERE id=?').get(saved.id)).toEqual(
    connection,
  )
  expect(new WorkspaceStore(db).get()).toEqual(before)
})

it('uses GitHub token environment connections for both API and Git credentials, including rotation', async () => {
  vi.stubEnv('DOVO_GITHUB_WORK_TOKEN', 'work-secret')
  const account = store.save({
    name: 'Work',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'environment',
    tokenEnv: 'DOVO_GITHUB_WORK_TOKEN',
  })
  expect(await store.githubToken(account.id)).toBe('work-secret')
  expect(await store.gitAuthorization(account.id, 'https://github.com/team/project.git')).toBe(
    `Basic ${Buffer.from('x-access-token:work-secret').toString('base64')}`,
  )
  vi.stubEnv('DOVO_GITHUB_WORK_TOKEN', 'replacement-secret')
  expect(await store.githubToken(account.id)).toBe('replacement-secret')
  expect(store.get(account.id).revision).not.toBe(account.revision)
  expect(JSON.stringify(store.list())).not.toMatch(/work-secret|replacement-secret/)
})

it('reuses a CLI account lookup across reads and forgets it when a server rejects it', async () => {
  const identity = vi.fn<() => Promise<string>>(async () => 'account-one')
  const cli = { identity } as unknown as NonNullable<
    ConstructorParameters<typeof ForgeConnections>[2]
  >
  const connections = new ForgeConnections(db, undefined, cli)
  const saved = connections.save({
    name: 'Work',
    provider: 'gitea',
    baseUrl: 'https://gitea.example',
    credential: 'cli',
    cliTool: 'tea',
    cliProfile: 'main',
  })
  await connections.reconcileCli(saved.id, '/repo')
  await connections.reconcileCli(saved.id, '/repo')
  expect(identity).toHaveBeenCalledTimes(1)
  await connections.reconcileCli(saved.id, '/other')
  expect(identity).toHaveBeenCalledTimes(2)
  connections.forgetCredentials(saved.id)
  await connections.reconcileCli(saved.id, '/repo')
  expect(identity).toHaveBeenCalledTimes(3)
})

it('rejects only the selected credential generation dispatched before a newer login', async () => {
  const cli = new ForgeCliAccounts(() => decode(commandsSchema, {}))
  const lookup = vi
    .spyOn(cli, 'githubToken')
    .mockResolvedValueOnce('old-token')
    .mockResolvedValueOnce('fresh-token')
    .mockResolvedValue('next-token')
  vi.spyOn(cli, 'githubCredentialSource').mockReturnValue('stable-source')
  const connections = new ForgeConnections(db, undefined, cli)
  const saved = connections.save({
    name: 'Selected',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh',
    cliProfile: 'viewer',
  })
  const old = await connections.githubCredential(saved.id, '/repo')
  connections.forgetCredentials(saved.id)
  const fresh = await connections.githubCredential(saved.id, '/repo')
  old.onUnauthorized()
  expect(await connections.githubToken(saved.id, '/repo')).toBe('fresh-token')
  expect(lookup).toHaveBeenCalledTimes(2)
  fresh.onUnauthorized()
  expect(await connections.githubToken(saved.id, '/repo')).toBe('next-token')
  expect(lookup).toHaveBeenCalledTimes(3)
})

describe('Bitbucket secret manager references', () => {
  const reference = { provider: 'onepassword', reference: 'op://Work/Bitbucket/token' } as const
  const bitbucket = {
    name: 'Bitbucket',
    provider: 'bitbucket',
    baseUrl: 'https://api.bitbucket.org/2.0',
    credential: 'reference',
    username: 'me@example.com',
    secret: reference,
  }
  const basic = (user: string, token: string) =>
    `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
  const vault = (read: (args: string[], signal: AbortSignal) => Promise<string>) => {
    const command = vi.fn<
      (command: string, args: string[], signal: AbortSignal) => Promise<string>
    >((_command, args, signal) => read(args, signal))
    return { command, secrets: new SecretReferences(() => ({}), command) }
  }

  it('keeps the reference host-private and resolves it for API and Git requests only', async () => {
    const { command, secrets } = vault(async () => 'vault-token')
    const connections = new ForgeConnections(db, undefined, undefined, undefined, secrets)
    const saved = connections.save(bitbucket)
    expect(saved).toMatchObject({ credential: 'reference', secretProvider: 'onepassword' })
    const published = JSON.stringify(connections.list())
    expect(published).not.toContain('op://')
    expect(published).not.toContain('vault-token')
    expect(await connections.authorization(saved.id)).toBe(basic('me@example.com', 'vault-token'))
    expect(
      await connections.gitAuthorization(saved.id, 'https://bitbucket.org/team/repo.git'),
    ).toBe(basic('x-bitbucket-api-token-auth', 'vault-token'))
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]?.[0]).toBe('op')
    const stored = JSON.stringify(db.prepare('SELECT value FROM forge_connections').all())
    expect(stored).toContain('op://Work/Bitbucket/token')
    expect(stored).not.toContain('vault-token')
    // An edit keeps the saved reference for the same account and never accepts it elsewhere.
    expect(connections.save({ ...saved, name: 'Renamed' }).secretProvider).toBe('onepassword')
    expect(() =>
      connections.save({ ...connections.get(saved.id), username: 'other@example.com' }),
    ).toThrow('Enter a secret manager reference')
    expect(() =>
      connections.save({ ...bitbucket, provider: 'gitea', baseUrl: 'https://git.example.com' }),
    ).toThrow('Secret manager references are available for Bitbucket connections')
    await connections.dispose()
  })

  it('reads a rotated value after refresh and does not return a value read before it', async () => {
    let value = 'old-token'
    const reads: { resolve: (value: string) => void }[] = []
    const { command, secrets } = vault(
      () =>
        new Promise<string>((resolve) => {
          const current = value
          reads.push({ resolve: () => resolve(current) })
        }),
    )
    const connections = new ForgeConnections(db, undefined, undefined, undefined, secrets)
    const saved = connections.save(bitbucket)
    const first = connections.authorization(saved.id)
    await vi.waitFor(() => expect(reads).toHaveLength(1))
    value = 'rotated-token'
    connections.forgetCredentials(saved.id)
    reads[0]?.resolve('')
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[1]?.resolve('')
    expect(await first).toBe(basic('me@example.com', 'rotated-token'))
    // Cached until a rejection or explicit refresh, then the vault is read again.
    expect(await connections.authorization(saved.id)).toBe(basic('me@example.com', 'rotated-token'))
    expect(command).toHaveBeenCalledTimes(2)
    value = 'third-token'
    connections.forgetCredentials(saved.id)
    const third = connections.authorization(saved.id)
    await vi.waitFor(() => expect(reads).toHaveLength(3))
    reads[2]?.resolve('')
    expect(await third).toBe(basic('me@example.com', 'third-token'))
    await connections.dispose()
  })

  it('rejects a lookup whose connection changed and keeps provider output out of errors', async () => {
    let release: (value: string) => void = () => {}
    const { command, secrets } = vault(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )
    const connections = new ForgeConnections(db, undefined, undefined, undefined, secrets)
    const saved = connections.save(bitbucket)
    const pending = connections.authorization(saved.id)
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1))
    connections.save({
      ...saved,
      secret: { provider: 'bitwarden', reference: 'item-id' },
    })
    release('stale-token')
    await expect(pending).rejects.toThrow('This source control account changed')

    const failing = vault(async () => {
      throw new Error('op: leaked-token for op://Work/Bitbucket/token')
    })
    const broken = new ForgeConnections(db, undefined, undefined, undefined, failing.secrets)
    const current = broken.get(saved.id)
    const error = await Promise.resolve(broken.authorization(current.id)).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(Error)
    const message = error instanceof Error ? error.message : ''
    expect(message).toContain('Could not read this connection’s Bitwarden reference')
    expect(message).not.toContain('leaked-token')
    expect(message).not.toContain('item-id')
    // A failed lookup never falls back to another credential source.
    await expect(
      Promise.resolve(broken.gitAuthorization(current.id, 'https://bitbucket.org/team/repo.git')),
    ).rejects.toThrow('Could not read')
    await broken.dispose()
    await connections.dispose()
  })

  it('cancels a vault lookup with its caller', async () => {
    let aborted = false
    const { secrets } = vault(
      (_args, signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(signal.reason)
          })
        }),
    )
    const connections = new ForgeConnections(db, undefined, undefined, undefined, secrets)
    const saved = connections.save(bitbucket)
    const controller = new AbortController()
    const pending = Promise.resolve(
      connections.authorization(saved.id, false, undefined, controller.signal),
    )
    controller.abort(new Error('cancelled by caller'))
    await expect(pending).rejects.toThrow('cancelled by caller')
    await vi.waitFor(() => expect(aborted).toBe(true))
    await connections.dispose()
  })
})
