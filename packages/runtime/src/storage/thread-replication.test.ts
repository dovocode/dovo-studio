import { expect, it } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DurableState } from '@dovo/durable-connections'
import {
  decode,
  taskSchema,
  decodeThreadRecord,
  validateThreadVersion,
  threadReplicationChannel,
  threadRecordKey,
  snapshotSchema,
  ThreadStateSynchronization,
  runtimeProfile,
  type ThreadRecord,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { backupRuntimeDatabase } from './backup.js'
import { restoreRuntimeBackup } from './backups.js'

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
type Fixture = Awaited<ReturnType<typeof fixture>>

it('recovers through a retained runtime pairing and persists peer sources in SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-runtime-restore-'))
  const path = join(directory, 'runtime.sqlite'),
    backup = join(directory, 'backup.sqlite')
  let a: Fixture | undefined
  const b = await fixture()
  try {
    a = await fixture(path)
    a.create('thread', 1)
    await a.runtime.services.threadReplication.refresh()
    await backupRuntimeDatabase(path, backup)
    pair(a, b)
    await a.runtime.services.threadReplication.refresh()
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas()[0]?.messages.length)
      .toBe(1)
    const task = a.runtime.services.store.task('thread')
    a.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          ...task,
          messages: [...task.messages, { id: 'later', role: 'assistant', text: 'After backup' }],
        },
      ],
    }))
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas()[0]?.messages.length, {
        timeout: 6000,
      })
      .toBe(2)
    await a.close()
    a = undefined
    await restoreRuntimeBackup(path, backup)
    a = await fixture(path)
    expect(a.runtime.services.retrievalPeers.list(true)).toHaveLength(1)
    await expect
      .poll(
        () =>
          b.runtime.services.threadReplication
            .replicas()
            .find((task) => task.replica?.ownerRuntimeId.startsWith('recovered:'))?.messages.length,
        { timeout: 6000 },
      )
      .toBe(2)
    const recovered = a.runtime.services.threadReplication
      .replicas()
      .find((task) => task.replica?.ownerRuntimeId.startsWith('recovered:'))
    expect(recovered?.messages).toHaveLength(2)
    expect(a.runtime.services.store.task('thread').messages).toHaveLength(1)
    const raw = a.runtime.services.db
      .prepare("SELECT value FROM documents WHERE id='thread-state-sources:v1'")
      .pluck()
      .get()
    expect(typeof raw).toBe('string')
    expect(typeof raw === 'string' ? JSON.parse(raw) : undefined).toMatchObject({
      [b.runtime.services.runtimeId]: b.runtime.services.runtimeId,
    })
    await a.close()
    a = await fixture(path)
    expect(
      a.runtime.services.db
        .prepare("SELECT value FROM documents WHERE id='thread-state-sources:v1'")
        .pluck()
        .get(),
    ).toBe(raw)
    expect(a.runtime.services.store.task('thread').messages).toHaveLength(1)
    expect(
      a.runtime.services.threadReplication
        .replicas()
        .find((task) => task.replica?.ownerRuntimeId.startsWith('recovered:'))?.messages,
    ).toHaveLength(2)
  } finally {
    await a?.close()
    await b.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('resumes after backup rollback, keeps device access and recovers newer peer history without running it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-replication-restore-'))
  const path = join(directory, 'runtime.sqlite'),
    backup = join(directory, 'backup.sqlite')
  let runtime: Fixture | undefined
  let saved: unknown
  const options = {
    channel: threadReplicationChannel,
    replicaId: 'phone',
    decode: decodeThreadRecord,
    validateVersion: validateThreadVersion,
    storage: {
      load: () => saved,
      save: (value: unknown) => {
        saved = structuredClone(value)
      },
    },
  }
  let phone = await DurableState.open(options)
  const token = randomBytes(32).toString('hex')
  const sync = async (owner: Fixture, runtimeId: string) => {
    let source = runtimeId,
      sentThrough = 0
    for (let i = 0; i < 50; i++) {
      const response = await owner.call(
        '/api/threads/state/exchange',
        {
          ...phone.request(source, sentThrough),
          targetRuntimeId: runtimeId,
        },
        token,
      )
      const body = await response.json()
      expect(response.status).toBe(200)
      const result = await phone.accept(body, runtimeId)
      source = result.peer
      sentThrough = result.sentThrough
      if (!result.more) return source
    }
    throw new Error('Restore replication did not settle')
  }
  try {
    runtime = await fixture(path)
    runtime.create('thread', 1)
    await runtime.runtime.services.threadReplication.refresh()
    const identity = runtime.runtime.services.runtimeId
    const revoked = randomBytes(32).toString('hex')
    const revokedId = runtime.runtime.services.devices.add('Revoked', revoked)
    await backupRuntimeDatabase(path, backup)
    // Pairing after the backup must survive restore. Revocations must not roll back either.
    runtime.runtime.services.devices.add('Phone', token)
    runtime.runtime.services.devices.revoke(revokedId)
    const full = runtime.runtime.services.store.task('thread')
    runtime.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) =>
        task.id === full.id
          ? {
              ...full,
              messages: [
                ...full.messages,
                { id: 'after-backup', role: 'assistant' as const, text: 'Keep this newer reply' },
              ],
            }
          : task,
      ),
    }))
    await runtime.runtime.services.threadReplication.refresh()
    await sync(runtime, identity)
    const oldCursor = phone.checkpoint(identity)
    await runtime.close()
    runtime = undefined
    await restoreRuntimeBackup(path, backup)
    runtime = await fixture(path)
    expect(runtime.runtime.services.runtimeId).toBe(identity)
    expect((await runtime.call('/api/snapshot', undefined, revoked)).status).toBe(401)
    const beforeRecovery = runtime.runtime.services.threadReplication.version()
    const bad = phone.request(identity)
    const gap = {
      ...bad,
      batch: {
        ...bad.batch,
        after: 1000,
        through: 1000 + bad.batch.changes.length,
        changes: bad.batch.changes.map((change, i) => ({ ...change, sequence: 1001 + i })),
      },
    }
    expect((await runtime.call('/api/threads/state/exchange', gap, token)).status).toBe(400)
    expect(runtime.runtime.services.threadReplication.version()).toBe(beforeRecovery)
    expect(runtime.runtime.services.threadReplication.replicas()).toEqual([])
    const source = await sync(runtime, identity)
    expect(source).not.toBe(identity)
    expect(phone.checkpoint(identity)).toBe(oldCursor)
    expect(runtime.runtime.services.store.task('thread').messages).toHaveLength(1)
    expect(
      runtime.runtime.services.threadReplication.read(identity, 'thread').task.messages,
    ).toHaveLength(1)
    const recovered = runtime.runtime.services.threadReplication
      .replicas()
      .find((task) => task.replica?.ownerRuntimeId.startsWith('recovered:'))
    expect(recovered?.messages.map((message) => message.text)).toEqual([
      'Message 0',
      'Keep this newer reply',
    ])
    expect(recovered?.replica?.ownerName).toContain('recovered')
    expect(runtime.runtime.services.store.get().tasks).toHaveLength(1)
    const revision = runtime.runtime.services.threadReplication.version()
    await sync(runtime, identity)
    expect(runtime.runtime.services.threadReplication.version()).toBe(revision)
    await runtime.close()
    runtime = undefined
    await phone.close()
    phone = await DurableState.open(options)
    runtime = await fixture(path)
    expect(phone.request(identity).pull).toEqual({ source, after: phone.checkpoint(source) })
    expect(phone.checkpoint(source)).toBeGreaterThan(0)
    expect(await sync(runtime, identity)).toBe(source)
    expect(
      runtime.runtime.services.threadReplication
        .replicas()
        .find((task) => task.replica?.ownerRuntimeId.startsWith('recovered:'))?.messages,
    ).toHaveLength(2)
    expect(runtime.runtime.services.store.task('thread').messages).toHaveLength(1)
    runtime.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, title: 'Edited after restore' })),
    }))
    const title = runtime.runtime.services.threadReplication.journal
      .thread(identity, 'thread')
      .find((version) => !version.deleted && version.value.kind === 'title')
    expect(title?.changeId.startsWith(`${source}:`)).toBe(true)
  } finally {
    await runtime?.close()
    await phone.close()
    await rm(directory, { recursive: true, force: true })
  }
})
function pair(a: Fixture, b: Fixture) {
  a.runtime.services.retrievalPeers.registerStudio('owner', {
    sessionId: 'thread-test',
    peers: [
      {
        id: 'remote',
        name: 'Remote',
        connection: {
          address: `http://127.0.0.1:${b.runtime.port}`,
          token: b.token,
          runtimeId: b.runtime.services.runtimeId,
        },
      },
    ],
  })
}
async function settle(a: Fixture, b: Fixture) {
  await a.runtime.services.threadReplication.refresh()
  await b.runtime.services.threadReplication.refresh()
}

