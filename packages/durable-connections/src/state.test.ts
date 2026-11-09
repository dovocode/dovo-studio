import { expect, it, vi, afterEach } from 'vite-plus/test'
import { Schema } from 'effect'
import {
  DurableState,
  StateGapError,
  StateProtocolError,
  startReplication,
  type StateStorage,
  type StateRequest,
  type StateVersion,
  jsonStateStorage,
} from './index.js'

function memory() {
  let saved: unknown
  return {
    load: () => structuredClone(saved),
    save: vi.fn<(snapshot: unknown) => void>((snapshot) => {
      saved = structuredClone(snapshot)
    }),
  } satisfies StateStorage
}
const decode = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Expected string state')
  return value
}
const open = (replicaId: string, storage: StateStorage = memory(), now = () => 100) =>
  DurableState.open({ channel: 'test', replicaId, storage, decode, now, batchSize: 2 })
async function sync(a: DurableState<string>, b: DurableState<string>) {
  let peer: string | undefined
  let sentThrough = 0
  for (let count = 0; count < 100; count++) {
    const result = await a.accept(await b.exchange(a.request(peer, sentThrough)))
    peer = result.peer
    sentThrough = result.sentThrough
    if (!result.more) return
  }
  throw new Error('Replication did not settle')
}
afterEach(() => vi.useRealTimers())

it('resumes a learned peer actor after reconnect and process restart', async () => {
  const storage = memory()
  let client = await open('client', storage)
  const server = await open('host:restore:generation')
  await server.set('value', 'retained')
  const pulls: Array<{ source?: string; after: number }> = []
  const worker = (state: DurableState<string>) =>
    startReplication({
      state,
      peerId: 'host',
      intervalMs: null,
      exchange: async (request) => {
        pulls.push(request.pull)
        return server.exchange(request)
      },
      onError: (error) => {
        throw error
      },
    })
  let connection = worker(client)
  try {
    await vi.waitFor(() => expect(client.sourceFor('host')).toBe(server.replicaId))
    await vi.waitFor(() => expect(pulls.at(-1)).toEqual({ source: server.replicaId, after: 1 }))
    const checkpoint = pulls.length
    connection.restart()
    await vi.waitFor(() => expect(pulls.length).toBeGreaterThan(checkpoint))
    expect(pulls[checkpoint]).toEqual({ source: server.replicaId, after: 1 })
    await connection.stop()
    await client.close()
    client = await open('client', storage)
    const restarted = pulls.length
    connection = worker(client)
    await vi.waitFor(() => expect(pulls.length).toBeGreaterThan(restarted))
    expect(pulls[restarted]).toEqual({ source: server.replicaId, after: 1 })
    expect(client.get('value')).toBe('retained')
  } finally {
    await connection.stop()
    await client.close()
    await server.close()
  }
})

it('publishes peer actor changes across independent transactional storage owners', async () => {
  const shared = transactional()
  const options = {
    channel: 'test',
    storage: shared.storage,
    createReplicaId: () => 'client',
    decode,
  }
  const a = await DurableState.openPersisted(options),
    b = await DurableState.openPersisted(options)
  const server = await open('restored-host')
  try {
    await server.set('value', 'shared')
    await a.receive(server.batch(), 'host')
    await b.refresh()
    expect(b.request('host').pull).toEqual({ source: 'restored-host', after: 1 })
    expect(b.get('value')).toBe('shared')
  } finally {
    await a.close()
    await b.close()
    await server.close()
  }
})

it('does not derive recovery records from an ignored replayed prefix with changed identities', async () => {
  const source = await open('source')
  const owner = await DurableState.open({
    channel: 'test',
    replicaId: 'owner',
    storage: memory(),
    decode,
    acceptVersion: () => false,
    additionalVersions: (versions) =>
      versions.map((version) => ({ ...version, key: `recovered:${version.key}` })),
  })
  try {
    await source.set('message', 'original')
    const batch = source.batch()
    await owner.receive(batch)
    const replay = structuredClone(batch)
    replay.changes[0].version.changeId = 'changed-identity'
    replay.changes[0].version.key = 'injected'
    await owner.receive(replay)
    expect(owner.get('recovered:injected')).toBeUndefined()
    expect(owner.get('recovered:message')).toBe('original')
    expect(owner.revision).toBe(1)
    expect(owner.checkpoint('source')).toBe(1)
  } finally {
    await owner.close()
    await source.close()
  }
})

