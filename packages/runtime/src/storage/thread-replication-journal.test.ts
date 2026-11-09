import { expect, it, vi } from 'vite-plus/test'
import { threadReplicaId, searchTaskMessages } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { ThreadReplicationJournal } from './thread-replication-journal.js'
import { WorkspaceStore } from './workspace.js'

function fixture() {
  const db = openDatabase(':memory:')
  new WorkspaceStore(db)
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
  return { db, journal, identity }
}

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