it('replicates history over paired HTTP without creating an executable task, then merges metadata back to its owner', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    a.create('thread', 85)
    pair(a, b)
    await settle(a, b)
    await expect.poll(() => b.runtime.services.threadReplication.replicas()).toHaveLength(1)
    const copy = b.runtime.services.threadReplication.replicas()[0]
    expect(copy.replica?.ownerRuntimeId).toBe(a.runtime.services.runtimeId)
    expect(copy.messages).toHaveLength(40)
    expect(copy.messages[0].id).toBe('message-45')
    expect(b.runtime.services.store.get().tasks).toEqual([])
    const older = await b.call('/api/threads/replica/read', {
      ownerRuntimeId: a.runtime.services.runtimeId,
      threadId: 'thread',
      before: copy.historyBefore,
    })
    expect(older.status).toBe(200)
    expect((await older.json()).task.messages[0].id).toBe('message-5')
    expect(
      (
        await b.call('/api/threads/replica/read', {
          ownerRuntimeId: a.runtime.services.runtimeId,
          threadId: 'thread',
          before: 'missing-message',
        })
      ).status,
    ).toBe(409)
    const encoded = JSON.stringify(copy)
    for (const secret of [
      'private-provider-session',
      'private unsent draft',
      '/private/file',
      'private contents',
      'secret contents',
    ])
      expect(encoded).not.toContain(secret)
    const pin = await b.call('/api/threads/metadata', {
      ownerRuntimeId: a.runtime.services.runtimeId,
      threadId: 'thread',
      field: 'pinned',
      value: true,
    })
    expect(pin.status).toBe(200)
    a.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, title: 'Changed at owner' })),
    }))
    await settle(a, b)
    await expect
      .poll(() => a.runtime.services.store.task('thread').pinned, { timeout: 6000 })
      .toBe(true)
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas()[0]?.title, { timeout: 6000 })
      .toBe('Changed at owner')
    const snapshot = decode(snapshotSchema, await (await b.call('/api/snapshot')).json())
    expect(snapshot.threadReplicationVersion).toBe(1)
    expect(snapshot.workspace.tasks[0]?.replica).toBeDefined()
    expect(() =>
      b.runtime.services.store.update((workspace) => ({ ...workspace, tasks: [copy] })),
    ).toThrow('execution workspace')
    expect(
      (await b.call('/api/tasks/message', { id: copy.id, text: 'Do not execute' })).status,
    ).not.toBe(200)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

