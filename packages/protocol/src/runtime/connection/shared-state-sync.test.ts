import { DurableState, type StateStorage } from '@dovo/durable-connections'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { scopedSettingsValueSchema, type SharedSettingsEntry } from '../../workspace.js'
import { runtimeProfile, type RuntimeOverview } from './runtime-fleet.js'
import { snapshotSchema } from './runtime.js'
import { mergeSharedSettings } from './scoped-settings.js'
import { sharedSettingsVersions } from './shared-state-values.js'
import { SharedStateSynchronization, type SharedStateSyncOptions } from './shared-state-sync.js'

const controllers: SharedStateSynchronization[] = []
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()))
  vi.useRealTimers()
  vi.restoreAllMocks()
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
const entry = (key: string, updatedAt: number, command: string): SharedSettingsEntry => ({
  key,
  updatedAt,
  changeId: `edit:${updatedAt}`,
  value: { taskDefaults: { setupCommand: command } },
})
function target(
  id: string,
  shared: SharedSettingsEntry[] = [],
  durable = true,
): Pick<RuntimeOverview, 'profile' | 'snapshot' | 'connected'> {
  return {
    profile: runtimeProfile({
      address: `http://${id}.local:51464`,
      token: 'paired-device-token-1234567',
      runtimeId: id,
    }),
    connected: true,
    snapshot: decode(snapshotSchema, {
      runtimeId: id,
      revision: 1,
      owner: false,
      settingsScopesSupported: true,
      ...(durable ? { stateReplicationVersion: 1 } : {}),
      defaults: { scopedSettings: { environment: {}, shared } },
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
    channel: 'shared-settings:v1',
    replicaId: id,
    storage: memory(),
    decode: (value) => decode(scopedSettingsValueSchema, value),
  })
}
function harness(
  initial: SharedSettingsEntry[],
  request: SharedStateSyncOptions['request'],
  storage: StateStorage = memory(),
) {
  let shared = initial
  const error = vi.fn<(message: string) => void>()
  const refreshed = vi.fn<NonNullable<SharedStateSyncOptions['refreshed']>>(async () => {})
  const synchronization = new SharedStateSynchronization({
    storage,
    createReplicaId: () => 'app:one',
    readShared: () => shared,
    publish: (next) => {
      shared = mergeSharedSettings(shared, next)
    },
    request,
    error,
    refreshed,
    intervalMs: null,
  })
  controllers.push(synchronization)
  return {
    synchronization,
    shared: () => shared,
    edit: (value: SharedSettingsEntry) => {
      shared = mergeSharedSettings(shared, [value])
    },
    error,
    refreshed,
  }
}
async function flush() {
  for (let count = 0; count < 5; count++) {
    await vi.advanceTimersByTimeAsync(0)
  }
}

it('migrates existing settings, receives full remote versions, and bridges paired runtimes', async () => {
  vi.useFakeTimers()
  const a = await peer('a'),
    b = await peer('b')
  const storage = memory()
  const request = vi.fn<SharedStateSyncOptions['request']>((profile, path, input) => {
    expect(path).toBe('/api/state/exchange')
    expect(input).toMatchObject({ targetRuntimeId: profile.connection.runtimeId })
    return (profile.connection.runtimeId === 'a' ? a : b).exchange(input)
  })
  const local = entry('global', 1, 'local'),
    remote = entry('global', 2, 'remote')
  await a.importVersions(sharedSettingsVersions([remote]))
  const h = harness([local], request, storage)
  h.synchronization.update([target('a', [remote]), target('b')], true)
  await flush()
  expect(a.get('global')?.taskDefaults?.setupCommand).toBe('remote')
  expect(b.get('global')).toEqual(a.get('global'))
  expect(a.history('global')).toHaveLength(2)
  expect(h.shared()).toEqual([remote])
  expect(h.error).toHaveBeenLastCalledWith('')
  expect(JSON.stringify(await storage.load())).not.toContain('paired-device-token')
  await b.set('project:host/team/repo', { taskDefaults: { setupCommand: 'remote project' } })
  h.synchronization.retry()
  await flush()
  expect(a.get('project:host/team/repo')).toEqual(b.get('project:host/team/repo'))
  const calls = request.mock.calls.length
  await vi.advanceTimersByTimeAsync(90000)
  expect(request).toHaveBeenCalledTimes(calls)
})

it('retries an unchanged edit after an offline failure without another form save', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const runtime = await peer()
  let online = false
  const request = vi.fn<SharedStateSyncOptions['request']>(async (_profile, _path, input) => {
    if (!online) throw new Error('Offline')
    return runtime.exchange(input)
  })
  const h = harness([entry('global', 1, 'offline edit')], request)
  h.synchronization.update([target('runtime')], true)
  await flush()
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('Offline'))
  online = true
  await vi.advanceTimersByTimeAsync(1000)
  await flush()
  expect(runtime.get('global')?.taskDefaults?.setupCommand).toBe('offline edit')
  expect(h.error).toHaveBeenLastCalledWith('')
})