it('commits recovery versions with their source checkpoint and leaves all state unchanged on save failure', async () => {
  const source = await open('source')
  const storage = memory()
  let unavailable = true
  const owner = await DurableState.open({
    channel: 'test',
    replicaId: 'owner',
    decode,
    storage: {
      load: storage.load,
      save: (value) => {
        if (unavailable) throw new Error('disk full')
        storage.save(value)
      },
    },
    additionalVersions: (versions) =>
      versions.map((version) => ({ ...version, key: `recovered:${version.key}` })),
  })
  try {
    await source.set('message', 'Keep me')
    await expect(owner.receive(source.batch(), 'host')).rejects.toThrow('disk full')
    expect(owner.latest()).toEqual([])
    expect(owner.checkpoint('source')).toBe(0)
    expect(owner.sourceFor('host')).toBe('host')
    unavailable = false
    await owner.receive(source.batch(), 'host')
    expect(owner.get('message')).toBe('Keep me')
    expect(owner.get('recovered:message')).toBe('Keep me')
    expect(owner.checkpoint('source')).toBe(1)
    expect(owner.sourceFor('host')).toBe('source')
    await owner.receive(source.batch())
    expect(owner.revision).toBe(2)
  } finally {
    await owner.close()
    await source.close()
  }
})

it('advances ignored echo checkpoints durably without accepting them into authoritative state', async () => {
  const source = await open('source')
  const storage = memory()
  const options = {
    channel: 'test',
    replicaId: 'owner',
    storage,
    decode,
    acceptVersion: (version: import('./state.js').StateVersion<string>) =>
      version.key !== 'private',
  }
  const owner = await DurableState.open(options)
  try {
    await source.set('private', 'peer-only history')
    await source.set('shared', 'shared value')
    const batch = source.batch()
    await owner.receive(batch)
    expect(owner.get('private')).toBeUndefined()
    expect(owner.get('shared')).toBe('shared value')
    expect(owner.checkpoint('source')).toBe(2)
    await owner.receive(batch)
    expect(owner.revision).toBe(1)
    await owner.close()
    const reopened = await DurableState.open(options)
    await reopened.receive(batch)
    expect(reopened.checkpoint('source')).toBe(2)
    expect(reopened.get('private')).toBeUndefined()
    expect(reopened.revision).toBe(1)
    await reopened.close()
  } finally {
    await owner.close()
    await source.close()
  }
})

function transactional() {
  let raw: string | null = null
  let tail = Promise.resolve()
  const adapter = {
    read: () => raw,
    write: (value: string) => {
      raw = value
    },
    update: vi.fn<(change: (current: string | null) => string) => Promise<string>>((change) => {
      const result = tail.then(() => {
        const next = change(raw)
        raw = next
        return next
      })
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    }),
  }
  return { adapter, storage: jsonStateStorage(adapter) }
}

it('shares one persisted identity across owners and retains concurrent writes with unique revisions', async () => {
  const { storage } = transactional()
  const options = { channel: 'test', storage, decode, now: () => 100 }
  const [a, b] = await Promise.all([
    DurableState.openPersisted({ ...options, createReplicaId: () => 'a' }),
    DurableState.openPersisted({ ...options, createReplicaId: () => 'b' }),
  ])
  expect(a.replicaId).toBe(b.replicaId)
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      (index % 2 ? a : b).set(`key-${index}`, String(index)),
    ),
  )
  await Promise.all([a.refresh(), b.refresh()])
  expect(a.latest()).toEqual(b.latest())
  expect(a.revision).toBe(20)
  expect(new Set(a.versions().map((entry) => entry.changeId)).size).toBe(20)
  expect(a.versions().map((entry) => entry.updatedAt)).toEqual(
    Array.from({ length: 20 }, (_, index) => 100 + index),
  )
  const restarted = await DurableState.openPersisted({
    ...options,
    createReplicaId: () => 'unexpected',
  })
  expect(restarted.replicaId).toBe(a.replicaId)
  expect(restarted.latest()).toEqual(a.latest())
})

it('keeps transactional failures invisible and rebases peer receipts without losing other owners edits', async () => {
  const { storage, adapter } = transactional()
  const options = { channel: 'test', storage, decode, createReplicaId: () => 'app' }
  const a = await DurableState.openPersisted(options),
    b = await DurableState.openPersisted(options)
  const peer = await open('peer')
  await peer.set('remote', 'received')
  const notify = vi.fn<() => void>()
  a.subscribe(notify)
  adapter.update.mockRejectedValueOnce(new Error('Disk full'))
  await expect(a.receive(peer.batch())).rejects.toThrow('Disk full')
  expect(a.checkpoint('peer')).toBe(0)
  expect(notify).not.toHaveBeenCalled()
  await Promise.all([a.receive(peer.batch()), b.set('local', 'concurrent')])
  await a.refresh()
  expect(a.get('local')).toBe('concurrent')
  expect(a.get('remote')).toBe('received')
  expect(a.checkpoint('peer')).toBe(1)
  const committed: unknown = await storage.load()
  adapter.write(
    JSON.stringify({
      protocol: 1,
      channel: 'test',
      replicaId: 'app',
      journal: [],
      checkpoints: {},
    }),
  )
  await expect(a.refresh()).rejects.toThrow('history changed')
  adapter.write(JSON.stringify(committed))
  await a.refresh()
  expect(a.revision).toBe(2)
  if (!committed || typeof committed !== 'object') throw new Error('Expected committed snapshot')
  adapter.write(JSON.stringify({ ...committed, checkpoints: {} }))
  await expect(a.refresh()).rejects.toThrow('checkpoints changed')
  adapter.write(JSON.stringify(committed))
  await a.refresh()
})

