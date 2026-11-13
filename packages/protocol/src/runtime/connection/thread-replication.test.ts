import { expect, it } from 'vite-plus/test'
import type { Task } from '../../workspace.js'
import { DurableState } from '@dovo/durable-connections'
import {
  decodeThreadRecord,
  validateThreadVersion,
  threadReplicationChannel,
  threadRecordKey,
  threadReplicaId,
  replicatedThread,
  replicatedThreadList,
  mergeThreadReplicaPage,
  preferredThreadCopies,
  type ThreadRecord,
  type ThreadVersion,
} from './thread-replication.js'

const identity = { ownerRuntimeId: 'owner', threadId: 'thread' }
function version(value: ThreadRecord, updatedAt = 100): ThreadVersion & { deleted: false } {
  return {
    key: threadRecordKey(value),
    value,
    updatedAt,
    changeId: 'writer:' + updatedAt,
    deleted: false,
  }
}
function records(count = 85): ReturnType<typeof version>[] {
  return [
    version({
      ...identity,
      kind: 'thread',
      ownerName: 'Owner',
      projectName: 'Project',
      createdAt: '2026-01-01',
      status: 'review',
      historyRevision: 0,
      removed: false,
    }),
    version({ ...identity, kind: 'title', value: 'Thread' }),
    ...Array.from({ length: count }, (_, position) =>
      version({
        ...identity,
        kind: 'message',
        messageId: 'message-' + position,
        position,
        message: { id: 'message-' + position, role: 'assistant', text: 'Message ' + position },
      }),
    ),
  ]
}
function project(values = records(), before?: string) {
  const task = replicatedThread(values, 'owner', 'thread', before)
  if (!task) throw Error('Missing fixture')
  return task
}
it('namespaces stable replica IDs by runtime and original thread without separator collisions', () => {
  expect(threadReplicaId('owner', 'thread')).toBe(threadReplicaId('owner', 'thread'))
  expect(threadReplicaId('a:b', 'c')).not.toBe(threadReplicaId('a', 'b:c'))
  expect(threadReplicaId('another', 'thread')).not.toBe(threadReplicaId('owner', 'thread'))
  expect(threadReplicaId('a'.repeat(200), 'b'.repeat(200)).length).toBeLessThan(200)
})
it('pages by stable message IDs, merges overlap and preserves older history on metadata refresh', () => {
  const values = records()
  const latest = project(values)
  expect(latest.messages).toHaveLength(40)
  const older = project(values, latest.historyBefore)
  const merged = mergeThreadReplicaPage(latest, older, true)
  expect(merged.messages).toHaveLength(80)
  expect(merged.historyBefore).toBe('message-5')
  expect(mergeThreadReplicaPage(merged, latest).messages).toHaveLength(80)
  const overview = replicatedThread(values, 'owner', 'thread', undefined, false)!
  expect(mergeThreadReplicaPage(merged, overview).historyBefore).toBe('message-5')
  const reset = { ...latest, historyRevision: 1 }
  expect(mergeThreadReplicaPage(merged, reset)).toEqual(reset)
  expect(mergeThreadReplicaPage(reset, latest)).toBe(reset)
  expect(mergeThreadReplicaPage({ ...latest, title: 'New title' }, older, true).title).toBe(
    'New title',
  )
  expect(() => project(values, 'missing')).toThrow('conversation changed')
})
it('omits removed messages and threads without treating a replay as a new message', () => {
  const values = records(3)
  const removed = values.map((entry) =>
    entry.value.kind === 'message' && entry.value.messageId === 'message-1'
      ? version({ ...entry.value, message: null }, 101)
      : entry,
  )
  expect(project(removed).messages.map((message) => message.id)).toEqual(['message-0', 'message-2'])
  expect(replicatedThreadList(removed, 'owner')).toEqual([])
  expect(replicatedThreadList(removed, 'other', [])[0].messages).toEqual([])
  const descriptor = removed[0].value
  if (descriptor.kind !== 'thread') throw Error('Missing descriptor')
  expect(
    replicatedThread([version({ ...descriptor, removed: true })], 'owner', 'thread'),
  ).toBeUndefined()
})
it('rejects mismatched register keys and message identities', () => {
  const entry = records(1).at(-1)!
  expect(() => validateThreadVersion({ ...entry, key: 'forged' })).toThrow('Invalid replicated')
  const value = entry.value
  if (value.kind !== 'message' || !value.message) throw Error('Missing message')
  const changed = { ...value, message: { ...value.message, id: 'other' } }
  expect(() =>
    validateThreadVersion({
      ...entry,
      value: changed,
    }),
  ).toThrow('identity changed')
})
it('selects one reachable copy and prefers the owning runtime while keeping distinct owners', () => {
  const copy = project(records(1))
  const original = { ...copy, id: 'thread', replica: undefined }
  const second = { ...original, title: 'Different owner' }
  const source = (runtimeId: string, connected: boolean, tasks: Task[]) => ({
    runtimeId,
    connected,
    tasks,
  })
  expect([
    ...preferredThreadCopies([
      source('owner', true, [original]),
      source('other', true, [copy]),
      source('third', true, [second]),
    ]),
  ]).toEqual([original, second])
  expect([
    ...preferredThreadCopies([source('owner', false, [original]), source('other', true, [copy])]),
  ]).toEqual([copy])
  expect([
    ...preferredThreadCopies([source('owner', false, [original]), source('other', false, [copy])]),
  ]).toEqual([original])
  // A cached Bot original wins over a plain copy an earlier build shared, also while its home
  // runtime is offline; ordinary threads keep the reachable-copy rule above.
  const bot = {
    ...original,
    bot: {
      role: 'Helper',
      responsibilities: '',
      state: 'active' as const,
      revision: '00000000-0000-4000-8000-000000000000',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  }
  expect([
    ...preferredThreadCopies([source('owner', false, [bot]), source('other', true, [copy])]),
  ]).toEqual([bot])
  expect([
    ...preferredThreadCopies([source('other', true, [copy]), source('owner', true, [bot])]),
  ]).toEqual([bot])
})
it('deterministically resolves concurrent field edits and retains both versions', async () => {
  const open = (replicaId: string) =>
    DurableState.open({
      channel: threadReplicationChannel,
      replicaId,
      now: () => 100,
      storage: { load: () => undefined, save: () => {} },
      decode: decodeThreadRecord,
      validateVersion: validateThreadVersion,
    })
  const a = await open('a'),
    b = await open('b')
  try {
    const title: ThreadRecord = { ...identity, kind: 'title', value: 'A' }
    await a.set(threadRecordKey(title), title)
    await b.set(threadRecordKey(title), { ...title, value: 'B' })
    const pin: ThreadRecord = { ...identity, kind: 'pinned', value: true }
    await a.set(threadRecordKey(pin), pin)
    await a.accept(await b.exchange(a.request()))
    await b.accept(await a.exchange(b.request()))
    expect(a.get(threadRecordKey(title))).toEqual({ ...title, value: 'B' })
    expect(b.get(threadRecordKey(title))).toEqual(a.get(threadRecordKey(title)))
    expect(b.get(threadRecordKey(pin))).toEqual(pin)
    expect(a.history(threadRecordKey(title))).toHaveLength(2)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

it('replaces a disconnected tail after an offline gap and loads older messages in order', () => {
  const cached = project(records(85))
  const values = records(185)
  const latest = project(values)
  const reconnected = mergeThreadReplicaPage(cached, latest)
  expect(reconnected.messages.map((message) => message.id)).toEqual(
    latest.messages.map((message) => message.id),
  )
  const older = project(values, reconnected.historyBefore)
  const merged = mergeThreadReplicaPage(reconnected, older, true)
  expect(merged.messages.map((message) => Number(message.id.slice(8)))).toEqual(
    Array.from({ length: 80 }, (_, i) => i + 105),
  )
  expect(merged.historyBefore).toBe('message-105')
})

it('repairs only the historical missing-parent encoding and converges in both directions', async () => {
  const { recoverThreadParentVersion } = await import('./thread-replication.js')
  const bare = records(0)[0]
  if (bare.value.kind !== 'thread') throw Error('Expected descriptor')
  const rich = {
    ...bare,
    value: { ...bare.value, parent: { runtimeId: 'owner', threadId: 'parent' } },
  }
  expect(recoverThreadParentVersion(bare, rich)).toEqual(rich)
  expect(recoverThreadParentVersion(rich, bare)).toEqual(rich)
  for (const changed of [
    { ...rich, updatedAt: rich.updatedAt + 1 },
    { ...rich, changeId: 'different' },
    { ...rich, value: { ...rich.value, projectName: 'Changed' } },
    { ...rich, value: { ...rich.value, removed: true } },
  ])
    expect(recoverThreadParentVersion(bare, changed)).toBeUndefined()
  expect(
    recoverThreadParentVersion(rich, {
      ...rich,
      value: { ...rich.value, parent: { runtimeId: 'other', threadId: 'parent' } },
    }),
  ).toBeUndefined()
  const open = (replicaId: string) =>
    DurableState.open({
      channel: threadReplicationChannel,
      replicaId,
      storage: { load: () => undefined, save: () => {} },
      decode: decodeThreadRecord,
      validateVersion: validateThreadVersion,
      recoverVersion: recoverThreadParentVersion,
    })
  const a = await open('a'),
    b = await open('b')
  await a.importVersions([bare])
  await b.importVersions([rich])
  const before = a.dataRevision
  await a.accept(await b.exchange(a.request()))
  expect(a.versions()).toEqual([rich])
  expect(a.dataRevision).toBeGreaterThan(before)
  await b.accept(await a.exchange(b.request()))
  expect(b.versions()).toEqual([rich])
  expect(a.revision).toBe(1)
  expect(b.revision).toBe(1)
  await Promise.all([a.close(), b.close()])
})

it('keeps equal replica rows stable when the active computer or fleet order changes', () => {
  const a = project(records(1)),
    b = structuredClone(a)
  const first = { runtimeId: 'a', connected: true, tasks: [a] },
    second = { runtimeId: 'b', connected: true, tasks: [b] }
  expect([...preferredThreadCopies([first, second])]).toEqual([a])
  expect([...preferredThreadCopies([second, first])]).toEqual([a])
  const newer = { ...b, updatedAt: '2026-11-09T00:00:00Z' }
  expect([...preferredThreadCopies([first, { ...second, tasks: [newer] }])]).toEqual([newer])
})