it('archives writes atomically, retains versions through restart and prevents deleted threads from returning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-thread-replication-'))
  let a: Fixture | undefined
  const b = await fixture()
  try {
    a = await fixture(join(directory, 'runtime.sqlite'))
    a.create()
    const journal = a.runtime.services.threadReplication.journal
    const before = journal.version()
    const owner = a
    expect(() =>
      owner.runtime.services.store.transaction(() => {
        owner.runtime.services.store.update((workspace) => ({
          ...workspace,
          tasks: workspace.tasks.map((task) => ({ ...task, title: 'Rolled back' })),
        }))
        throw new Error('Abort transaction')
      }),
    ).toThrow('Abort transaction')
    expect(journal.version()).toBe(before)
    expect(owner.runtime.services.store.task('thread').title).toBe('Owner title')
    owner.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, title: 'Retained edit' })),
    }))
    const id = owner.runtime.services.runtimeId
    await a.close()
    a = await fixture(join(directory, 'runtime.sqlite'))
    expect(a.runtime.services.runtimeId).toBe(id)
    pair(a, b)
    await settle(a, b)
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas()[0]?.title)
      .toBe('Retained edit')
    expect(
      a.runtime.services.threadReplication.journal
        .versions(0)
        .filter((entry) => entry.version.value.kind === 'title'),
    ).toHaveLength(2)
    a.runtime.services.store.update((workspace) => ({ ...workspace, tasks: [] }))
    await settle(a, b)
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas(), { timeout: 6000 })
      .toEqual([])
    expect(b.runtime.services.store.get().tasks).toEqual([])
  } finally {
    await a?.close()
    await b.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('replays lost replies safely and rejects foreign changes to owned history or status', async () => {
  const f = await fixture()
  let saved: unknown
  const state = await DurableState.open<ThreadRecord>({
    channel: threadReplicationChannel,
    replicaId: 'app',
    storage: {
      load: () => saved,
      save: (snapshot) => {
        saved = snapshot
      },
    },
    decode: decodeThreadRecord,
    validateVersion: validateThreadVersion,
  })
  try {
    f.create()
    const request = state.request()
    expect(
      (await f.call('/api/threads/state/exchange', { ...request, targetRuntimeId: 'wrong' }))
        .status,
    ).toBe(409)
    await f.call('/api/threads/state/exchange', request)
    const reply = await f.call('/api/threads/state/exchange', request)
    expect(reply.status).toBe(200)
    await state.accept(await reply.json())
    const record: ThreadRecord = {
      ownerRuntimeId: f.runtime.services.runtimeId,
      threadId: 'thread',
      kind: 'message',
      messageId: 'forged',
      position: 10,
      message: { id: 'forged', role: 'user', text: 'not an accepted prompt' },
    }
    await state.set(threadRecordKey(record), record)
    const refused = await f.call('/api/threads/state/exchange', state.request())
    expect(refused.status).toBe(400)
    expect(f.runtime.services.store.task('thread').messages).toHaveLength(2)
    expect((await f.call('/api/threads/state/exchange', request, 'invalid')).status).toBe(401)
  } finally {
    await state.close()
    await f.close()
  }
})

it('bridges runtimes through the app durable controller and resumes stored state after an offline interval', async () => {
  const a = await fixture(),
    b = await fixture()
  let saved: unknown
  const errors: string[] = []
  const controller = new ThreadStateSynchronization({
    storage: {
      load: () => saved,
      save: (snapshot) => {
        saved = structuredClone(snapshot)
      },
    },
    createReplicaId: () => 'app:bridge',
    intervalMs: null,
    refreshed: async () => {},
    error: (error) => errors.push(error),
    request: async (profile, path, input, signal) => {
      const response = await fetch(profile.connection.address + path, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${profile.connection.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
  })
  try {
    a.create()
    const targets = await Promise.all(
      [a, b].map(async (f) => ({
        profile: runtimeProfile({
          address: `http://127.0.0.1:${f.runtime.port}`,
          token: f.token,
          runtimeId: f.runtime.services.runtimeId,
        }),
        connected: true,
        snapshot: decode(snapshotSchema, await (await f.call('/api/snapshot')).json()),
      })),
    )
    controller.update(targets, true)
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas()[0]?.title)
      .toBe('Owner title')
    controller.update(targets, false)
    a.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, title: 'Offline edit' })),
    }))
    controller.update(targets, true)
    await expect
      .poll(() => b.runtime.services.threadReplication.replicas()[0]?.title)
      .toBe('Offline edit')
    expect(b.runtime.services.store.get().tasks).toEqual([])
    expect(errors.filter(Boolean)).toEqual([])
    expect(JSON.stringify(saved)).not.toContain(a.token)
  } finally {
    await controller.stop()
    await Promise.all([a.close(), b.close()])
  }
})