it('wakes caught-up sessions for local edits or explicit refresh without idle polling, and unsubscribes on stop', async () => {
  vi.useFakeTimers()
  const a = await open('a'),
    b = await open('b')
  const exchange = vi.fn<(request: StateRequest<string>) => Promise<unknown>>((request) =>
    b.exchange(request),
  )
  const errors = vi.fn<(error: Error) => void>()
  const session = startReplication({ state: a, exchange, onError: errors, intervalMs: null })
  await vi.advanceTimersByTimeAsync(0)
  const idle = exchange.mock.calls.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(exchange).toHaveBeenCalledTimes(idle)
  await a.set('draft', 'new')
  await vi.advanceTimersByTimeAsync(0)
  expect(b.get('draft')).toBe('new')
  await b.set('remote', 'fetch me')
  session.wake()
  await vi.advanceTimersByTimeAsync(0)
  expect(a.get('remote')).toBe('fetch me')
  await session.stop()
  const stopped = exchange.mock.calls.length
  await a.set('after', 'stopped')
  session.wake()
  await vi.advanceTimersByTimeAsync(60000)
  expect(exchange).toHaveBeenCalledTimes(stopped)
  expect(errors).not.toHaveBeenCalled()
})

it('converges concurrent edits in either order, retains losers, and advances beyond observed clocks', async () => {
  const a = await open('a'),
    b = await open('b')
  await a.set('theme', 'light')
  await b.set('theme', 'dark')
  const first = a.batch(),
    second = b.batch()
  await a.receive(second)
  await b.receive(first)
  expect(a.get('theme')).toBe('dark')
  expect(a.latest()).toEqual(b.latest())
  expect(a.history('theme').map((version) => version.value)).toEqual(['dark', 'light'])
  await a.set('theme', 'system')
  await sync(a, b)
  expect(b.get('theme')).toBe('system')
  expect(b.history('theme')[0].updatedAt).toBe(101)
})

it('publishes and acknowledges only durable commits; failed storage is retryable', async () => {
  const storage = memory()
  const a = await open('a'),
    b = await open('b', storage)
  const subscriber = vi.fn<() => void>()
  b.subscribe(subscriber)
  await a.set('draft', 'recover me')
  storage.save.mockImplementationOnce(() => {
    throw new Error('Disk full')
  })
  await expect(b.receive(a.batch())).rejects.toThrow('Disk full')
  expect(b.get('draft')).toBeUndefined()
  expect(b.checkpoint('a')).toBe(0)
  expect(subscriber).not.toHaveBeenCalled()
  await b.receive(a.batch())
  expect(b.get('draft')).toBe('recover me')
  expect(b.checkpoint('a')).toBe(1)
  expect(subscriber).toHaveBeenCalledTimes(1)
  const restarted = await open('b', storage)
  expect(restarted.get('draft')).toBe('recover me')
  expect(restarted.checkpoint('a')).toBe(1)
})

it('replays a lost response without duplicate versions and drains incremental batches', async () => {
  const a = await open('a'),
    b = await open('b')
  for (let index = 0; index < 7; index++) await a.set(`key-${index}`, `${index}`)
  const request = a.request()
  await b.exchange(request) // response is lost after the commit
  const replay = await b.exchange(request)
  expect(replay.accepted.through).toBe(2)
  expect(b.revision).toBe(2)
  await sync(a, b)
  expect(b.latest()).toEqual(a.latest())
  expect(b.revision).toBe(7)
  expect(b.batch(b.revision).changes).toEqual([])
  const saves = memory()
  const c = await open('c', saves)
  await c.receive(a.batch())
  const calls = saves.save.mock.calls.length
  await c.receive(a.batch())
  expect(saves.save).toHaveBeenCalledTimes(calls)
})

it('replicates deletion and restores a previous version with a new revision', async () => {
  const a = await open('a'),
    b = await open('b')
  const original = await a.set('draft', 'text')
  await sync(a, b)
  await a.delete('draft')
  await sync(a, b)
  expect(b.get('draft')).toBeUndefined()
  expect(b.history('draft')[0].deleted).toBe(true)
  await b.restoreVersion(original)
  await sync(b, a)
  expect(a.get('draft')).toBe('text')
  expect(a.history('draft')).toHaveLength(3)
})

