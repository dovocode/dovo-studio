import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { decode, studioExtensionsListSchema } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { HttpError } from '../errors.js'
import { openDatabase } from '../storage/database.js'
import { StudioExtensions } from './extensions.js'

it('isolates an unreadable manifest from other installed extensions and lets the user remove it', () => {
  const db = openDatabase(':memory:')
  const feedRead = vi.fn()
  const authorize = () => undefined
  try {
    const extensions = new StudioExtensions(
      db,
      { feedRead, marketplaceSources: vi.fn() },
      authorize,
    )
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='studio_extensions'").get(),
    ).toBeUndefined()
    for (const id of ['example.broken', 'example.healthy']) {
      extensions.command(
        {
          action: 'stage',
          expectedRevision: 0,
          manifest: { id, version: 1, name: id, contributions: [] },
        },
        authorize,
      )
      const entry = decode(
        studioExtensionsListSchema,
        extensions.command({ action: 'list' }, authorize),
      ).extensions.find((value) => value.id === id)
      expect(entry).toBeDefined()
      extensions.command({ action: 'install', id, expectedRevision: entry!.revision }, authorize)
    }
    db.prepare('UPDATE studio_extensions SET entry=? WHERE id=?').run('{', 'example.broken')
    const reopened = new StudioExtensions(db, { feedRead, marketplaceSources: vi.fn() }, authorize)
    const list = () =>
      decode(studioExtensionsListSchema, reopened.command({ action: 'list' }, authorize)).extensions
    expect(list()).toEqual([
      expect.objectContaining({
        id: 'example.broken',
        revision: 2,
        enabled: false,
        error: expect.any(String),
      }),
      expect.objectContaining({ id: 'example.healthy', revision: 4, enabled: true }),
    ])
    reopened.command({ action: 'remove', id: 'example.broken', expectedRevision: 2 }, authorize)
    expect(list().map((entry) => entry.id)).toEqual(['example.healthy'])
    expect(feedRead).not.toHaveBeenCalled()
  } finally {
    db.close()
  }
})

it('returns only the draft and installed manifests authored in the current thread', () => {
  const db = openDatabase(':memory:')
  const authorize = () => undefined
  const author = { taskId: 'author', readOnly: false }
  const reviewer = { taskId: 'reviewer', readOnly: true }
  const other = { taskId: 'other', readOnly: true }
  const manifest = {
    id: 'example',
    name: 'Installed',
    version: 1 as const,
    contributions: [],
  }
  const draft = { ...manifest, name: 'Proposed' }
  const read = { action: 'read' as const, id: manifest.id }
  try {
    const extensions = new StudioExtensions(
      db,
      { feedRead: vi.fn(), marketplaceSources: vi.fn() },
      authorize,
    )
    extensions.command({ action: 'stage', manifest, expectedRevision: 0 }, authorize, author)
    extensions.command({ action: 'install', id: manifest.id, expectedRevision: 1 }, authorize)
    extensions.command({ action: 'stage', manifest: draft, expectedRevision: 2 }, authorize, {
      ...reviewer,
      readOnly: false,
    })
    expect(extensions.command(read, authorize, author)).toMatchObject({
      installed: manifest,
      draft: undefined,
    })
    expect(extensions.command(read, authorize, reviewer)).toMatchObject({
      installed: undefined,
      draft,
    })
    expect(() => extensions.command(read, authorize, other)).toThrow('no manifest')
  } finally {
    db.close()
  }
})

it('rejects stale installs after draft deletion and stale calls after extension removal', async () => {
  const db = openDatabase(':memory:')
  const authorize = () => undefined
  const feedRead = vi.fn()
  const create = () =>
    new StudioExtensions(db, { feedRead, marketplaceSources: vi.fn() }, authorize)
  const id = 'example.delivery'
  const manifest = {
    id,
    name: 'Delivery',
    version: 1 as const,
    contributions: [
      {
        id: 'read',
        kind: 'tool' as const,
        title: 'Read',
        taskId: 'thread',
        server: 'ci',
        tool: 'read',
      },
    ],
  }
  const stage = { action: 'stage' as const, expectedRevision: 0, manifest }
  try {
    const registry = create()
    registry.command(stage, authorize)
    registry.command({ action: 'discard', id, expectedRevision: 1 }, authorize)

    const reopened = create()
    reopened.command({ ...stage, manifest: { ...manifest, name: 'Replacement' } }, authorize)
    expect(() =>
      reopened.command({ action: 'install', id, expectedRevision: 1 }, authorize),
    ).toThrow('Reload it before you continue')
    reopened.command({ action: 'install', id, expectedRevision: 2 }, authorize)
    reopened.command({ action: 'remove', id, expectedRevision: 3 }, authorize)
    reopened.command(stage, authorize)
    reopened.command({ action: 'install', id, expectedRevision: 4 }, authorize)
    await expect(
      reopened.command(
        { action: 'call', id, contributionId: 'read', expectedRevision: 3 },
        authorize,
      ),
    ).rejects.toThrow('Reload it before running the tool')
    expect(feedRead).not.toHaveBeenCalled()
  } finally {
    db.close()
  }
})

