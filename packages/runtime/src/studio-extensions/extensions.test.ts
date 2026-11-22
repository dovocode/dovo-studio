import { decode, studioExtensionsListSchema } from '@dovo/protocol'
import { expect, it, vi } from 'vite-plus/test'
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