it('rejects gaps, malformed batches, changed identities and invalid values atomically', async () => {
  const a = await open('a'),
    b = await open('b')
  await a.set('x', 'first')
  await a.set('x', 'second')
  await expect(b.receive(a.batch(1))).rejects.toBeInstanceOf(StateGapError)
  const batch = a.batch()
  expect(() => b.receive({ ...batch, channel: 'other' })).toThrow(StateProtocolError)
  expect(() => b.receive({ ...batch, through: 4 })).toThrow('contiguous')
  expect(() =>
    b.receive({
      ...batch,
      changes: [
        batch.changes[0],
        { sequence: 2, version: { ...batch.changes[1].version, value: 5 } },
      ],
    }),
  ).toThrow('Expected string')
  expect(b.revision).toBe(0)
  await expect(b.exchange({ batch, pull: { source: 'b', after: 999 } })).rejects.toThrow('ahead')
  expect(b.revision).toBe(0)
  await b.receive(batch)
  await expect(
    b.receive({
      ...batch,
      changes: [
        { ...batch.changes[0], version: { ...batch.changes[0].version, value: 'forged' } },
        batch.changes[1],
      ],
    }),
  ).rejects.toThrow('reused')
  expect(b.get('x')).toBe('second')
  const storage = memory()
  storage.save({ protocol: 999 })
  await expect(open('b', storage)).rejects.toThrow('Stored state')
})

it('serializes concurrent edits, isolates values, and stops accepting writes after close', async () => {
  const a = await open('a')
  await Promise.all(Array.from({ length: 20 }, (_, index) => a.set('counter', String(index))))
  expect(a.get('counter')).toBe('19')
  expect(new Set(a.versions().map((version) => version.changeId)).size).toBe(20)
  const detached = a.versions()
  detached[0].key = 'changed'
  expect(a.history('counter')).toHaveLength(20)
  await a.close()
  await expect(a.set('counter', 'closed')).rejects.toThrow('closed')
})

it('converges three offline replicas through a partial mesh, without replication loops', async () => {
  const replicas = await Promise.all(['a', 'b', 'c'].map((id) => open(id)))
  for (let index = 0; index < 30; index++)
    await replicas[index % 3].set(`key-${index % 5}`, String(index))
  for (let round = 0; round < 3; round++) {
    await sync(replicas[0], replicas[1])
    await sync(replicas[1], replicas[2])
  }
  expect(replicas[0].latest()).toEqual(replicas[2].latest())
  expect(replicas.map((state) => state.revision)).toEqual([30, 30, 30])
  await sync(replicas[2], replicas[0])
  expect(replicas.map((state) => state.revision)).toEqual([30, 30, 30])
})

it('retries offline transport and stops its timer', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const a = await open('a'),
    b = await open('b')
  await a.set('draft', 'offline edit')
  let online = false
  const errors = vi.fn<(error: Error) => void>()
  const exchange = vi.fn<(request: StateRequest<string>) => Promise<unknown>>(async (request) => {
    if (!online) throw new Error('Offline')
    return b.exchange(request)
  })
  const session = startReplication({ state: a, exchange, onError: errors, intervalMs: 1000 })
  await vi.advanceTimersByTimeAsync(0)
  expect(errors).toHaveBeenCalledTimes(1)
  online = true
  await vi.advanceTimersByTimeAsync(1000)
  expect(b.get('draft')).toBe('offline edit')
  await session.stop()
  const calls = exchange.mock.calls.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(exchange).toHaveBeenCalledTimes(calls)
  vi.restoreAllMocks()
})