it('allows an agent to replace only its own pending draft', () => {
  const db = openDatabase(':memory:')
  const authorize = () => undefined
  const id = 'example.delivery'
  const first = { taskId: 'first', readOnly: false }
  const second = { taskId: 'second', readOnly: false }
  const manifest = { id, name: 'First draft', version: 1 as const, contributions: [] }
  const stage = { action: 'stage' as const, expectedRevision: 0, manifest }
  try {
    const registry = new StudioExtensions(
      db,
      { feedRead: vi.fn(), marketplaceSources: vi.fn() },
      authorize,
    )
    registry.command(stage, authorize, first)
    const update = { ...stage, expectedRevision: 1, manifest: { ...manifest, name: 'Update' } }
    expect(() => registry.command(update, authorize, second)).toThrow('another author')
    expect(registry.command({ action: 'read', id }, authorize, first)).toMatchObject({
      draft: manifest,
      revision: 1,
    })
    expect(registry.command(update, authorize, first)).toMatchObject({ staged: true, revision: 2 })
  } finally {
    db.close()
  }
})

it('starts the revision counter above entries written before the counter existed', () => {
  const db = openDatabase(':memory:')
  const authorize = () => undefined
  const legacy = {
    id: 'example.legacy',
    revision: 9,
    enabled: true,
    settings: {},
    canRollback: false,
    installed: { id: 'example.legacy', version: 1, name: 'Legacy', contributions: [] },
  }
  try {
    db.exec(
      'CREATE TABLE studio_extensions(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, entry TEXT NOT NULL)',
    )
    db.prepare('INSERT INTO studio_extensions VALUES(?,?,?)').run(
      legacy.id,
      legacy.revision,
      JSON.stringify({ extension: legacy }),
    )
    const registry = new StudioExtensions(
      db,
      { feedRead: vi.fn(), marketplaceSources: vi.fn() },
      authorize,
    )
    expect(
      registry.command(
        { action: 'disable', id: legacy.id, expectedRevision: legacy.revision },
        authorize,
      ),
    ).toMatchObject({
      extension: { id: legacy.id, revision: 10, enabled: false, installed: legacy.installed },
    })
  } finally {
    db.close()
  }
})

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An API origin that holds each response until the test releases it. */
async function heldOrigin() {
  const pending: ServerResponse[] = []
  const http = createServer((_request, response) => {
    pending.push(response)
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections()
        http.close(() => resolve())
      }),
  )
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    pending,
    release: () => {
      for (const response of pending.splice(0)) response.end('{"value":7}')
    },
  }
}

async function dataExtension() {
  const origin = await heldOrigin()
  const db = openDatabase(':memory:')
  cleanups.push(() => {
    db.close()
  })
  const authorize = () => undefined
  const feedRead = vi.fn()
  const registry = new StudioExtensions(db, { feedRead, marketplaceSources: vi.fn() }, authorize)
  cleanups.push(() => registry.dispose())
  const id = 'example.metrics'
  const manifest = {
    id,
    name: 'Metrics',
    version: 1 as const,
    settings: [{ id: 'branch', title: 'Branch', default: 'main' }],
    contributions: [
      {
        id: 'latency',
        kind: 'api' as const,
        title: 'Latency',
        url: origin.url,
        pointer: '/value',
        chart: 'number' as const,
      },
      {
        id: 'status',
        kind: 'tool' as const,
        title: 'Status',
        taskId: 'thread',
        server: 'ci',
        tool: 'status',
      },
    ],
  }
  registry.command({ action: 'stage', expectedRevision: 0, manifest }, authorize)
  registry.command({ action: 'install', id, expectedRevision: 1, componentVersion: 3 }, authorize)
  const read = (expectedRevision: number, caller: () => void = authorize) =>
    registry.command(
      { action: 'read-data', id, contributionId: 'latency', expectedRevision },
      caller,
    )
  return { origin, registry, authorize, feedRead, id, manifest, read }
}