it('does not import a reduced snapshot before receiving the full immutable version', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  const full = {
    ...entry('global', 2, 'remote'),
    value: { taskDefaults: { setupCommand: 'remote' }, projectPinned: true },
  }
  await runtime.importVersions(sharedSettingsVersions([full]))
  const h = harness([], (_profile, _path, input) => runtime.exchange(input))
  h.synchronization.update([target('runtime', [entry('global', 2, 'remote')])], true)
  await flush()
  expect(h.shared()).toEqual([full])
  expect(h.error).toHaveBeenLastCalledWith('')
  expect(runtime.history('global')).toHaveLength(1)
})

it('isolates an incompatible legacy response while another runtime keeps syncing', async () => {
  vi.useFakeTimers()
  const healthy = await peer('healthy')
  await healthy.importVersions(sharedSettingsVersions([entry('global', 3, 'healthy')]))
  const h = harness([], (profile, _path, input) =>
    profile.connection.runtimeId === 'legacy'
      ? Promise.resolve({
          shared: [{ ...entry('global', 4, 'future'), value: { futureCategory: true } }],
        })
      : healthy.exchange(input),
  )
  h.synchronization.update([target('legacy', [], false), target('healthy')], true)
  await flush()
  expect(h.shared()).toEqual([entry('global', 3, 'healthy')])
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('compatible app'))
  expect(healthy.history('global')).toHaveLength(1)
})

it('uses the legacy endpoint for older runtimes and confirms a lost response with a raw read', async () => {
  vi.useFakeTimers()
  const edit = entry('global', 1, 'compatible')
  const request = vi.fn<SharedStateSyncOptions['request']>(async (_profile, path) => {
    expect(path).toBe('/api/agents/settings/sync')
    throw new Error('Response lost')
  })
  const h = harness([edit], request)
  h.synchronization.update([target('legacy', [], false)], true)
  await flush()
  expect(request).toHaveBeenCalledTimes(1)
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('Response lost'))
  request.mockResolvedValue({ shared: [edit] })
  h.synchronization.update([target('legacy', [edit], false)], true)
  await flush()
  expect(h.error).toHaveBeenLastCalledWith('')
  expect(request).toHaveBeenCalledTimes(2)
  const next = entry('global', 2, 'new edit')
  h.edit(next)
  request.mockResolvedValue({ shared: [next] })
  h.synchronization.update([target('legacy', [edit], false)], true)
  await flush()
  expect(request).toHaveBeenLastCalledWith(
    expect.anything(),
    '/api/agents/settings/sync',
    { shared: [next] },
    expect.any(AbortSignal),
  )
})

it('reports failures from every connected computer', async () => {
  vi.useFakeTimers()
  const h = harness([entry('global', 1, 'share')], async (profile) => {
    throw new Error(`Failed ${profile.id}`)
  })
  h.synchronization.update([target('one', [], false), target('two', [], false)], true)
  await flush()
  const message = h.error.mock.lastCall?.[0]
  expect(message).toContain('Failed http://one.local:51464')
  expect(message).toContain('Failed http://two.local:51464')
})

it('never sends unpersisted state and recovers a storage initialization failure on refresh', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  const storage = memory()
  const save = storage.save.getMockImplementation()!
  let writable = false
  storage.save.mockImplementation((value) => {
    if (!writable) throw new Error('Disk full')
    save(value)
  })
  const request = vi.fn<SharedStateSyncOptions['request']>((_profile, _path, input) =>
    runtime.exchange(input),
  )
  const h = harness([entry('global', 1, 'must persist')], request, storage)
  h.synchronization.update([target('runtime')], true)
  await flush()
  expect(request).not.toHaveBeenCalled()
  expect(h.error).toHaveBeenLastCalledWith('Disk full')
  writable = true
  h.synchronization.retry()
  await flush()
  expect(runtime.get('global')?.taskDefaults?.setupCommand).toBe('must persist')
  expect(h.error).toHaveBeenLastCalledWith('')
})

it('rejects a response from a different runtime before it enters the app journal', async () => {
  vi.useFakeTimers()
  const wrong = await peer('wrong')
  await wrong.set('global', { taskDefaults: { setupCommand: 'wrong runtime' } })
  const h = harness([], (_profile, _path, input) => wrong.exchange(input))
  h.synchronization.update([target('runtime')], true)
  await flush()
  expect(h.shared()).toEqual([])
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('different runtime'))
})