it('ignores a late reply after cancellation, even when a transport fails to abort', async () => {
  vi.useFakeTimers()
  const a = await open('a'),
    b = await open('b')
  await b.set('remote', 'must not enter the cancelled session')
  let deliver: ((response: unknown) => void) | undefined
  const reply = await b.exchange(a.request())
  const session = startReplication({
    state: a,
    exchange: () =>
      new Promise<unknown>((resolve) => {
        deliver = resolve
      }),
    onError: (error) => {
      throw error
    },
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(deliver).toBeDefined()
  await session.stop()
  deliver?.(reply)
  await vi.advanceTimersByTimeAsync(0)
  expect(a.get('remote')).toBeUndefined()
})

it('backs off an acknowledgement that makes no progress instead of spinning', async () => {
  vi.useFakeTimers()
  const a = await open('a'),
    b = await open('b')
  await a.set('draft', 'pending')
  const errors = vi.fn<(error: Error) => void>()
  const exchange = vi.fn<() => Promise<unknown>>(async () => ({
    batch: b.batch(),
    accepted: { source: 'a', through: 0 },
  }))
  const session = startReplication({ state: a, exchange, onError: errors })
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledTimes(1)
  expect(errors.mock.calls[0][0].message).toContain('acknowledge')
  await session.stop()
})

it('adapts string stores and structured schemas without native/browser-specific cloning APIs', async () => {
  let saved: string | undefined
  const storage = jsonStateStorage({
    read: () => saved,
    write: (value) => {
      saved = value
    },
  })
  const decodeObject = (value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('title' in value) ||
      typeof value.title !== 'string'
    )
      throw new Error('Expected title')
    return { title: value.title }
  }
  const state = await DurableState.open({
    channel: 'documents',
    replicaId: 'document-owner',
    storage,
    decode: decodeObject,
  })
  const value = { title: 'Original' }
  const writing = state.set('draft', value)
  value.title = 'Changed by caller'
  await writing
  expect(state.get('draft')).toEqual({ title: 'Original' })
  const returned = state.get('draft')!
  returned.title = 'Changed by reader'
  expect(state.get('draft')).toEqual({ title: 'Original' })
  await state.close()
  const restarted = await DurableState.open({
    channel: 'documents',
    replicaId: 'document-owner',
    storage,
    decode: decodeObject,
  })
  expect(restarted.get('draft')).toEqual({ title: 'Original' })
})

it.each(['receive', 'import', 'open'] as const)(
  'rejects lossy schema decoding during %s before it can corrupt an immutable version',
  async (operation) => {
    const decodeDocument = (value: unknown) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('title' in value) ||
        typeof value.title !== 'string'
      )
        throw new Error('Expected document')
      Reflect.deleteProperty(value, 'parent')
      return { title: value.title }
    }
    const version = {
      key: 'subagent',
      updatedAt: 100,
      changeId: 'owner:100',
      deleted: false as const,
      value: { title: 'Subagent', parent: { runtimeId: 'owner', threadId: 'parent' } },
    }
    const storage = memory()
    const snapshot = {
      protocol: 1,
      channel: 'documents',
      replicaId: 'legacy',
      journal: [{ sequence: 1, version }],
      checkpoints: {},
    }
    if (operation === 'open') storage.save(snapshot)
    storage.save.mockClear()
    const storedBefore = storage.load()
    const options = {
      channel: 'documents',
      replicaId: 'legacy',
      storage,
      decode: decodeDocument,
    }
    const state = operation === 'open' ? undefined : await DurableState.open(options)
    try {
      await expect(
        (async () => {
          if (operation === 'open') await DurableState.open(options)
          else if (operation === 'import') await state?.importVersions([version])
          else
            await state?.receive({
              protocol: 1,
              channel: 'documents',
              source: 'owner',
              after: 0,
              through: 1,
              more: false,
              changes: snapshot.journal,
            })
        })(),
      ).rejects.toThrow('State schema would change immutable version data')
      expect(storage.save).not.toHaveBeenCalled()
      expect(state?.revision ?? 0).toBe(0)
      expect(state?.checkpoint('owner') ?? 0).toBe(0)
      expect(version.value.parent).toEqual({ runtimeId: 'owner', threadId: 'parent' })
      expect(storage.load()).toEqual(storedBefore)
    } finally {
      await state?.close()
    }
  },
)

it('rejects a validator that rewrites version identity without poisoning a later valid import', async () => {
  const storage = memory()
  let changeIdentity = true
  const state = await DurableState.open({
    channel: 'test',
    replicaId: 'receiver',
    storage,
    decode,
    validateVersion: (version) => {
      if (changeIdentity) version.changeId = 'rewritten'
    },
  })
  const version = {
    key: 'retained',
    updatedAt: 100,
    changeId: 'owner:100',
    deleted: false as const,
    value: 'Original',
  }
  try {
    await expect(async () => state.importVersions([version])).rejects.toThrow(
      'State schema would change immutable version data',
    )
    expect(version.changeId).toBe('owner:100')
    expect(state.revision).toBe(0)
    expect(storage.save).not.toHaveBeenCalled()
    changeIdentity = false
    await state.importVersions([version])
    expect(state.history('retained')).toEqual([version])
  } finally {
    await state.close()
  }
})

it('retries a rejected batch after a schema upgrade, retaining drafts, parent metadata and one copy per version', async () => {
  const legacySchema = Schema.Struct({ title: Schema.String })
  const currentSchema = Schema.Struct({
    title: Schema.String,
    parent: Schema.optional(Schema.Struct({ runtimeId: Schema.String, threadId: Schema.String })),
  })
  const options = {
    channel: 'documents',
    storage: memory(),
    decode: Schema.decodeUnknownSync(currentSchema),
  }
  const owner = await DurableState.open({ ...options, replicaId: 'owner' })
  const storage = memory()
  const appOptions = { ...options, replicaId: 'app', storage }
  const legacy = await DurableState.open({
    ...appOptions,
    decode: Schema.decodeUnknownSync(legacySchema),
  })
  let upgraded: DurableState<Schema.Schema.Type<typeof currentSchema>> | undefined
  try {
    await legacy.set('draft', { title: 'Keep this offline draft' })
    await owner.set('ordinary', { title: 'Ordinary thread' })
    const subagent = {
      title: 'Subagent',
      parent: { runtimeId: 'owner', threadId: 'parent' },
    }
    await owner.set('subagent', subagent)
    const batch = owner.batch()
    const before = storage.load()
    await expect(async () => legacy.receive(batch, 'paired-owner')).rejects.toThrow(
      'State schema would change immutable version data',
    )
    expect(storage.load()).toEqual(before)
    expect(legacy.get('ordinary')).toBeUndefined()
    expect(legacy.checkpoint('owner')).toBe(0)
    expect(legacy.sourceFor('paired-owner')).toBe('paired-owner')
    await legacy.close()
    upgraded = await DurableState.open(appOptions)
    await upgraded.receive(batch, 'paired-owner')
    await upgraded.receive(batch, 'paired-owner')
    await owner.accept(await upgraded.exchange(owner.request()))
    expect(upgraded.get('draft')).toEqual({ title: 'Keep this offline draft' })
    expect(upgraded.get('subagent')).toEqual(subagent)
    expect(upgraded.history('subagent')).toHaveLength(1)
    expect(upgraded.checkpoint('owner')).toBe(2)
    expect(upgraded.sourceFor('paired-owner')).toBe('owner')
    expect(upgraded.latest()).toEqual(owner.latest())
  } finally {
    await Promise.all([owner.close(), legacy.close(), upgraded?.close()])
  }
})

