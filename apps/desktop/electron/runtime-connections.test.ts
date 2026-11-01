/// <reference lib="es2024" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  snapshotSchema,
  applySnapshotDelta,
  type Task,
  type DesktopSyncSubscription,
  type DesktopSyncEvent,
  type RuntimeConnection,
  type RuntimeSnapshot,
  type startRuntimeSync,
} from '@dovo/protocol'
import { RuntimeConnections } from './runtime-connections.js'
import { setRuntimeSnapshotTag } from '../../../packages/protocol/src/shared/client.js'
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  vi.useRealTimers()
})
function fixture(recover?: (connection: RuntimeConnection) => Promise<RuntimeConnection | null>) {
  vi.useFakeTimers()
  const options = new Map<string, Parameters<typeof startRuntimeSync>[1]>()
  const online = new Set<string>()
  const stopped: string[] = []
  const start = vi.fn<typeof startRuntimeSync>((connection, callbacks) => {
    options.set(connection.address, callbacks)
    return {
      shared: false,
      online: () => online.has(connection.address),
      retry: vi.fn<() => void>(),
      refresh: vi.fn<() => void>(),
      stop: () => {
        stopped.push(connection.address)
      },
    }
  })
  const snapshot = (tasks: string[]): RuntimeSnapshot =>
    decode(snapshotSchema, {
      revision: 1,
      owner: false,
      detailTaskIds: tasks,
      workspace: {
        version: 1,
        runtimeAddress: '',
        agents: [],
        repositories: [],
        automations: [],
        tasks: [],
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    })
  const read = vi.fn<
    (connection: RuntimeConnection, path: string, signal: AbortSignal) => Promise<RuntimeSnapshot>
  >(async (_connection, path) =>
    snapshot(new URL(path, 'http://fixture').searchParams.getAll('task')),
  )
  const manager = new RuntimeConnections(start, read, recover)
  disposals.push(() => manager.dispose())
  const input = (id: string, tasks = ['thread']): DesktopSyncSubscription => ({
    id,
    connection: { address: 'http://paired.lan:8787', token: 'paired-token-at-least-20-characters' },
    tasks,
    scopes: [],
    detailScopes: [],
  })
  return { manager, start, read, input, options, stopped, online, snapshot }
}
function conversation(f: ReturnType<typeof fixture>): RuntimeSnapshot {
  const task: Task = {
    id: 'thread',
    title: 'Streaming thread',
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'running',
    createdAt: '2026-11-01T00:00:00Z',
    draft: 'Keep my draft',
    example: false,
    messages: Array.from({ length: 80 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      text: 'content '.repeat(512),
    })),
    files: [
      {
        path: 'file.ts',
        before: 'before '.repeat(1000),
        after: 'after '.repeat(1000),
        viewed: false,
      },
    ],
    historyBefore: 'older-page',
    historyTotals: { tokens: 1000, milliseconds: 60000, hasChanges: false },
    turns: [
      {
        id: 'turn',
        assistantId: 'message-79',
        agentId: 'agent',
        provider: 'codex',
        model: '',
        status: 'running',
        startedAt: '2026-11-01T00:00:00Z',
        tokens: 50,
        checkpoint: { before: 'before', after: 'after', files: [], omitted: [] },
      },
    ],
    sideChats: [
      {
        id: 'side',
        title: 'Question',
        draft: 'Side draft',
        createdAt: '2026-11-01T00:00:00Z',
        messages: [
          {
            id: 'side-message',
            question: 'Explain',
            answer: 'Answer',
            status: 'completed',
            createdAt: '2026-11-01T00:00:00Z',
          },
        ],
      },
    ],
    forkedFrom: { taskId: 'parent', title: 'Parent', snapshot: 'private-checkpoint-snapshot' },
  }
  return { ...f.snapshot(['thread']), workspace: { ...f.snapshot([]).workspace, tasks: [task] } }
}
it.each(['scoped', 'legacy'] as const)(
  "isolates browser windows from another window's %s conversation bodies while sharing one stream",
  (mode) => {
    const f = fixture(),
      main: DesktopSyncEvent[] = [],
      browser: DesktopSyncEvent[] = []
    f.manager.subscribe('main', f.input('main'), (event) => main.push(event))
    const stream = f.options.get('http://paired.lan:8787')!
    const source = conversation(f)
    if (mode === 'legacy') delete source.detailTaskIds
    setRuntimeSnapshotTag(source, 'source-tag')
    stream.onSnapshot(source)
    f.manager.subscribe('browser', f.input('browser', []), (event) => browser.push(event))
    const mainBaseline = main.findLast((event) => event.type === 'snapshot')!
    const browserBaseline = browser.findLast((event) => event.type === 'snapshot')!
    if (mainBaseline.type !== 'snapshot' || browserBaseline.type !== 'snapshot')
      throw Error('Missing baseline')
    expect(mainBaseline.snapshot.workspace.tasks[0]?.messages).toHaveLength(80)
    expect(browserBaseline.snapshot.detailTaskIds).toEqual([])
    expect(browserBaseline.snapshot.workspace.tasks[0]).toMatchObject({
      draft: 'Keep my draft',
      messages: [],
      files: [{ path: 'file.ts', before: '', after: '', viewed: false }],
      turns: [{ id: 'turn', tokens: 50, checkpoint: undefined }],
      historyTotals: source.workspace.tasks[0]!.historyTotals,
      sideChats: [{ id: 'side', draft: 'Side draft', messages: [] }],
      forkedFrom: { taskId: 'parent', snapshot: undefined },
    })
    expect(source.workspace.tasks[0]?.sideChats?.[0]?.messages).toHaveLength(1)
    expect(source.workspace.tasks[0]?.turns?.[0]?.checkpoint).toBeDefined()
    expect(JSON.stringify(browserBaseline).length).toBeLessThan(
      JSON.stringify(mainBaseline).length / 100,
    )
    expect(browserBaseline.tag).not.toBe(mainBaseline.tag)
    expect(mainBaseline.tag).toBeDefined()
    let mainSnapshot = mainBaseline.snapshot,
      browserSnapshot = browserBaseline.snapshot
    for (let index = 0; index < 12; index++) {
      const task = mainSnapshot.workspace.tasks[0]!
      const next = {
        ...source,
        revision: index + 2,
        workspace: {
          ...source.workspace,
          tasks: [
            {
              ...task,
              title: `Updated title ${index}`,
              messages: [
                ...task.messages,
                {
                  id: `extra-${index}`,
                  role: 'assistant' as const,
                  text: 'New output '.repeat(1000),
                },
              ],
            },
          ],
        },
      }
      stream.onSnapshot(next)
      const mainDelta = main.at(-1)!,
        browserDelta = browser.at(-1)!
      if (mainDelta.type !== 'delta' || browserDelta.type !== 'delta') throw Error('Missing delta')
      expect(browserDelta.delta.workspace.tasks?.changes.every((change) => !change.messages)).toBe(
        true,
      )
      mainSnapshot = applySnapshotDelta(mainSnapshot, mainDelta.delta)
      browserSnapshot = applySnapshotDelta(browserSnapshot, browserDelta.delta)
      expect(mainSnapshot).toEqual({ ...next, detailTaskIds: ['thread'] })
      expect(browserSnapshot.workspace.tasks[0]?.messages).toEqual([])
      expect(browserSnapshot.workspace.tasks[0]?.title).toBe(`Updated title ${index}`)
      expect(browserDelta.base).toBe(index ? browserDelta.sequence - 1 : browserBaseline.sequence)
    }
    expect(f.start).toHaveBeenCalledOnce()
  },
)
it('upgrades browser thread details on demand and removes them when the linked thread closes', () => {
  const f = fixture(),
    events: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), () => {})
  const source = conversation(f)
  setRuntimeSnapshotTag(source, 'same-revision')
  f.options.get('http://paired.lan:8787')!.onSnapshot(source)
  f.manager.subscribe('browser', f.input('browser', []), (event) => events.push(event))
  f.manager.subscribe('browser', f.input('browser'), (event) => events.push(event))
  const selected = events.at(-1)!
  if (selected.type !== 'snapshot') throw Error('Missing selected baseline')
  expect(selected.snapshot.detailTaskIds).toEqual(['thread'])
  expect(selected.snapshot.workspace.tasks[0]?.messages).toHaveLength(80)
  f.manager.subscribe('browser', f.input('browser', []), (event) => events.push(event))
  const deselected = events.at(-1)!
  if (deselected.type !== 'snapshot') throw Error('Missing deselected baseline')
  expect(deselected.snapshot.detailTaskIds).toEqual([])
  expect(deselected.snapshot.workspace.tasks[0]?.messages).toEqual([])
  expect(selected.tag).toBeDefined()
  expect(deselected.tag).not.toBe(selected.tag)
})
it('shares one stream and fallback poller across main and popout; closing main preserves the popout', async () => {
  const f = fixture(),
    main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main', ['author']), (event) => main.push(event))
  f.manager.subscribe('popout', f.input('popout', ['reviewer']), (event) => popout.push(event))
  expect(f.start).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(500)
  expect(f.read).toHaveBeenCalledTimes(2)
  const path = f.read.mock.calls[1][1]
  expect(new URL(path, 'http://fixture').searchParams.getAll('task').sort()).toEqual([
    'author',
    'reviewer',
  ])
  expect(main.some((event) => event.type === 'snapshot')).toBe(true)
  expect(popout.some((event) => event.type === 'snapshot')).toBe(true)
  f.manager.unsubscribe('main')
  expect(f.stopped).toEqual([])
  f.options.get('http://paired.lan:8787')?.onSnapshot(f.snapshot(['reviewer']))
  expect(popout.at(-1)?.type).toBe('delta')
  f.manager.unsubscribe('popout')
  expect(f.stopped).toEqual(['http://paired.lan:8787'])
})
it('keeps popouts on their runtime when main switches and isolates credentials', () => {
  const f = fixture(),
    received: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), () => {})
  f.manager.subscribe('popout', f.input('popout'), (event) => received.push(event))
  f.manager.subscribe(
    'main',
    {
      ...f.input('main'),
      connection: { address: 'http://other.lan:8787', token: 'other-token-at-least-20-characters' },
    },
    () => {},
  )
  expect(f.start).toHaveBeenCalledTimes(2)
  expect(f.stopped).toEqual([])
  f.options.get('http://paired.lan:8787')?.onSnapshot(f.snapshot(['thread']))
  expect(received.at(-1)?.type).toBe('snapshot')
  f.manager.subscribe(
    'different-credentials',
    {
      ...f.input('third'),
      connection: {
        ...f.input('third').connection,
        token: 'replacement-token-at-least-20-characters',
      },
    },
    () => {},
  )
  expect(f.start).toHaveBeenCalledTimes(3)
})
it('stops HTTP polling while live and shares disconnect state across windows', async () => {
  const f = fixture(),
    main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), (event) => main.push(event))
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  f.online.add('http://paired.lan:8787')
  f.options.get('http://paired.lan:8787')?.onStatus?.('live')
  await vi.advanceTimersByTimeAsync(5000)
  expect(f.read).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  f.online.clear()
  f.options.get('http://paired.lan:8787')?.onStatus?.('reconnecting')
  f.read.mockRejectedValue(new Error('Runtime offline'))
  await vi.advanceTimersByTimeAsync(1100)
  expect(main.at(-1)).toEqual({ type: 'error', message: 'Runtime offline' })
  expect(popout.at(-1)).toEqual({ type: 'error', message: 'Runtime offline' })
})
it('clears a scheduled fallback poll when the stream recovers', async () => {
  const f = fixture()
  f.manager.subscribe('main', f.input('main'), () => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)
  f.online.add('http://paired.lan:8787')
  f.options.get('http://paired.lan:8787')?.onStatus?.('live')
  expect(vi.getTimerCount()).toBe(0)
  f.online.clear()
  f.options.get('http://paired.lan:8787')?.onStatus?.('reconnecting')
  await vi.advanceTimersByTimeAsync(0)
  expect(f.read).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(1)
})
it('replaces eight watched threads without temporarily exceeding the shared limit', () => {
  const f = fixture()
  f.manager.subscribe(
    'main',
    f.input(
      'main',
      Array.from({ length: 8 }, (_, index) => `old-${index}`),
    ),
    () => {},
  )
  expect(() =>
    f.manager.subscribe(
      'main',
      f.input(
        'main',
        Array.from({ length: 8 }, (_, index) => `new-${index}`),
      ),
      () => {},
    ),
  ).not.toThrow()
  expect(() => f.manager.subscribe('popout', f.input('popout', ['ninth']), () => {})).toThrow(
    'eight threads',
  )
})