it('shares one data read between callers and checks each caller before it gets the data', async () => {
  const { origin, read } = await dataExtension()
  let revoked = false
  const first = read(2)
  const joined = read(2, () => {
    if (revoked) throw new HttpError(401, 'Device revoked')
  })
  await vi.waitFor(() => expect(origin.pending).toHaveLength(1))
  revoked = true
  origin.release()
  await expect(first).resolves.toMatchObject({ data: 7, updatedAt: expect.any(Number) })
  await expect(joined).rejects.toThrow('Device revoked')
  expect(origin.pending).toHaveLength(0)
})

it('fails a shared data read when every waiting caller loses access', async () => {
  const { origin, read } = await dataExtension()
  let revoked = false
  const caller = () => {
    if (revoked) throw new HttpError(401, 'Device revoked')
  }
  const reads = [read(2, caller), read(2, caller)]
  await vi.waitFor(() => expect(origin.pending).toHaveLength(1))
  revoked = true
  origin.release()
  for (const pending of reads) await expect(pending).rejects.toThrow('Device revoked')
})

it('keeps a data read through a settings save, but still refuses a new read of a stale revision', async () => {
  const { origin, registry, authorize, id, read } = await dataExtension()
  const pending = read(2)
  await vi.waitFor(() => expect(origin.pending).toHaveLength(1))
  registry.command(
    { action: 'settings', id, expectedRevision: 2, settings: { branch: 'next' } },
    authorize,
  )
  await expect(read(2)).rejects.toThrow('Reload its data sources')
  // A caller that loaded the new revision joins the read already in flight.
  const current = read(3)
  origin.release()
  await expect(pending).resolves.toMatchObject({ data: 7 })
  await expect(current).resolves.toMatchObject({ data: 7 })
})

it('cancels a data read when the extension is disabled and a tool call after any change', async () => {
  const { origin, registry, authorize, feedRead, id, read } = await dataExtension()
  feedRead.mockImplementation(
    (_task: string, _input: unknown, _scope: unknown, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  await registry.sourcePolicy(
    {
      owner: 'extension',
      id,
      sourceId: 'status',
      expectedRevision: 2,
      policy: { access: 'session', autoLoad: false },
    },
    authorize,
  )
  const tool = registry.command(
    { action: 'call', id, contributionId: 'status', expectedRevision: 2 },
    authorize,
  )
  await vi.waitFor(() => expect(feedRead).toHaveBeenCalledTimes(1))
  registry.command(
    { action: 'settings', id, expectedRevision: 2, settings: { branch: 'next' } },
    authorize,
  )
  await expect(tool).rejects.toThrow('changed during the call')

  const pending = read(3)
  await vi.waitFor(() => expect(origin.pending).toHaveLength(1))
  registry.command({ action: 'disable', id, expectedRevision: 3 }, authorize)
  await expect(pending).rejects.toThrow('changed during the call')
})

it('lets an opted-in agent stage a command data source, but only a paired user installs it', () => {
  const db = openDatabase(':memory:')
  const authorize = () => undefined
  const author = { taskId: 'author', readOnly: false }
  const id = 'example.workers'
  const manifest = {
    id,
    name: 'Workers',
    version: 1 as const,
    contributions: [
      {
        id: 'workers',
        kind: 'cli' as const,
        title: 'Workers',
        repositoryId: 'repo',
        command: 'workers --json',
        pointer: '',
        chart: 'number' as const,
      },
    ],
  }
  try {
    const registry = new StudioExtensions(
      db,
      { feedRead: vi.fn(), marketplaceSources: vi.fn() },
      authorize,
    )
    registry.command({ action: 'agent-install-policy', enabled: true }, authorize)
    registry.command({ action: 'stage', expectedRevision: 0, manifest }, authorize, author)
    const install = { action: 'install' as const, id, expectedRevision: 1 }
    expect(() => registry.command(install, authorize, author)).toThrow(
      'A paired user must review and install it',
    )
    expect(registry.command({ ...install, componentVersion: 3 }, authorize)).toMatchObject({
      extension: { enabled: true, installed: manifest },
    })
  } finally {
    db.close()
  }
})