it('bounds UTF-8 batch sizes and rejects values that could never leave the replica', async () => {
  const state = await DurableState.open({
    channel: 'bytes',
    replicaId: 'a',
    storage: memory(),
    decode,
    maxBatchBytes: 4096,
  })
  await state.set('one', '🍏'.repeat(600))
  await state.set('two', '🍊'.repeat(600))
  const batch = state.batch()
  expect(batch.changes).toHaveLength(1)
  expect(batch.more).toBe(true)
  expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThanOrEqual(4096)
  await expect(state.set('too-big', '🍇'.repeat(2000))).rejects.toThrow('byte limit')
  expect(state.revision).toBe(2)
})

it('checks aggregate application constraints before persisting any received values or checkpoints', async () => {
  const a = await open('a')
  const storage = memory()
  const b = await DurableState.open({
    channel: 'test',
    replicaId: 'b',
    storage,
    decode,
    validateState: (latest) => {
      if (latest.length > 1) throw new Error('Only one key allowed')
    },
  })
  await a.set('one', 'first')
  await a.set('two', 'second')
  await expect(b.receive(a.batch())).rejects.toThrow('Only one key')
  expect(b.revision).toBe(0)
  expect(b.checkpoint('a')).toBe(0)
  expect(storage.save).not.toHaveBeenCalled()
  await b.set('valid', 'still writable')
  expect(b.get('valid')).toBe('still writable')
})

it('does not publish a pending asynchronous save or fail a committed write because of a subscriber', async () => {
  let finish: (() => void) | undefined
  const reports: unknown[] = []
  const state = await DurableState.open({
    channel: 'async',
    replicaId: 'a',
    decode,
    storage: {
      load: () => undefined,
      save: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    },
    onListenerError: (error) => reports.push(error),
  })
  state.subscribe(() => {
    throw new Error('UI failed')
  })
  const write = state.set('draft', 'durable')
  await Promise.resolve()
  expect(state.get('draft')).toBeUndefined()
  expect(state.revision).toBe(0)
  finish?.()
  await write
  expect(state.get('draft')).toBe('durable')
  expect(reports).toHaveLength(1)
})

it('reads only appended records, keeps failed writes invisible, and validates incremental boundaries', async () => {
  let snapshot = {
    protocol: 1 as const,
    channel: 'test',
    replicaId: 'a',
    journal: [] as import('./state.js').StateChange<unknown>[],
    checkpoints: {} as Record<string, number>,
  }
  const decoder = vi.fn<typeof decode>(decode)
  const storage = {
    load: vi.fn<StateStorage['load']>(() => structuredClone(snapshot)),
    save: vi.fn<StateStorage['save']>(),
    readChanges: vi.fn<NonNullable<StateStorage['readChanges']>>((after) => ({
      ...structuredClone(snapshot),
      after,
      journal: structuredClone(snapshot.journal.slice(after)),
    })),
    append: vi.fn<NonNullable<StateStorage['append']>>((after, changes, checkpoints) => {
      if (after !== snapshot.journal.length) throw Error('History changed')
      snapshot = {
        ...snapshot,
        journal: [...snapshot.journal, ...structuredClone(changes)],
        checkpoints: { ...checkpoints },
      }
    }),
  }
  const state = await DurableState.open({
    channel: 'test',
    replicaId: 'a',
    storage,
    decode: decoder,
    now: () => 100,
  })
  await state.set('first', 'one')
  decoder.mockClear()
  await state.refresh()
  await state.refresh()
  expect(decoder).not.toHaveBeenCalled()
  expect(storage.load).toHaveBeenCalledTimes(1)
  expect(storage.save).not.toHaveBeenCalled()
  vi.mocked(storage.append!).mockImplementationOnce(() => {
    throw Error('Disk full')
  })
  await expect(state.set('second', 'two')).rejects.toThrow('Disk full')
  expect(state.get('second')).toBeUndefined()
  await state.set('second', 'two')
  expect(snapshot.journal).toHaveLength(2)
  snapshot.journal.push({
    sequence: 4,
    version: { key: 'bad', updatedAt: 103, changeId: 'bad', deleted: false, value: 'bad' },
  })
  await expect(state.refresh()).rejects.toThrow('sequence')
  expect(state.revision).toBe(2)
})