it('discards late replies after backgrounding or removing a pairing and resumes on foreground', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  await runtime.set('global', { taskDefaults: { setupCommand: 'remote' } })
  let deliver: ((response: unknown) => void) | undefined
  let response: unknown
  const request = vi.fn<SharedStateSyncOptions['request']>(async (_profile, _path, input) => {
    response = await runtime.exchange(input)
    return new Promise((resolve) => {
      deliver = resolve
    })
  })
  const h = harness([], request)
  h.synchronization.update([target('runtime')], true)
  await flush()
  expect(deliver).toBeDefined()
  h.synchronization.update([], false)
  await flush()
  deliver?.(response)
  await flush()
  expect(h.shared()).toEqual([])
  expect(h.refreshed).not.toHaveBeenCalled()
  request.mockImplementation((_profile, _path, input) => runtime.exchange(input))
  h.synchronization.update([target('runtime')], true)
  await flush()
  expect(h.shared()[0].value.taskDefaults?.setupCommand).toBe('remote')
  await h.synchronization.stop()
  const calls = request.mock.calls.length
  h.synchronization.retry()
  h.synchronization.update([target('runtime')], true)
  await vi.advanceTimersByTimeAsync(120000)
  expect(request).toHaveBeenCalledTimes(calls)
})

it('does not open connections when storage finishes loading after backgrounding', async () => {
  vi.useFakeTimers()
  let loaded: ((value: unknown) => void) | undefined
  const request = vi.fn<SharedStateSyncOptions['request']>()
  const storage = {
    ...memory(),
    load: () =>
      new Promise<unknown>((resolve) => {
        loaded = resolve
      }),
  }
  const h = harness([entry('global', 1, 'local')], request, storage)
  h.synchronization.update([target('runtime')], true)
  await flush()
  expect(loaded).toBeDefined()
  h.synchronization.update([], false)
  loaded?.(undefined)
  await flush()
  expect(request).not.toHaveBeenCalled()
  expect(h.refreshed).not.toHaveBeenCalled()
})

it.each(['remove', 'replace'])(
  'discards replies from a %s pairing while the app stays active',
  async (change) => {
    vi.useFakeTimers()
    const runtime = await peer()
    await runtime.set('global', { taskDefaults: { setupCommand: 'old session' } })
    let deliver: ((value: unknown) => void) | undefined
    const reply = await runtime.exchange((await peer('app:one')).request())
    const request = vi.fn<SharedStateSyncOptions['request']>(
      () =>
        new Promise((resolve) => {
          deliver = resolve
        }),
    )
    const h = harness([], request)
    const old = target('runtime')
    h.synchronization.update([old], true)
    await flush()
    const deliverOld = deliver
    expect(deliverOld).toBeDefined()
    const replacement = {
      ...old,
      profile: {
        ...old.profile,
        connection: { ...old.profile.connection, token: 'replacement-device-token-1234567' },
      },
    }
    h.synchronization.update(change === 'remove' ? [] : [replacement], true)
    await flush()
    deliverOld?.(reply)
    await flush()
    expect(h.shared()).toEqual([])
    expect(h.refreshed).not.toHaveBeenCalled()
    expect(h.error).toHaveBeenLastCalledWith('')
  },
)

it('restores committed app state and identity when preferences are absent after restart', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  const storage = memory()
  const edit = entry('global', 1, 'persisted')
  const first = harness([edit], (_profile, _path, input) => runtime.exchange(input), storage)
  first.synchronization.update([target('runtime')], true)
  await flush()
  await first.synchronization.stop()
  const request = vi.fn<SharedStateSyncOptions['request']>((_profile, _path, input) =>
    runtime.exchange(input),
  )
  const restarted = harness([], request, storage)
  restarted.synchronization.update([target('runtime')], true)
  await flush()
  expect(restarted.shared()).toEqual([edit])
  expect(request.mock.calls[0][2]).toMatchObject({ batch: { source: 'app:one' } })
  expect(runtime.history('global')).toHaveLength(1)
})

it('ignores unrelated streamed snapshots and fetches changed settings through raw exchange', async () => {
  vi.useFakeTimers()
  const runtime = await peer()
  const storage = memory()
  const load = vi.spyOn(storage, 'load')
  const h = harness([], (_profile, _path, input) => runtime.exchange(input), storage)
  const connected = target('runtime')
  h.synchronization.update([connected], true)
  await flush()
  const reads = load.mock.calls.length
  for (let revision = 2; revision <= 31; revision++) {
    h.synchronization.update(
      [{ ...connected, snapshot: connected.snapshot ? { ...connected.snapshot, revision } : null }],
      true,
    )
    await flush()
  }
  expect(load).toHaveBeenCalledTimes(reads)
  await runtime.importVersions(sharedSettingsVersions([entry('global', 200, 'changed')]))
  h.synchronization.update([target('runtime', [entry('global', 200, 'changed')])], true)
  await flush()
  expect(h.shared()[0]?.value.taskDefaults?.setupCommand).toBe('changed')
})