it('fans one local-runtime recovery out to both windows', async () => {
  const recover = vi.fn<(connection: RuntimeConnection) => Promise<RuntimeConnection | null>>(
    async (connection) => ({ ...connection, address: 'http://127.0.0.1:9999' }),
  )
  const f = fixture(recover),
    main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  f.read.mockRejectedValue(new Error('Local runtime moved'))
  f.manager.subscribe('main', f.input('main'), (event) => main.push(event))
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  await vi.advanceTimersByTimeAsync(0)
  expect(recover).toHaveBeenCalledOnce()
  expect(main.at(-1)).toEqual({
    type: 'connection',
    connection: { ...f.input('main').connection, address: 'http://127.0.0.1:9999' },
  })
  expect(popout.at(-1)).toEqual(main.at(-1))
})
it('does not replay a disconnected cached snapshot as a live connection to a new popout', async () => {
  const f = fixture(),
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), () => {})
  await vi.advanceTimersByTimeAsync(0)
  f.read.mockRejectedValue(new Error('Runtime offline'))
  f.manager.refresh('main', false)
  await vi.advanceTimersByTimeAsync(0)
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  expect(popout.some((event) => event.type === 'snapshot')).toBe(false)
})
it('ignores a late failed HTTP read after the shared stream becomes live', async () => {
  const f = fixture(),
    popout: DesktopSyncEvent[] = []
  let reject!: (error: Error) => void
  f.read.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  f.manager.subscribe('main', f.input('main'), () => {})
  f.online.add('http://paired.lan:8787')
  f.options.get('http://paired.lan:8787')?.onStatus?.('live')
  f.options.get('http://paired.lan:8787')?.onSnapshot(f.snapshot(['thread']))
  reject(new Error('Old HTTP request failed'))
  await vi.advanceTimersByTimeAsync(0)
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  expect(popout.some((event) => event.type === 'snapshot')).toBe(true)
  expect(popout.some((event) => event.type === 'error')).toBe(false)
})
it('sends versioned deltas, restores baselines on refresh and resets epochs after restart', async () => {
  const f = fixture(),
    events: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), (event) => events.push(event))
  await vi.advanceTimersByTimeAsync(500)
  const baseline = events.findLast((event) => event.type === 'snapshot')
  expect(baseline?.type).toBe('snapshot')
  const next = { ...f.snapshot(['thread']), revision: 2, runtimeInstanceId: 'first' }
  f.options.get('http://paired.lan:8787')?.onSnapshot(next)
  const restarted = events.at(-1)
  expect(restarted?.type).toBe('snapshot')
  f.options.get('http://paired.lan:8787')?.onSnapshot({ ...next, revision: 3 })
  const delta = events.at(-1)
  expect(delta).toMatchObject({
    type: 'delta',
    base: expect.any(Number),
    sequence: expect.any(Number),
  })
  if (delta?.type !== 'delta') throw new Error('Expected delta')
  expect(delta.sequence).toBe(delta.base + 1)
  f.manager.refresh('main', false)
  expect(events.at(-1)?.type).toBe('snapshot')
  f.options.get('http://paired.lan:8787')?.onSnapshot({ ...next, runtimeInstanceId: 'second' })
  const second = events.at(-1)
  expect(second?.type).toBe('snapshot')
  if (second?.type !== 'snapshot' || restarted?.type !== 'snapshot')
    throw new Error('Expected restart baselines')
  expect(second.epoch).not.toBe(restarted.epoch)
})