it('journals completed messages once, including metadata-only completion, and retains removals', async () => {
  const f = await fixture()
  try {
    f.create('thread', 1)
    const store = f.runtime.services.store
    const journal = f.runtime.services.threadReplication.journal
    const versions = () =>
      journal.versions(0).filter(({ version }) => version.value.kind === 'message')
    for (let token = 1; token <= 12; token++) {
      const task = store.task('thread')
      store.update((workspace) => ({
        ...workspace,
        tasks: [
          {
            ...task,
            status: 'running',
            messages: [
              task.messages[0],
              { id: 'stream', role: 'assistant', text: 'token '.repeat(token) },
            ],
          },
        ],
      }))
    }
    expect(versions()).toHaveLength(1)
    store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, status: 'review' })),
    }))
    expect(versions()).toHaveLength(2)
    expect(versions().at(-1)?.version.value).toMatchObject({
      message: { id: 'stream', text: 'token '.repeat(12) },
    })
    const task = store.task('thread')
    store.update((workspace) => ({
      ...workspace,
      tasks: [{ ...task, messages: [task.messages[0]] }],
    }))
    expect(versions()).toHaveLength(3)
    expect(versions().at(-1)?.version.value).toMatchObject({ messageId: 'stream', message: null })
    expect(
      f.runtime.services.threadReplication.read(f.runtime.services.runtimeId, 'thread').task
        .messages,
    ).toHaveLength(1)
  } finally {
    await f.close()
  }
})