it('does not decode or rewrite unchanged transactional JSON state', async () => {
  const { storage, adapter } = transactional()
  const decoder = vi.fn<typeof decode>(decode)
  const state = await DurableState.openPersisted({
    channel: 'test',
    storage,
    decode: decoder,
    createReplicaId: () => 'app',
  })
  await state.set('key', 'value')
  decoder.mockClear()
  await state.refresh()
  await state.importVersions([])
  expect(decoder).not.toHaveBeenCalled()
  expect(adapter.update).toHaveBeenCalled()
})

const incompleteVersion: StateVersion<string> = {
  key: 'historical',
  updatedAt: 100,
  changeId: 'legacy:100',
  deleted: false,
  value: 'missing',
}
const completeVersion: StateVersion<string> = { ...incompleteVersion, value: 'complete' }
function recoverComplete(previous: StateVersion<string>, incoming: StateVersion<string>) {
  if (previous.value === 'missing' && incoming.value === 'complete') return incoming
  if (previous.value === 'complete' && incoming.value === 'missing') return previous
  return undefined
}

it('commits repairs and receipts atomically, preserves identity and rejects old incomplete replays', async () => {
  const storage = memory()
  const options = {
    channel: 'test',
    replicaId: 'client',
    storage,
    decode,
    recoverVersion: recoverComplete,
  }
  const state = await DurableState.open(options)
  const remote = await open('remote')
  try {
    await state.importVersions([incompleteVersion])
    await remote.importVersions([completeVersion])
    const changed = vi.fn<() => void>()
    state.subscribe(changed)
    const revision = state.dataRevision
    storage.save.mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    await expect(state.receive(remote.batch())).rejects.toThrow('Disk full')
    expect(state.history('historical')).toEqual([incompleteVersion])
    expect(state.checkpoint('remote')).toBe(0)
    expect(state.dataRevision).toBe(revision)
    expect(changed).not.toHaveBeenCalled()
    await state.receive(remote.batch())
    expect(state.history('historical')).toEqual([completeVersion])
    expect(state.revision).toBe(1)
    expect(state.checkpoint('remote')).toBe(1)
    expect(state.dataRevision).toBe(revision + 1)
    expect(changed).toHaveBeenCalledTimes(1)
    await state.importVersions([incompleteVersion])
    expect(state.history('historical')).toEqual([completeVersion])
    expect(changed).toHaveBeenCalledTimes(1)
    const reopened = await DurableState.open(options)
    try {
      expect(reopened.replicaId).toBe('client')
      expect(reopened.history('historical')).toEqual([completeVersion])
      expect(reopened.checkpoint('remote')).toBe(1)
    } finally {
      await reopened.close()
    }
  } finally {
    await Promise.all([state.close(), remote.close()])
  }
})

it('rebases a repair from another transactional owner without losing concurrent edits', async () => {
  const shared = transactional()
  const options = {
    channel: 'test',
    storage: shared.storage,
    decode,
    recoverVersion: recoverComplete,
    createReplicaId: () => 'shared',
  }
  const a = await DurableState.openPersisted(options)
  await a.importVersions([incompleteVersion])
  const b = await DurableState.openPersisted(options)
  try {
    await a.importVersions([completeVersion])
    await b.set('draft', 'Keep this work')
    expect(b.history('historical')).toEqual([completeVersion])
    await a.refresh()
    expect(a.get('draft')).toBe('Keep this work')
    expect(a.history('historical')).toEqual([completeVersion])
    expect(a.revision).toBe(2)
    expect(a.replicaId).toBe('shared')
    await expect(
      b.importVersions([{ ...completeVersion, value: 'Competing edit' }]),
    ).rejects.toThrow('reused')
    expect(b.get('draft')).toBe('Keep this work')
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

it('deduplicates an incomplete and complete version in one batch', async () => {
  const state = await DurableState.open({
    channel: 'test',
    replicaId: 'a',
    storage: memory(),
    decode,
    recoverVersion: recoverComplete,
  })
  try {
    await state.importVersions([incompleteVersion, completeVersion, incompleteVersion])
    expect(state.history('historical')).toEqual([completeVersion])
    expect(state.revision).toBe(1)
  } finally {
    await state.close()
  }
})

it('rejects a recovery callback that invents a third version without changing saved data', async () => {
  const state = await DurableState.open({
    channel: 'test',
    replicaId: 'a',
    storage: memory(),
    decode,
    recoverVersion: (_previous, incoming) =>
      incoming.deleted ? undefined : { ...incoming, value: 'Invented data' },
  })
  try {
    await state.importVersions([incompleteVersion])
    await expect(state.importVersions([completeVersion])).rejects.toThrow('reused')
    expect(state.history('historical')).toEqual([incompleteVersion])
    expect(state.revision).toBe(1)
  } finally {
    await state.close()
  }
})

it('persists receipt progress without broadcasting it as new content', async () => {
  const a = await open('a'),
    b = await open('b'),
    c = await open('c')
  try {
    await a.set('draft', 'Same content')
    await b.receive(a.batch())
    await c.importVersions(a.versions())
    const changed = vi.fn<() => void>()
    b.subscribe(changed)
    const revision = b.dataRevision
    await b.receive(c.batch(), 'other-computer')
    expect(b.checkpoint('c')).toBe(1)
    expect(b.sourceFor('other-computer')).toBe('c')
    expect(b.dataRevision).toBe(revision)
    expect(changed).not.toHaveBeenCalled()
  } finally {
    await Promise.all([a.close(), b.close(), c.close()])
  }
})

it('keeps true conflicts visible and backs off instead of looping through recovery', async () => {
  vi.useFakeTimers()
  const options = { channel: 'test', decode, storage: memory(), recoverVersion: () => undefined }
  const a = await DurableState.open({ ...options, replicaId: 'a' })
  const b = await open('b')
  const version = {
    key: 'key',
    updatedAt: 100,
    changeId: 'same-version',
    deleted: false as const,
    value: 'Original user edit',
  }
  await a.importVersions([version])
  await b.importVersions([{ ...version, value: 'Competing user edit' }])
  const exchange = vi.fn<(input: unknown) => ReturnType<typeof b.exchange>>((input) =>
    b.exchange(input),
  )
  const errors = vi.fn<(error: Error) => void>()
  const session = startReplication({ state: a, exchange, onError: errors })
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(exchange).toHaveBeenCalledTimes(2)
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining('reused') }),
    )
    expect(a.get('key')).toBe('Original user edit')
    expect(b.get('key')).toBe('Competing user edit')
    expect(a.checkpoint('b')).toBe(0)
  } finally {
    await session.stop()
    await Promise.all([a.close(), b.close()])
  }
})

