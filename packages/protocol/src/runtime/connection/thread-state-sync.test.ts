import { afterEach, expect, it, vi } from 'vite-plus/test'
import { DurableState, type StateStorage } from '@dovo/durable-connections'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'
import { runtimeProfile } from './runtime-fleet.js'
import { ThreadStateSynchronization, type ThreadStateSyncOptions } from './thread-state-sync.js'
import {
  decodeThreadRecord,
  validateThreadVersion,
  threadReplicationChannel,
  threadRecordKey,
  type ThreadRecord,
} from './thread-replication.js'
const controllers: ThreadStateSynchronization[] = []
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()))
  vi.useRealTimers()
})
function memory() {
  let raw: unknown
  return {
    load: () => structuredClone(raw),
    save: vi.fn<(value: unknown) => void>((value) => {
      raw = structuredClone(value)
    }),
  } satisfies StateStorage
}
function target(capability = true) {
  return {
    profile: runtimeProfile({
      address: 'http://runtime.local:51464',
      token: 'paired-device-token-1234567',
      runtimeId: 'runtime',
    }),
    connected: true,
    snapshot: decode(snapshotSchema, {
      runtimeId: 'runtime',
      revision: 1,
      owner: false,
      ...(capability ? { threadReplicationVersion: 1 } : {}),
      workspace: {
        version: 1,
        runtimeAddress: '',
        agents: [],
        automations: [],
        tasks: [],
        repositories: [],
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
  }
}
async function peer(id = 'runtime') {
  return DurableState.open({
    channel: threadReplicationChannel,
    replicaId: id,
    storage: memory(),
    decode: decodeThreadRecord,
    validateVersion: validateThreadVersion,
  })
}
function harness(request: ThreadStateSyncOptions['request'], storage: StateStorage = memory()) {
  const refreshed = vi.fn<ThreadStateSyncOptions['refreshed']>(async () => {})
  const error = vi.fn<ThreadStateSyncOptions['error']>()
  const controller = new ThreadStateSynchronization({
    storage,
    createReplicaId: () => 'app:one',
    request,
    refreshed,
    error,
    intervalMs: null,
  })
  controllers.push(controller)
  return { controller, refreshed, error }
}
async function flush() {
  for (let count = 0; count < 8; count++) await vi.advanceTimersByTimeAsync(0)
}
const title: ThreadRecord = {
  ownerRuntimeId: 'runtime',
  threadId: 'thread',
  kind: 'title',
  value: 'Retained title',
}
it('persists identity before sending and never sends when initial persistence fails', async () => {
  vi.useFakeTimers()
  const storage = memory()
  storage.save.mockImplementation(() => {
    throw Error('Storage full')
  })
  const request = vi.fn<ThreadStateSyncOptions['request']>()
  const h = harness(request, storage)
  h.controller.update([target()], true)
  await flush()
  expect(request).not.toHaveBeenCalled()
  expect(h.error).toHaveBeenLastCalledWith('Storage full')
})
it('negotiates capability and retains identity and cursors across app restarts', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  await runtime.set(threadRecordKey(title), title)
  const storage = memory()
  const request = vi.fn<ThreadStateSyncOptions['request']>((_profile, _path, input) =>
    runtime.exchange(input),
  )
  const h = harness(request, storage)
  h.controller.update([target(false)], true)
  await flush()
  expect(request).not.toHaveBeenCalled()
  h.controller.update([target()], true)
  await flush()
  expect(h.refreshed).toHaveBeenCalled()
  await h.controller.stop()
  request.mockClear()
  const restarted = harness(request, storage)
  restarted.controller.update([target()], true)
  await flush()
  expect(request.mock.calls[0]?.[2]).toMatchObject({
    batch: { source: 'app:one' },
    pull: { source: 'runtime', after: 1 },
  })
  await runtime.close()
})
it('retries a lost response, keeps one version, and does not poll an idle manual connection', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  await runtime.set(threadRecordKey(title), title)
  let lose = true
  const request = vi.fn<ThreadStateSyncOptions['request']>(async (_profile, _path, input) => {
    const reply = await runtime.exchange(input)
    if (lose) {
      lose = false
      throw Error('Lost reply')
    }
    return reply
  })
  const storage = memory()
  const h = harness(request, storage)
  h.controller.update([target()], true)
  await flush()
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('Lost reply'))
  h.controller.retry()
  await flush()
  expect(h.refreshed).toHaveBeenCalled()
  const count = request.mock.calls.length
  await vi.advanceTimersByTimeAsync(120000)
  expect(request).toHaveBeenCalledTimes(count)
  const reopened = await DurableState.openPersisted({
    channel: threadReplicationChannel,
    createReplicaId: () => 'unused',
    storage,
    decode: decodeThreadRecord,
    validateVersion: validateThreadVersion,
  })
  expect(reopened.history(threadRecordKey(title))).toHaveLength(1)
  await reopened.close()
  await runtime.close()
})
it.each(['remove', 'replace', 'background'] as const)(
  'discards late responses after %s',
  async (change) => {
    vi.useFakeTimers()
    const runtime = await peer(),
      app = await peer('app:one')
    await runtime.set(threadRecordKey(title), title)
    const response = await runtime.exchange(app.request())
    let deliver: ((value: unknown) => void) | undefined
    const request = vi.fn<ThreadStateSyncOptions['request']>(
      () =>
        new Promise((resolve) => {
          deliver = resolve
        }),
    )
    const storage = memory()
    const h = harness(request, storage)
    const old = target()
    h.controller.update([old], true)
    await flush()
    const late = deliver
    expect(late).toBeDefined()
    h.controller.update(
      change === 'remove'
        ? []
        : change === 'replace'
          ? [
              {
                ...old,
                profile: {
                  ...old.profile,
                  connection: {
                    ...old.profile.connection,
                    token: 'new-paired-device-token-1234567',
                  },
                },
              },
            ]
          : [old],
      change !== 'background',
    )
    await flush()
    late?.(response)
    await flush()
    expect(storage.load()).toMatchObject({ journal: [] })
    expect(h.refreshed).not.toHaveBeenCalled()
    expect(h.error).toHaveBeenLastCalledWith('')
    await runtime.close()
    await app.close()
  },
)
it('does not connect when opening storage finishes after backgrounding', async () => {
  vi.useFakeTimers()
  let resolve: ((value: unknown) => void) | undefined
  const request = vi.fn<ThreadStateSyncOptions['request']>()
  const h = harness(request, {
    ...memory(),
    load: () =>
      new Promise((value) => {
        resolve = value
      }),
  })
  h.controller.update([target()], true)
  await flush()
  expect(resolve).toBeDefined()
  h.controller.update([], false)
  resolve?.(undefined)
  await flush()
  expect(request).not.toHaveBeenCalled()
})
it('rejects a response from a different runtime before saving its data', async () => {
  vi.useFakeTimers()
  const wrong = await peer('another-runtime')
  await wrong.set(threadRecordKey(title), title)
  const storage = memory()
  const h = harness((_profile, _path, input) => wrong.exchange(input), storage)
  h.controller.update([target()], true)
  await flush()
  expect(storage.load()).toMatchObject({ journal: [] })
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('different runtime'))
  expect(h.refreshed).not.toHaveBeenCalled()
  await wrong.close()
})

it('ignores unrelated streamed snapshots without reloading storage or starving session creation', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  const storage = memory()
  const load = vi.spyOn(storage, 'load')
  const h = harness((_profile, _path, input) => runtime.exchange(input), storage)
  const connected = target()
  h.controller.update([connected], true)
  await flush()
  const reads = load.mock.calls.length
  for (let revision = 2; revision <= 31; revision++) {
    h.controller.update(
      [{ ...connected, snapshot: connected.snapshot ? { ...connected.snapshot, revision } : null }],
      true,
    )
    await flush()
  }
  expect(load).toHaveBeenCalledTimes(reads)
  expect(h.refreshed).toHaveBeenCalled()
  await runtime.close()
})
