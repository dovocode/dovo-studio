import { expect, it } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, taskSchema, snapshotSchema } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { ThreadReplicationJournal } from './thread-replication-journal.js'

async function fixture(databasePath = ':memory:') {
  const token = randomBytes(32).toString('hex')
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  const call = (path: string, value?: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    })
  const create = (id = 'thread', count = 2) => {
    const task = decode(taskSchema, {
      id,
      title: 'Owner title',
      repositoryId: 'repo',
      agentId: '',
      status: 'review',
      createdAt: '2026-10-01T00:00:00Z',
      messages: Array.from({ length: count }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 ? 'assistant' : 'user',
        text: `Message ${index}`,
        createdAt: `2026-10-01T00:00:${String(index % 60).padStart(2, '0')}Z`,
      })),
      files: [
        {
          path: '/private/file',
          before: 'private contents',
          after: 'secret contents',
          viewed: false,
        },
      ],
      draft: 'private unsent draft',
      sessionId: 'private-provider-session',
      example: false,
    })
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.some((repo) => repo.id === 'repo')
        ? workspace.repositories
        : [
            ...workspace.repositories,
            { id: 'repo', name: 'Shared project', path: tmpdir(), branch: 'main' },
          ],
      tasks: [...workspace.tasks, task],
    }))
    return task
  }
  return { runtime, token, call, create, close: runtime.close }
}

it('keeps same-ID conversations on their owners across real paired runtime HTTP connections', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    a.create('thread')
    const other = b.create('thread', 1)
    b.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) =>
        task.id === other.id
          ? {
              ...b.runtime.services.store.task(other.id),
              title: 'B owns this',
              messages: [{ id: 'b-message', role: 'user', text: 'Only on B' }],
            }
          : task,
      ),
    }))
    a.runtime.services.retrievalPeers.registerStudio('owner', {
      sessionId: 'ownership-test',
      peers: [
        {
          id: 'b',
          name: 'B',
          connection: {
            address: `http://127.0.0.1:${b.runtime.port}`,
            token: b.token,
            runtimeId: b.runtime.services.runtimeId,
          },
        },
      ],
    })
    b.runtime.services.retrievalPeers.registerStudio('owner', {
      sessionId: 'ownership-test',
      peers: [
        {
          id: 'a',
          name: 'A',
          connection: {
            address: `http://127.0.0.1:${a.runtime.port}`,
            token: a.token,
            runtimeId: a.runtime.services.runtimeId,
          },
        },
      ],
    })
    for (const owner of [a, b]) {
      const snapshot = decode(snapshotSchema, await (await owner.call('/api/snapshot')).json())
      expect(snapshot.workspace.tasks).toHaveLength(1)
      expect(snapshot.workspace.tasks[0]?.replica).toBeUndefined()
      expect(snapshot.threadReplicationVersion).toBeUndefined()
      expect(
        owner.runtime.services.db.prepare('SELECT COUNT(*) FROM thread_registers').pluck().get(),
      ).toBe(0)
    }
    expect(a.runtime.services.store.task('thread').draft).toBe('private unsent draft')
    expect(a.runtime.services.store.task('thread').messages.map((m) => m.text)).toEqual([
      'Message 0',
      'Message 1',
    ])
    expect(b.runtime.services.store.task('thread').messages.map((m) => m.text)).toEqual([
      'Only on B',
    ])
    for (const endpoint of ['exchange', 'history', 'restore', 'status']) {
      const response = await b.call(
        `/api/threads/state/${endpoint}`,
        endpoint === 'status' ? undefined : { privateTranscript: 'DO-NOT-COPY' },
      )
      expect(response.status).toBe(410)
    }
    expect(
      b.runtime.services.db.prepare('SELECT COUNT(*) FROM thread_registers').pluck().get(),
    ).toBe(0)
    expect(
      b.runtime.services.db.prepare('SELECT COUNT(*) FROM thread_state_log').pluck().get(),
    ).toBe(0)
  } finally {
    await a.close()
    await b.close()
  }
})

it('preserves legacy archives and local drafts across restart without publishing copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-owner-migration-'))
  const path = join(directory, 'runtime.sqlite')
  let f = await fixture(path)
  try {
    f.create('thread')
    const runtimeId = f.runtime.services.runtimeId
    const journal = new ThreadReplicationJournal(f.runtime.services.db, runtimeId)
    const identity = { ownerRuntimeId: 'foreign', threadId: 'thread' }
    journal.record({
      ...identity,
      kind: 'thread',
      ownerName: 'Original computer',
      projectName: 'Original project',
      createdAt: '2026-01-01',
      status: 'running',
      historyRevision: 0,
      removed: false,
    })
    journal.record({ ...identity, kind: 'title', value: 'Stored legacy conversation' })
    for (let index = 0; index < 85; index++)
      journal.record({
        ...identity,
        kind: 'message',
        messageId: `legacy-${index}`,
        position: index,
        message: { id: `legacy-${index}`, role: 'user', text: `Archived text ${index}` },
      })
    const retained = f.runtime.services.db
      .prepare('SELECT value FROM thread_versions ORDER BY sequence')
      .pluck()
      .all()
    await f.close()
    f = await fixture(path)
    expect(f.runtime.services.runtimeId).toBe(runtimeId)
    expect(f.runtime.services.store.task('thread').draft).toBe('private unsent draft')
    expect(f.runtime.services.store.task('thread').messages).toHaveLength(2)
    const snapshot = decode(
      snapshotSchema,
      await (await f.call('/api/snapshot?scope=overview&settledLimit=25')).json(),
    )
    expect(snapshot.workspace.tasks.map((t) => t.id)).toEqual(['thread'])
    expect(snapshot.threadReplicationVersion).toBeUndefined()
    const response = await f.call('/api/threads/replica/read', identity)
    expect(response.status).toBe(200)
    const page = await response.json()
    expect(page.task.title).toBe('Stored legacy conversation')
    expect(page.task.messages).toHaveLength(40)
    expect(page.task.messages.at(-1).text).toBe('Archived text 84')
    const older = await f.call('/api/threads/replica/read', {
      ...identity,
      before: page.task.historyBefore,
    })
    expect((await older.json()).task.messages.at(-1).text).toBe('Archived text 44')
    expect(
      (
        await f.call('/api/threads/metadata', {
          ...identity,
          field: 'title',
          value: 'Overwrite archive',
        })
      ).status,
    ).toBe(410)
    expect((await f.call('/api/threads/replica/read', identity, 'invalid-token')).status).toBe(401)
    expect(
      (
        await f.call('/api/threads/replica/read', {
          ownerRuntimeId: 'missing',
          threadId: 'missing',
        })
      ).status,
    ).toBe(404)
    expect((await (await f.call('/api/tasks/search', { query: 'Archived' })).json()).hits).toEqual(
      [],
    )
    expect(
      (await (await f.call('/api/tasks/search', { query: 'Message' })).json()).hits,
    ).toHaveLength(2)
    f.runtime.services.store.updateTask('thread', (task) => ({
      ...task,
      title: 'Changed local title',
    }))
    expect(
      f.runtime.services.db
        .prepare('SELECT value FROM thread_versions ORDER BY sequence')
        .pluck()
        .all(),
    ).toEqual(retained)
  } finally {
    await f.close()
    await rm(directory, { recursive: true, force: true })
  }
})