it.each(['success', 'failure'] as const)(
  'ignores delayed HTTP %s after a newer stream snapshot and disconnect',
  async (outcome) => {
    const recover = vi.fn<(connection: RuntimeConnection) => Promise<RuntimeConnection | null>>()
    const f = fixture(recover),
      events: DesktopSyncEvent[] = [],
      popout: DesktopSyncEvent[] = []
    const pending = Promise.withResolvers<RuntimeSnapshot>()
    f.read.mockImplementationOnce(() => pending.promise)
    f.manager.subscribe('main', f.input('main'), (event) => events.push(event))
    const stream = f.options.get('http://paired.lan:8787')!
    f.online.add('http://paired.lan:8787')
    stream.onStatus?.('live')
    stream.onSnapshot({ ...f.snapshot(['thread']), runtimeInstanceId: 'new' })
    f.online.clear()
    stream.onStatus?.('reconnecting')
    const count = events.length
    if (outcome === 'success')
      pending.resolve({ ...f.snapshot(['thread']), runtimeInstanceId: 'old' })
    else pending.reject(new Error('Old instance failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(count)
    expect(recover).not.toHaveBeenCalled()
    f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
    expect(popout.some((event) => event.type === 'snapshot')).toBe(false)
    // The next request still works after the superseded one settles.
    f.read.mockResolvedValue({ ...f.snapshot(['thread']), runtimeInstanceId: 'new', revision: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.read).toHaveBeenCalledTimes(2)
    expect(events.at(-1)?.type).toBe('delta')
  },
)
it.each(['success', 'failure'] as const)(
  'ignores delayed recovery %s when stream state supersedes it',
  async (outcome) => {
    const recovery = Promise.withResolvers<RuntimeConnection | null>()
    const recover = vi.fn<(connection: RuntimeConnection) => Promise<RuntimeConnection | null>>(
      () => recovery.promise,
    )
    const f = fixture(recover),
      events: DesktopSyncEvent[] = []
    f.read.mockRejectedValueOnce(new Error('Old instance failed'))
    f.manager.subscribe('main', f.input('main'), (event) => events.push(event))
    await vi.advanceTimersByTimeAsync(0)
    expect(recover).toHaveBeenCalledOnce()
    const stream = f.options.get('http://paired.lan:8787')!
    stream.onSnapshot({ ...f.snapshot(['thread']), runtimeInstanceId: 'new' })
    stream.onStatus?.('reconnecting')
    const count = events.length
    if (outcome === 'success')
      recovery.resolve({ ...f.input('main').connection, address: 'http://old.lan:8787' })
    else recovery.reject(new Error('Old recovery failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(count)
  },
)

it('combines paged window limits and restores complete summaries for a full-list window', async () => {
  const f = fixture()
  const main = { ...f.input('main'), settledLimit: 25 }
  f.manager.subscribe('main', main, () => {})
  await vi.advanceTimersByTimeAsync(500)
  expect(f.read.mock.calls.at(-1)?.[1]).toContain('settled=25')
  f.manager.subscribe('popout', { ...f.input('popout'), settledLimit: 50 }, () => {})
  await vi.advanceTimersByTimeAsync(1500)
  expect(f.read.mock.calls.at(-1)?.[1]).toContain('settled=50')
  f.manager.subscribe('main', { ...main, settledLimit: undefined }, () => {})
  await vi.advanceTimersByTimeAsync(1500)
  expect(f.read.mock.calls.at(-1)?.[1]).not.toContain('settled=')
  f.manager.unsubscribe('main')
  await vi.advanceTimersByTimeAsync(1500)
  expect(f.read.mock.calls.at(-1)?.[1]).toContain('settled=50')
})

it('delivers an unchanged resumed baseline to a window opened during an outage', async () => {
  const f = fixture(),
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), () => {})
  await vi.advanceTimersByTimeAsync(0)
  const stream = f.options.get('http://paired.lan:8787')!
  const baseline = f.snapshot(['thread'])
  stream.onSnapshot(baseline)
  stream.onStatus?.('reconnecting')
  f.read.mockRejectedValue(new Error('Offline'))
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  expect(popout.some((event) => event.type === 'snapshot')).toBe(false)
  f.online.add('http://paired.lan:8787')
  stream.onStatus?.('live')
  stream.onSnapshot(baseline)
  expect(popout.filter((event) => event.type === 'snapshot')).toHaveLength(1)
  stream.onSnapshot(baseline)
  expect(popout.filter((event) => event.type === 'snapshot')).toHaveLength(1)
})

it('reconciles route metadata on the connection retained by the shared stream and poller', async () => {
  const f = fixture()
  const initial = f.input('main')
  initial.connection.runtimeId = 'runtime-one'
  initial.connection.alternateAddresses = ['http://old.lan']
  f.manager.subscribe('main', initial, () => {})
  const retained = f.start.mock.calls[0]![0]
  const next = {
    ...initial,
    connection: {
      ...initial.connection,
      alternateAddresses: ['http://vpn.lan'],
      accountSession: 'new-session',
    },
  }
  f.manager.subscribe('main', next, () => {})
  expect(retained.alternateAddresses).toEqual(['http://vpn.lan'])
  expect(retained.accountSession).toBe('new-session')
  expect(f.start).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1100)
  expect(f.read.mock.calls.at(-1)?.[0].alternateAddresses).toEqual(['http://vpn.lan'])
})

it('does not replace newer route metadata with an unchanged subscription update from another window', () => {
  const f = fixture()
  const main = f.input('main')
  const popout = f.input('popout')
  f.manager.subscribe('main', main, () => {})
  f.manager.subscribe('popout', popout, () => {})
  f.manager.subscribe(
    'main',
    {
      ...main,
      connection: {
        ...main.connection,
        runtimeId: 'new-runtime',
        alternateAddresses: ['http://new-route.lan'],
      },
    },
    () => {},
  )
  f.manager.subscribe('popout', { ...popout, tasks: ['another-thread'] }, () => {})
  expect(f.start.mock.calls[0]![0]).toMatchObject({
    runtimeId: 'new-runtime',
    alternateAddresses: ['http://new-route.lan'],
  })
})

it('does not revert current metadata when a new window subscribes with an older connection', () => {
  const f = fixture()
  const main = f.input('main')
  f.manager.subscribe('main', main, () => {})
  f.manager.subscribe(
    'main',
    {
      ...main,
      connection: {
        ...main.connection,
        runtimeId: 'runtime-new',
        alternateAddresses: ['http://current.vpn'],
      },
    },
    () => {},
  )
  f.manager.subscribe('popout', f.input('popout'), () => {})
  expect(f.start.mock.calls[0]![0]).toMatchObject({
    runtimeId: 'runtime-new',
    alternateAddresses: ['http://current.vpn'],
  })
})
