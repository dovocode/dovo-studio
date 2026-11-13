import { expect, it, vi } from 'vite-plus/test'
import { threadReplicaId, searchTaskMessages, threadRecordKey } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { ThreadReplicationJournal } from './thread-replication-journal.js'
import { WorkspaceStore } from './workspace.js'

function fixture() {
  const db = openDatabase(':memory:')
  const store = new WorkspaceStore(db)
  const journal = new ThreadReplicationJournal(db, 'local')
  const identity = { ownerRuntimeId: 'owner', threadId: 'thread' }
  journal.record({
    ...identity,
    kind: 'thread',
    ownerName: 'Owner',
    projectName: 'Project',
    createdAt: '2026-10-01',
    status: 'done',
    historyRevision: 0,
    removed: false,
  })
  journal.record({ ...identity, kind: 'title', value: 'Shared conversation' })
  return { db, journal, identity, store }
}

it('accepts equivalent JSON property order and rejects a genuinely reused revision atomically', async () => {
  const { db, journal, store } = fixture()
  try {
    const version = journal.current().find((item) => !item.deleted && item.value.kind === 'title')
    if (!version || version.deleted || version.value.kind !== 'title')
      throw new Error('Missing title fixture')
    const reordered = Object.fromEntries(Object.entries(version).reverse())
    db.prepare('UPDATE thread_versions SET value=? WHERE identity=?').run(
      JSON.stringify(reordered),
      JSON.stringify([version.key, version.updatedAt, version.changeId]),
    )
    // Use the actual storage append path that imports versions after an exchange.
    const storage = journal.storage(store)
    await storage.append!(0, [{ sequence: 1, version }], {}, {})
    const changed = { ...version, value: { ...version.value, value: 'Conflicting title' } }
    expect(() => storage.append!(1, [{ sequence: 2, version: changed }], {}, {})).toThrow('reused')
    expect(journal.thread('owner', 'thread')).toContainEqual(version)
  } finally {
    db.close()
  }
})

it('reuses committed summaries and unchanged identities without caching rolled-back projections', () => {
  const { db, journal, identity } = fixture()
  try {
    const initial = journal.replicas([])
    const queries = vi.spyOn(db, 'prepare')
    expect(journal.replicas([])).toBe(initial)
    journal.record({
      ...identity,
      kind: 'message',
      messageId: 'one',
      position: 0,
      message: { id: 'one', role: 'user', text: 'Hi' },
    })
    queries.mockClear()
    expect(journal.replicas([])).toBe(initial)
    expect(
      queries.mock.calls.some(([sql]) => sql.includes('SELECT value FROM thread_registers')),
    ).toBe(false)
    queries.mockRestore()
    expect(() =>
      db.transaction(() => {
        journal.record({ ...identity, kind: 'title', value: 'Rolled back' })
        expect(journal.replicas([])[0].title).toBe('Rolled back')
        throw new Error('rollback')
      })(),
    ).toThrow('rollback')
    expect(journal.replicas([])).toBe(initial)
    journal.record({ ...identity, kind: 'title', value: 'Committed' })
    expect(journal.replicas([])[0].title).toBe('Committed')
    expect(journal.replicas([])).not.toBe(initial)
  } finally {
    db.close()
  }
})

it('searches full replica histories with Unicode, paging, edits, rollback and index rebuild', () => {
  const { db, journal, identity } = fixture()
  try {
    const id = threadReplicaId('owner', 'thread')
    for (let i = 0; i < 65; i++)
      journal.record({
        ...identity,
        kind: 'message',
        messageId: `m${i}`,
        position: i,
        message: { id: `m${i}`, role: 'assistant', text: `Café archive phrase ${i}` },
      })
    const first = journal.search('cafe archive', id)
    expect(first.hits).toHaveLength(50)
    expect(first.nextBefore).toBe('m15')
    expect(journal.search('cafe archive', id, first.nextBefore).hits).toHaveLength(15)
    expect(journal.search('"archive phrase 0"').hits[0].messageId).toBe('m0')
    journal.record({ ...identity, kind: 'message', messageId: 'm0', position: 0, message: null })
    expect(journal.search('"archive phrase 0"').hits).toEqual([])
    expect(() => journal.search('archive', id, 'm0')).toThrow('cursor')
    expect(() =>
      db.transaction(() => {
        journal.record({
          ...identity,
          kind: 'message',
          messageId: 'm1',
          position: 1,
          message: { id: 'm1', role: 'user', text: 'rollback-only' },
        })
        expect(journal.search('rollback-only').hits).toHaveLength(1)
        throw new Error('rollback')
      })(),
    ).toThrow('rollback')
    expect(journal.search('rollback-only').hits).toEqual([])
    db.prepare("DELETE FROM documents WHERE id='thread-search:v1'").run()
    const reopened = new ThreadReplicationJournal(db, 'local')
    const full = reopened.thread('owner', 'thread')
    const messages = full
      .flatMap((version) =>
        !version.deleted && version.value.kind === 'message' && version.value.message
          ? [version.value.message]
          : [],
      )
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    const task = { ...reopened.replicas([])[0], messages }
    expect(reopened.search('cafe')).toEqual(searchTaskMessages([task], 'cafe'))
    reopened.record({
      ...identity,
      kind: 'message',
      messageId: 'm1',
      position: 1,
      message: { id: 'm1', role: 'user', text: 'Updated searchable text' },
    })
    expect(reopened.search('updated searchable').hits.map((hit) => hit.messageId)).toEqual(['m1'])
    reopened.record({
      ...identity,
      kind: 'thread',
      ownerName: 'Owner',
      projectName: 'Project',
      createdAt: '2026-10-01',
      status: 'done',
      historyRevision: 1,
      removed: true,
    })
    expect(reopened.search('cafe').taskIds).toEqual([])
    expect(reopened.replicas([])).toEqual([])
  } finally {
    db.close()
  }
})