it('does not repeat a receipted metadata edit after a later edit or an interrupted receipt', async () => {
  const f = await fixture()
  try {
    f.create()
    const input = {
      ownerRuntimeId: f.runtime.services.runtimeId,
      threadId: 'thread',
      field: 'title',
      value: 'First accepted title',
    }
    const send = (id: string, value = input) =>
      fetch('http://127.0.0.1:' + f.runtime.port + '/api/threads/metadata', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + f.token,
          'Content-Type': 'application/json',
          'x-dovo-mutation-id': id,
        },
        body: JSON.stringify(value),
      })
    expect((await send('first-edit')).status).toBe(200)
    expect((await send('second-edit', { ...input, value: 'Newest title' })).status).toBe(200)
    const revision = f.runtime.services.threadReplication.version()
    expect((await send('first-edit')).status).toBe(200)
    expect(f.runtime.services.store.task('thread').title).toBe('Newest title')
    expect(f.runtime.services.threadReplication.version()).toBe(revision)
    f.runtime.services.db
      .prepare('UPDATE mutation_receipts SET result=NULL WHERE id=?')
      .run('first-edit')
    expect((await send('first-edit')).status).toBe(409)
    expect(f.runtime.services.store.task('thread').title).toBe('Newest title')
    expect((await send('second-edit', { ...input, value: 'Reused ID' })).status).toBe(409)
  } finally {
    await f.close()
  }
})

it('bounds unusually large shared message copies without rejecting the authoritative conversation', async () => {
  const f = await fixture()
  try {
    const task = f.create('thread', 1)
    const text = '\u0000'.repeat(2 * 1024 * 1024)
    f.runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: [{ ...task, messages: [{ id: 'large', role: 'assistant', text }] }],
    }))
    await f.runtime.services.threadReplication.refresh()
    expect(f.runtime.services.store.task('thread').messages[0].text).toBe(text)
    const copy = f.runtime.services.threadReplication.read(
      f.runtime.services.runtimeId,
      'thread',
    ).task
    expect(copy.messages[0].text).toContain('[Shared copy shortened;')
    expect(copy.messages[0].text.length).toBeLessThan(1024 * 1024 + 100)
  } finally {
    await f.close()
  }
})