it('resends repaired history to an already caught-up peer without adding a version', async () => {
  vi.useFakeTimers()
  const options = { channel: 'test', decode, recoverVersion: recoverComplete }
  const a = await DurableState.open({ ...options, replicaId: 'a', storage: memory() })
  const b = await DurableState.open({ ...options, replicaId: 'b', storage: memory() })
  await a.importVersions([incompleteVersion])
  const errors = vi.fn<(error: Error) => void>()
  const session = startReplication({
    state: a,
    exchange: (input) => b.exchange(input),
    onError: errors,
    intervalMs: null,
  })
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(b.history('historical')).toEqual([incompleteVersion])
    await a.importVersions([completeVersion])
    await vi.advanceTimersByTimeAsync(0)
    expect(b.history('historical')).toEqual([completeVersion])
    expect(a.revision).toBe(1)
    expect(b.revision).toBe(1)
    expect(errors).not.toHaveBeenCalled()
  } finally {
    await session.stop()
    await Promise.all([a.close(), b.close()])
  }
})

it('returns repaired history when a stale sender already acknowledged its journal', async () => {
  const options = { channel: 'test', decode, recoverVersion: recoverComplete }
  const a = await DurableState.open({ ...options, replicaId: 'a', storage: memory() })
  const b = await DurableState.open({ ...options, replicaId: 'b', storage: memory() })
  try {
    await a.importVersions([incompleteVersion])
    await sync(a, b)
    expect(a.checkpoint('b')).toBe(1)
    await b.importVersions([completeVersion])
    await a.accept(await b.exchange(a.request('b')))
    expect(a.history('historical')).toEqual([completeVersion])
    expect(a.revision).toBe(1)
    expect(b.revision).toBe(1)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

it('drains repaired replay pages behind an acknowledged checkpoint without looping', async () => {
  vi.useFakeTimers()
  const options = { channel: 'test', decode, recoverVersion: recoverComplete, batchSize: 1 }
  const a = await DurableState.open({ ...options, replicaId: 'a', storage: memory() })
  const b = await DurableState.open({ ...options, replicaId: 'b', storage: memory() })
  await b.set('marker', 'Keep this independent edit')
  await a.importVersions([incompleteVersion])
  await sync(a, b)
  expect(a.checkpoint('b')).toBe(2)
  await b.importVersions([completeVersion])
  const errors = vi.fn<(error: Error) => void>()
  const exchange = vi.fn<(input: StateRequest<string>) => Promise<unknown>>((input) =>
    b.exchange(input),
  )
  const session = startReplication({ state: a, exchange, onError: errors, intervalMs: null })
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(a.history('historical')).toEqual([completeVersion])
    expect(a.get('marker')).toBe('Keep this independent edit')
    expect(a.revision).toBe(2)
    expect(b.revision).toBe(2)
    expect(exchange.mock.calls.length).toBeLessThan(8)
    expect(errors).not.toHaveBeenCalled()
  } finally {
    await session.stop()
    await Promise.all([a.close(), b.close()])
  }
})