it('retires Bot copies that an earlier build shared, once, without touching the owner', () => {
  const db = openDatabase(':memory:')
  const store = new WorkspaceStore(db)
  const journal = new ThreadReplicationJournal(db, 'local')
  try {
    const task = (id: string, bot?: boolean) => ({
      id,
      title: id,
      repositoryId: 'dovo:scratch',
      agentId: '',
      status: 'review' as const,
      createdAt: '2026-10-01T00:00:00.000Z',
      messages: [{ id: `${id}-m`, role: 'user' as const, text: `${id} history` }],
      files: [],
      draft: '',
      example: false,
      ...(bot
        ? {
            bot: {
              role: 'Helper',
              responsibilities: '',
              state: 'active' as const,
              revision: '00000000-0000-4000-8000-000000000000',
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
            },
          }
        : {}),
    })
    store.update((workspace) => ({
      ...workspace,
      tasks: [task('bot', true), task('plain')],
    }))
    // Records an earlier build published for both threads, on an already seeded journal.
    for (const id of ['bot', 'plain']) {
      const identity = { ownerRuntimeId: 'local', threadId: id }
      journal.record({
        ...identity,
        kind: 'thread',
        ownerName: 'Owner',
        projectName: 'General',
        createdAt: '2026-10-01',
        status: 'review',
        historyRevision: 0,
        removed: false,
      })
      journal.record({
        ...identity,
        kind: 'message',
        messageId: `${id}-m`,
        position: 0,
        message: { id: `${id}-m`, role: 'user', text: `${id} history` },
      })
    }
    for (const flag of ['thread-replication-seeded:v1', 'thread-replication-parents:v1'])
      db.prepare("INSERT INTO documents VALUES (?, 'true')").run(flag)
    journal.seed(store)
    const live = (id: string) =>
      journal.thread('local', id).flatMap((version) => (version.deleted ? [] : [version.value]))
    expect(live('bot')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'thread', removed: true }),
        expect.objectContaining({ kind: 'message', message: null }),
      ]),
    )
    expect(live('plain')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'thread', removed: false }),
        expect.objectContaining({
          kind: 'message',
          message: expect.objectContaining({ id: 'plain-m' }),
        }),
      ]),
    )
    // The owner keeps the Bot and its history; a second start changes nothing.
    expect(store.task('bot').messages.map((message) => message.text)).toEqual(['bot history'])
    const version = journal.version()
    journal.seed(store)
    expect(journal.version()).toBe(version)
  } finally {
    db.close()
  }
})

it('retires a shared copy once when a thread becomes a Bot and ignores peer edits to Bots', async () => {
  const db = openDatabase(':memory:')
  const journal = new ThreadReplicationJournal(db, 'local')
  const store = new WorkspaceStore(db, (change) => journal.capture(change))
  try {
    journal.seed(store)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'helper',
          title: 'Helper',
          repositoryId: 'dovo:scratch',
          agentId: '',
          status: 'review',
          createdAt: '2026-10-01T00:00:00.000Z',
          messages: [{ id: 'm', role: 'user', text: 'Private helper history' }],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const live = () =>
      journal
        .thread('local', 'helper')
        .flatMap((version) => (version.deleted ? [] : [version.value]))
    expect(live()).toContainEqual(expect.objectContaining({ kind: 'thread', removed: false }))
    store.updateTask('helper', (task) => ({
      ...task,
      bot: {
        role: 'Helper',
        responsibilities: '',
        state: 'active',
        revision: '00000000-0000-4000-8000-000000000000',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    }))
    expect(live()).toContainEqual(expect.objectContaining({ kind: 'thread', removed: true }))
    expect(live()).toContainEqual(expect.objectContaining({ kind: 'message', message: null }))
    // Later Bot updates do not scan or write the journal.
    const version = journal.version()
    const scans = vi.spyOn(journal, 'thread')
    for (const title of ['One', 'Two', 'Three'])
      store.updateTask('helper', (task) => ({ ...task, title }))
    expect(scans).not.toHaveBeenCalled()
    expect(journal.version()).toBe(version)
    scans.mockRestore()

    // A peer's stale title edit for this Bot is stored but never applied to the Bot.
    const title = {
      ownerRuntimeId: 'local',
      threadId: 'helper',
      kind: 'title' as const,
      value: 'Peer rename',
    }
    const peer = {
      key: threadRecordKey(title),
      updatedAt: Date.now() + 60_000,
      changeId: `peer:${Date.now() + 60_000}`,
      deleted: false as const,
      value: title,
    }
    await journal.storage(store).append!(0, [{ sequence: 1, version: peer }], {}, {})
    expect(store.taskSummary('helper').title).toBe('Three')
    expect(store.task('helper').messages.map((message) => message.text)).toEqual([
      'Private helper history',
    ])
  } finally {
    db.close()
  }
})