it('refreshes shared history revisions for edits without minting versions for unchanged messages', async () => {
  const f = await fixture()
  try {
    f.create('thread', 3)
    const store = f.runtime.services.store
    const read = () =>
      f.runtime.services.threadReplication.read(f.runtime.services.runtimeId, 'thread').task
    const before = read().historyRevision ?? 0
    const task = store.task('thread')
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          ...task,
          messages: task.messages.map((message) =>
            message.id === 'message-0' ? { ...message, text: 'Edited accepted text' } : message,
          ),
        },
      ],
    }))
    expect(read().historyRevision).toBeGreaterThan(before)
    expect(read().messages[0].text).toBe('Edited accepted text')
    const messages = f.runtime.services.threadReplication.journal
      .versions(0)
      .filter((entry) => entry.version.value.kind === 'message')
    expect(messages).toHaveLength(4)
    store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, title: 'Metadata only' })),
    }))
    expect(read().historyRevision).toBeGreaterThan(before)
    store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, archived: true })),
    }))
    expect(read().archived).toBe(true)
  } finally {
    await f.close()
  }
})

it('uses only Studio pairing grants and stops background sessions when their registration is removed', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    b.create()
    const input = {
      sessionId: 'grant-test',
      peers: [
        {
          id: 'remote',
          name: 'Remote',
          connection: {
            address: 'http://127.0.0.1:' + b.runtime.port,
            token: b.token,
            runtimeId: b.runtime.services.runtimeId,
          },
        },
      ],
    }
    a.runtime.services.retrievalPeers.register('owner', input)
    await a.runtime.services.threadReplication.refresh()
    expect(a.runtime.services.threadReplication.status().peers).toEqual([])
    a.runtime.services.retrievalPeers.registerStudio('owner', input)
    await a.runtime.services.threadReplication.refresh()
    await expect.poll(() => a.runtime.services.threadReplication.replicas()).toHaveLength(1)
    a.runtime.services.retrievalPeers.registerStudio('owner', { ...input, peers: [] })
    await a.runtime.services.threadReplication.refresh()
    expect(a.runtime.services.threadReplication.status().peers).toEqual([])
    expect(a.runtime.services.threadReplication.replicas()).toHaveLength(1)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

it('keeps long authoritative titles intact when importing their bounded shared projection', async () => {
  const f = await fixture()
  try {
    const task = f.create()
    const title = 'Long title '.repeat(300)
    f.runtime.services.store.update((workspace) => ({ ...workspace, tasks: [{ ...task, title }] }))
    await f.runtime.services.threadReplication.refresh()
    expect(f.runtime.services.store.task('thread').title).toBe(title)
    expect(
      f.runtime.services.threadReplication.read(f.runtime.services.runtimeId, 'thread').task.title,
    ).toBe(title.slice(0, 2000))
    await f.call('/api/threads/metadata', {
      ownerRuntimeId: f.runtime.services.runtimeId,
      threadId: 'thread',
      field: 'title',
      value: 'Explicit shared edit',
    })
    expect(f.runtime.services.store.task('thread').title).toBe('Explicit shared edit')
  } finally {
    await f.close()
  }
})

it('keeps authoritative threads usable when optional replication, peer and push records are damaged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-optional-recovery-'))
  const path = join(directory, 'runtime.sqlite')
  const { openDatabase } = await import('./database.js')
  try {
    const before = await fixture(path)
    before.create('preserved', 3)
    await before.close()
    const db = openDatabase(path)
    db.prepare(
      'INSERT INTO thread_state_log(sequence,value) VALUES (1,?) ON CONFLICT(sequence) DO UPDATE SET value=excluded.value',
    ).run('not-json')
    db.prepare(
      "INSERT INTO documents VALUES ('durable-state:shared-settings:v1',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    ).run('not-json')
    db.prepare('INSERT INTO shared_state_log(sequence,value) VALUES (1,?)').run('not-json')
    db.prepare('INSERT INTO peer_connections(device_id,config) VALUES (?,?)').run(
      'damaged-peer',
      'not-json',
    )
    db.prepare('INSERT INTO push_devices(device_id,value) VALUES (?,?)').run(
      'damaged-push',
      'not-json',
    )
    db.close()
    const recovered = await fixture(path)
    try {
      expect(recovered.runtime.services.store.task('preserved').messages).toHaveLength(3)
      expect(recovered.runtime.services.threadReplication.status().error).toContain('preserved')
      expect(recovered.runtime.services.stateReplication.status().error).toContain('preserved')
      const response = await recovered.call('/api/snapshot?scope=overview')
      expect(response.status).toBe(200)
      const snapshot = decode(snapshotSchema, await response.json())
      expect(snapshot.threadReplicationVersion).toBeUndefined()
      expect(snapshot.stateReplicationVersion).toBeUndefined()
      recovered.runtime.services.store.update((workspace) => ({
        ...workspace,
        tasks: workspace.tasks.map((task) => ({ ...task, title: 'Still usable' })),
      }))
      expect(recovered.runtime.services.store.task('preserved').title).toBe('Still usable')
      expect(
        recovered.runtime.services.db
          .prepare('SELECT value FROM thread_state_log WHERE sequence=1')
          .pluck()
          .get(),
      ).toBe('not-json')
      expect(
        recovered.runtime.services.db
          .prepare('SELECT config FROM peer_connections WHERE device_id=?')
          .pluck()
          .get('damaged-peer'),
      ).toBe('not-json')
    } finally {
      await recovered.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('paginates settled replicas together with local threads and retains explicitly selected history', async () => {
  const owner = await fixture(),
    receiver = await fixture()
  try {
    for (let index = 0; index < 60; index++) {
      const task = owner.create('shared-' + index, index === 0 ? 125 : 0)
      owner.runtime.services.store.update((workspace) => ({
        ...workspace,
        tasks: workspace.tasks.map((entry) =>
          entry.id === task.id ? { ...entry, status: 'done' as const, archived: true } : entry,
        ),
      }))
    }
    pair(receiver, owner)
    await settle(receiver, owner)
    await expect
      .poll(() => receiver.runtime.services.threadReplication.replicas([]).length)
      .toBe(60)
    const response = await receiver.call('/api/snapshot?scope=overview&settled=25')
    expect(response.status).toBe(200)
    const snapshot = decode(snapshotSchema, await response.json())
    expect(snapshot.workspace.tasks).toHaveLength(25)
    expect(snapshot.olderSettled).toEqual({ limit: 25, omitted: 35, threadKeys: expect.any(Array) })
    expect(snapshot.olderSettled?.threadKeys).toHaveLength(35)
    for (const key of snapshot.olderSettled?.threadKeys ?? [])
      expect(JSON.parse(key)[0]).toBe(owner.runtime.services.runtimeId)
    const read = receiver.runtime.services.threadReplication.read(
      owner.runtime.services.runtimeId,
      'shared-0',
    ).task
    expect(read.messages).toHaveLength(40)
    expect(read.messages[0].id).toBe('message-85')
    const older = receiver.runtime.services.threadReplication.read(
      owner.runtime.services.runtimeId,
      'shared-0',
      read.historyBefore,
    ).task
    expect(older.messages[0].id).toBe('message-45')
    expect(older.historyBefore).toBe('message-45')
  } finally {
    await Promise.all([owner.close(), receiver.close()])
  }
})

it('isolates damaged legacy replication records encountered while creating indexes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-replica-index-recovery-'))
  const path = join(directory, 'runtime.sqlite')
  const { openDatabase } = await import('./database.js')
  try {
    const db = openDatabase(path)
    db.exec('CREATE TABLE thread_registers (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO thread_registers VALUES (?,?)').run('damaged', 'not-json')
    db.close()
    const f = await fixture(path)
    try {
      expect(f.runtime.services.threadReplication.status().error).toContain('preserved')
      f.create('usable-after-index-failure', 2)
      expect(f.runtime.services.store.task('usable-after-index-failure').messages).toHaveLength(2)
      expect((await f.call('/api/snapshot?scope=overview')).status).toBe(200)
      expect(
        f.runtime.services.db
          .prepare('SELECT value FROM thread_registers WHERE key=?')
          .pluck()
          .get('damaged'),
      ).toBe('not-json')
    } finally {
      await f.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('searches older replica messages through the authenticated search route', async () => {
  const a = await fixture(),
    b = await fixture()
  try {
    a.create('search-thread', 65)
    a.runtime.services.store.updateTaskHistory('search-thread', (task) => ({
      ...task,
      messages: task.messages.map((message, index) =>
        index === 0 ? { ...message, text: 'nebula-cranberry older message' } : message,
      ),
    }))
    pair(b, a)
    await b.runtime.services.threadReplication.refresh()
    await expect.poll(() => b.runtime.services.threadReplication.replicas([]).length).toBe(1)
    await expect
      .poll(
        async () =>
          (await (await b.call('/api/tasks/search', { query: 'nebula-cranberry' })).json()).hits
            .length,
      )
      .toBe(1)
    const replica = b.runtime.services.threadReplication.replicas([])[0]
    expect(
      b.runtime.services.threadReplication
        .replicas([replica.id])[0]
        .messages.some((message) => message.id === 'message-0'),
    ).toBe(false)
    const response = await b.call('/api/tasks/search', {
      query: 'nebula-cranberry',
      id: replica.id,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      taskIds: [replica.id],
      hits: [
        { taskId: replica.id, messageId: 'message-0', snippet: 'nebula-cranberry older message' },
      ],
    })
  } finally {
    await a.close()
    await b.close()
  }
})

it('automatically repairs old parent omissions through authenticated HTTP without changing history or identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-parent-recovery-'))
  const path = join(dir, 'runtime.sqlite')
  let f = await fixture(path)
  const bare: ThreadRecord = {
    kind: 'thread',
    ownerRuntimeId: 'remote-owner',
    threadId: 'child',
    ownerName: 'Remote',
    projectName: 'Project',
    createdAt: '2026-10-01',
    status: 'done',
    historyRevision: 0,
    removed: false,
  }
  const version = {
    key: threadRecordKey(bare),
    updatedAt: 1,
    changeId: 'old-descriptor',
    deleted: false,
    value: bare,
  }
  const rich = {
    ...version,
    value: { ...bare, parent: { runtimeId: 'remote-owner', threadId: 'parent' } },
  }
  const request = (versions: unknown[], source: string) => ({
    batch: {
      protocol: 1,
      channel: threadReplicationChannel,
      source,
      after: 0,
      through: versions.length,
      more: false,
      changes: versions.map((version, index) => ({ sequence: index + 1, version })),
    },
    pull: { after: 0 },
  })
  try {
    expect(
      (await f.call('/api/threads/state/exchange', request([version], 'old-client'))).status,
    ).toBe(200)
    const oldTask = f.runtime.services.threadReplication.replicas()[0]
    const tables = ['thread_versions', 'thread_state_log', 'thread_registers']
    const counts = () =>
      tables.map((t) =>
        f.runtime.services.db
          .prepare('SELECT COUNT(*) FROM ' + t)
          .pluck()
          .get(),
      )
    const before = counts(),
      identity = f.runtime.services.runtimeId
    // The same JSON data can have a different key order after a database migration.
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(version).reverse()))
    for (const table of tables)
      f.runtime.services.db.prepare('UPDATE ' + table + ' SET value=?').run(reordered)
    expect(
      (await f.call('/api/threads/state/exchange', request([rich], 'new-client'))).status,
    ).toBe(200)
    expect(counts()).toEqual(before)
    const recovered = f.runtime.services.threadReplication.replicas()[0]
    expect(recovered).not.toBe(oldTask)
    expect(recovered.spawnParent).toEqual(rich.value.parent)
    for (const t of tables) {
      const rows = f.runtime.services.db.prepare('SELECT value FROM ' + t).all() as {
        value: string
      }[]
      expect(rows.map((r) => JSON.parse(r.value))).toContainEqual(rich)
    }
    expect(
      (await f.call('/api/threads/state/exchange', request([version], 'old-client'))).status,
    ).toBe(200)
    const conflict = { ...rich, value: { ...rich.value, projectName: 'Unrelated change' } }
    expect(
      (await f.call('/api/threads/state/exchange', request([conflict], 'broken-client'))).status,
    ).toBe(400)
    await f.close()
    f = await fixture(path)
    expect(f.runtime.services.runtimeId).toBe(identity)
    expect(f.runtime.services.threadReplication.replicas()[0].spawnParent).toEqual(
      rich.value.parent,
    )
  } finally {
    await f.close()
    await rm(dir, { recursive: true, force: true })
  }
})
