import { afterEach, expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import {
  applySnapshotDelta,
  artifactReferences,
  decode,
  syncFrameSchema,
  workspaceRecoveriesSchema,
  type SyncFrame,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const token = 'runtime-sync-test-owner-with-at-least-32-characters'
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Task',
        agentId: '',
        repositoryId: '',
        status: 'draft',
        createdAt: '2026-10-01',
        messages: [{ id: 'reply', role: 'assistant', text: 'History '.repeat(10000) }],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  const address = `http://127.0.0.1:${runtime.port}`
  const open = async (
    credential = token,
    format = 1,
    taskIds: string[] = [],
    pagedHistory = false,
  ) => {
    const query = new URLSearchParams({ format: String(format) })
    if (pagedHistory) query.set('history', 'paged')
    for (const id of taskIds) query.append('task', id)
    const response = await fetch(`${address}/api/sync/ticket?${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}` },
    })
    expect(response.status).toBe(200)
    const ticket = (await response.json()).ticket as string
    const socket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/sync?ticket=${ticket}`)
    cleanup.push(() => socket.terminate())
    const frames: SyncFrame[] = []
    socket.on('message', (raw) => {
      if (Buffer.isBuffer(raw))
        frames.push(decode(syncFrameSchema, JSON.parse(raw.toString('utf8'))))
    })
    await once(socket, 'open')
    const wait = async <T extends SyncFrame['type']>(type: T) => {
      await expect.poll(() => frames.some((frame) => frame.type === type)).toBe(true)
      return frames.find((frame): frame is Extract<SyncFrame, { type: T }> => frame.type === type)!
    }
    return { socket, frames, wait, ticket }
  }
  return { runtime, open, address }
}
it.each([{ taskIds: [] }, { taskIds: ['task'] }])(
  'keeps scoped paged sync history lazy for selection $taskIds',
  async ({ taskIds }) => {
    const { runtime, open } = await setup()
    const fullWorkspace = vi.spyOn(runtime.services.store, 'publicCompleteTasks')
    const fullTask = vi.spyOn(runtime.services.store, 'publicTask')
    const client = await open(token, 5, taskIds, true)
    client.socket.send(JSON.stringify({ type: 'resume' }))
    const baseline = await client.wait('snapshot')
    expect(baseline.snapshot.detailTaskIds).toEqual(taskIds)
    expect(baseline.snapshot.workspace.tasks[0]?.messages.length).toBe(taskIds.length ? 1 : 0)
    runtime.services.store.updateTask('task', (task) => ({ ...task, title: 'Updated' }))
    const delta = await client.wait('delta')
    expect(applySnapshotDelta(baseline.snapshot, delta.delta).workspace.tasks[0]?.title).toBe(
      'Updated',
    )
    expect(fullWorkspace).not.toHaveBeenCalled()
    expect(fullTask).not.toHaveBeenCalled()
    fullWorkspace.mockRestore()
    fullTask.mockRestore()
  },
)
it('changes thread details on one connection without changing another client or losing later deltas', async () => {
  const { runtime, open } = await setup()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      ...workspace.tasks,
      {
        ...runtime.services.store.task(workspace.tasks[0]!.id),
        id: 'second',
        title: 'Second',
        messages: [{ id: 'other', role: 'assistant', text: 'Second history' }],
      },
    ],
  }))
  const first = await open(token, 5, ['task'])
  const shared = await open(token, 5, ['task'])
  for (const client of [first, shared]) {
    client.socket.send(JSON.stringify({ type: 'resume' }))
    expect((await client.wait('snapshot')).snapshot.detailTaskIds).toEqual(['task'])
    client.frames.length = 0
  }
  first.socket.send(JSON.stringify({ type: 'watch', tasks: ['second'], scopes: ['second'] }))
  const selected = await first.wait('snapshot')
  expect(selected.snapshot.detailTaskIds).toEqual(['second'])
  expect(selected.snapshot.workspace.tasks.find((task) => task.id === 'task')?.messages).toEqual([])
  expect(
    selected.snapshot.workspace.tasks.find((task) => task.id === 'second')?.messages[0]?.text,
  ).toBe('Second history')
  expect(shared.frames.some((frame) => frame.type === 'snapshot')).toBe(false)
  first.frames.length = 0
  runtime.services.store.updateTaskHistory('second', (task) => ({
    ...task,
    messages: task.messages.map((message) => ({ ...message, text: message.text + ' updated' })),
  }))
  const delta = await first.wait('delta')
  expect(delta.epoch).toBe(selected.epoch)
  expect(
    applySnapshotDelta(selected.snapshot, delta.delta).workspace.tasks.find(
      (task) => task.id === 'second',
    )?.messages[0]?.text,
  ).toBe('Second history updated')
  const other = await shared.wait('delta')
  expect(other.delta.workspace.tasks?.changes.some((change) => change.messages)).toBe(false)
  first.frames.length = 0
  first.socket.send(JSON.stringify({ type: 'watch', tasks: ['task'], scopes: [] }))
  expect((await first.wait('snapshot')).snapshot.detailTaskIds).toEqual(['task'])
  expect(first.socket.readyState).toBe(WebSocket.OPEN)
})
it('pushes small deltas and replays updates after reconnect without a second baseline', async () => {
  const { runtime, open } = await setup()
  const first = await open()
  first.socket.send(JSON.stringify({ type: 'resume' }))
  const baseline = await first.wait('snapshot')
  runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    messages: task.messages.map((m) => ({ ...m, text: m.text + 'Next' })),
  }))
  const delta = await first.wait('delta')
  expect(delta.base).toBe(baseline.sequence)
  expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(baseline).length / 10)
  expect(
    applySnapshotDelta(baseline.snapshot, delta.delta).workspace.tasks[0]!.messages[0]!.text,
  ).toMatch(/Next$/)
  first.socket.close()
  await once(first.socket, 'close')
  const second = await open()
  second.socket.send(
    JSON.stringify({ type: 'resume', epoch: baseline.epoch, sequence: baseline.sequence }),
  )
  expect(await second.wait('delta')).toEqual(delta)
  await second.wait('heartbeat')
  expect(second.frames.some((f) => f.type === 'snapshot')).toBe(false)
  second.frames.length = 0
  second.socket.send(
    JSON.stringify({ type: 'resume', epoch: 'old-server', sequence: baseline.sequence }),
  )
  expect((await second.wait('snapshot')).sequence).toBe(delta.sequence)
})
it('negotiates field deltas while keeping legacy clients on complete task metadata', async () => {
  const { runtime, open } = await setup()
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    error: 'Previous failure',
    files: [
      {
        path: 'large.txt',
        before: 'Before '.repeat(10000),
        after: 'After '.repeat(10000),
        viewed: false,
      },
    ],
  }))
  const legacy = await open(token, 2)
  const current = await open(token, 3)
  legacy.socket.send(JSON.stringify({ type: 'resume' }))
  current.socket.send(JSON.stringify({ type: 'resume' }))
  const baseline = await current.wait('snapshot')
  await legacy.wait('snapshot')
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    draft: 'Next input',
    error: undefined,
  }))
  const next = await current.wait('delta')
  const old = await legacy.wait('delta')
  expect(next.delta.workspace.tasks?.changes[0]?.fields).toBeUndefined()
  expect(next.delta.workspace.tasks?.changes[0]?.fieldDelta?.values.draft).toBe('Next input')
  expect(next.delta.workspace.tasks?.changes[0]?.fieldDelta?.removed).toContain('error')
  expect(old.delta.workspace.tasks?.changes[0]?.fields?.draft).toBe('Next input')
  expect(old.delta.workspace.tasks?.changes[0]?.fieldDelta).toBeUndefined()
  expect(JSON.stringify(next).length).toBeLessThan(JSON.stringify(old).length / 100)
  const restored = applySnapshotDelta(baseline.snapshot, next.delta)
  expect(restored.workspace.tasks[0]?.draft).toBe('Next input')
  expect(restored.workspace.tasks[0]?.error).toBeUndefined()
  expect(restored.workspace.tasks[0]?.files).toBe(baseline.snapshot.workspace.tasks[0]?.files)
})
it('streams scoped activity and rejects reused tickets and revoked devices', async () => {
  const { runtime, open, address } = await setup()
  const credential = 'runtime-sync-phone-with-at-least-32-characters'
  const device = runtime.services.devices.add('Phone', credential)
  const client = await open(credential)
  client.socket.send(JSON.stringify({ type: 'resume' }))
  const baseline = await client.wait('snapshot')
  expect(baseline.snapshot.owner).toBe(false)
  expect(baseline.snapshot.devices).toHaveLength(1)
  client.socket.send(JSON.stringify({ type: 'watch', scopes: ['task'] }))
  expect((await client.wait('activity')).events).toEqual([])
  client.frames.length = 0
  runtime.services.activity.add('tool', 'task', 'Command', { status: 'running' }, 'command')
  const activity = await client.wait('activity')
  expect(activity.order).toEqual(['command'])
  expect(activity.events[0]!.summary).toBe('Command')
  const reused = new WebSocket(`${address.replace('http:', 'ws:')}/ws/sync?ticket=${client.ticket}`)
  await expect(once(reused, 'open')).rejects.toThrow('401')
  const closed = once(client.socket, 'close')
  runtime.services.devices.revoke(device)
  expect((await closed)[0]).toBe(1008)
})

it('shares client activity watches and resumes its cursor after background teardown', async () => {
  const { startRuntimeSync, watchRuntimeActivity, runtimeSyncOnline } =
    await import('@dovo/protocol')
  const { runtime, address } = await setup()
  vi.stubGlobal('WebSocket', WebSocket)
  cleanup.push(() => {
    vi.unstubAllGlobals()
  })
  const connection = { address, token }
  const snapshots: Array<import('@dovo/protocol').RuntimeSnapshot> = []
  let activity = ''
  const unwatch = watchRuntimeActivity(connection, 'task', (events) => {
    activity = events[0]?.summary ?? ''
  })
  cleanup.push(unwatch)
  const first = startRuntimeSync(connection, { onSnapshot: (value) => snapshots.push(value) })
  cleanup.push(first.stop)
  await expect.poll(() => first.online()).toBe(true)
  expect(runtimeSyncOnline(connection, 'task')).toBe(true)
  runtime.services.activity.add('tool', 'task', 'First tool', {}, 'tool')
  await expect.poll(() => activity).toBe('First tool')
  first.stop()
  expect(runtimeSyncOnline(connection)).toBe(false)
  runtime.services.store.updateTask('task', (task) => ({ ...task, title: 'While backgrounded' }))
  const second = startRuntimeSync(connection, { onSnapshot: (value) => snapshots.push(value) })
  cleanup.push(second.stop)
  await expect.poll(() => second.online()).toBe(true)
  expect(snapshots.at(-1)!.workspace.tasks[0]!.title).toBe('While backgrounded')
  runtime.services.activity.add('tool', 'task', 'Tool updated', {}, 'tool')
  await expect.poll(() => activity).toBe('Tool updated')
})

it('streams internet consent requests only to the owner and updates after a decision', async () => {
  const { startRuntimeSync } = await import('@dovo/protocol')
  const { runtime, address, open } = await setup()
  const credential = 'internet-upgrade-phone-token-at-least-32-characters'
  const deviceId = runtime.services.devices.add('Upgrade phone', credential)
  vi.stubGlobal('WebSocket', WebSocket)
  cleanup.push(() => {
    vi.unstubAllGlobals()
  })
  const snapshots: Array<import('@dovo/protocol').RuntimeSnapshot> = []
  const owner = startRuntimeSync(
    { address, token },
    { onSnapshot: (snapshot) => snapshots.push(snapshot) },
  )
  cleanup.push(owner.stop)
  await expect.poll(() => owner.online()).toBe(true)
  const request = runtime.services.peers.upgrades.request(deviceId, 'dovo')
  await expect.poll(() => snapshots.at(-1)?.pendingPeerUpgrades?.[0]?.id).toBe(request.id)
  const phone = await open(credential)
  phone.socket.send(JSON.stringify({ type: 'resume' }))
  expect((await phone.wait('snapshot')).snapshot.pendingPeerUpgrades).toEqual([])
  runtime.services.peers.upgrades.approve(request.id, false)
  await expect.poll(() => snapshots.at(-1)?.pendingPeerUpgrades).toEqual([])
})

it('shares snapshot preparation without sharing device trust views or replay epochs', async () => {
  const { runtime, open } = await setup()
  const credential = 'second-sync-phone-with-at-least-32-characters'
  runtime.services.devices.add('Phone', credential)
  runtime.services.devices.add('Other phone', 'other-sync-device-with-at-least-32-characters')
  const available = vi.spyOn(runtime.services.scratch, 'available')
  cleanup.push(() => {
    available.mockRestore()
  })
  const owner = await open()
  owner.socket.send(JSON.stringify({ type: 'resume' }))
  const first = await owner.wait('snapshot')
  const phone = await open(credential)
  phone.socket.send(
    JSON.stringify({ type: 'resume', epoch: first.epoch, sequence: first.sequence }),
  )
  const second = await phone.wait('snapshot')
  expect(second.epoch).not.toBe(first.epoch)
  expect(first.snapshot.devices).toHaveLength(2)
  expect(second.snapshot.owner).toBe(false)
  expect(second.snapshot.devices).toHaveLength(1)
  expect(second.snapshot.pendingDevices).toEqual([])
  expect(available).toHaveBeenCalledOnce()
})

it.each([false, true])(
  'streams Connect and relay status with account-derived device=%s setup permissions',
  async (accountDerived) => {
    const { runtime, open } = await setup()
    const credential = 'connect-status-phone-with-at-least-32-characters'
    const device = runtime.services.devices.add('Phone', credential)
    runtime.services.devices.add('Other phone', 'connect-status-other-device-token')
    const status = vi
      .spyOn(runtime.services.peers.internet, 'status')
      .mockReturnValue({ enabled: false, connected: false, error: '' })
    const contains = vi.spyOn(runtime.services.peers.internet, 'contains').mockReturnValue(false)
    cleanup.push(() => {
      status.mockRestore()
      contains.mockRestore()
    })
    const owner = await open()
    owner.socket.send(JSON.stringify({ type: 'resume' }))
    await owner.wait('snapshot')
    const phone = await open(credential)
    // Account credentials normally enter through their own WebRTC tunnel. Keep that
    // transport guard intact while checking the authenticated sync projection here.
    contains.mockImplementation((id) => accountDerived && id === device)
    phone.socket.send(JSON.stringify({ type: 'resume' }))
    const baseline = (await phone.wait('snapshot')).snapshot
    expect(baseline.internet).toEqual({ enabled: false, connected: false, error: '' })
    expect(baseline.internetSetupSupported).toBe(!accountDerived)
    expect(baseline.relaySetupSupported).toBe(!accountDerived)
    expect(baseline.devices).toHaveLength(1)
    expect(baseline.pendingDevices).toEqual([])
    expect(baseline.pendingPeerUpgrades).toEqual([])

    status.mockReturnValue({ enabled: true, connected: true, error: '' })
    const connected = applySnapshotDelta(baseline, (await phone.wait('delta')).delta)
    expect(connected.internet).toEqual({ enabled: true, connected: true, error: '' })
    phone.frames.length = 0
    runtime.services.peers.relay.set({
      urls: ['turns:relay.example.com:5349?transport=tcp'],
      username: 'private-username',
      credential: 'private-password',
    })
    const relayDelta = await phone.wait('delta')
    const configured = applySnapshotDelta(connected, relayDelta.delta)
    expect(configured.relaySettings).toEqual({
      mode: 'custom',
      connectionMode: 'automatic',
      configured: true,
      urls: ['turns:relay.example.com:5349?transport=tcp'],
    })
    expect(JSON.stringify(relayDelta)).not.toContain('private-password')
    expect(JSON.stringify(relayDelta)).not.toContain('private-username')
    expect(configured.internetSetupSupported).toBe(!accountDerived)
    expect(configured.relaySetupSupported).toBe(!accountDerived)
  },
)

it('keeps a snapshot revision paired with the workspace captured before asynchronous preparation', async () => {
  const { Effect } = await import('effect')
  const { runtimeSnapshot } = await import('./support/runtime-snapshot.js')
  const { runtime } = await setup()
  let release: (value: undefined) => void = () => {}
  const waiting = new Promise<undefined>((resolve) => {
    release = resolve
  })
  const available = vi.spyOn(runtime.services.scratch, 'available').mockReturnValue(waiting)
  cleanup.push(() => {
    available.mockRestore()
  })
  const revision = runtime.services.store.version()
  const pending = Effect.runPromise(runtimeSnapshot(runtime.services, { id: 'owner', owner: true }))
  await expect.poll(() => available.mock.calls.length).toBeGreaterThan(0)
  runtime.services.store.updateTask('task', (task) => ({ ...task, title: 'Newer workspace' }))
  release(undefined)
  const snapshot = await pending
  expect(snapshot.revision).toBe(revision)
  expect(snapshot.workspace.tasks[0]!.title).toBe('Task')
})

it('delivers project-copy progress without writing a workspace revision', async () => {
  const { runtime, open } = await setup()
  const client = await open(token, 5)
  client.socket.send(JSON.stringify({ type: 'resume' }))
  const baseline = await client.wait('snapshot')
  const list = vi.spyOn(runtime.services.projectTransfers, 'list').mockReturnValue([
    {
      id: 'copy',
      repositoryId: 'project',
      targetId: 'other',
      targetName: 'Other computer',
      transport: 'p2p',
      state: 'copying',
      bytes: 250,
      totalBytes: 1000,
      updatedAt: Date.now(),
    },
  ])
  cleanup.push(() => {
    list.mockRestore()
  })
  runtime.services.projectTransfers.revision++
  const delta = await client.wait('delta')
  const next = applySnapshotDelta(baseline.snapshot, delta.delta)
  expect(next.revision).toBe(baseline.snapshot.revision)
  expect(next.projectTransfers?.[0]).toMatchObject({ state: 'copying', bytes: 250 })
})

it('sends lightweight shells and only subscribed history, with safe replay per subscription', async () => {
  const { runtime, open } = await setup()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      workspace.tasks[0]!,
      {
        ...runtime.services.store.task(workspace.tasks[0]!.id),
        id: 'other',
        draft: 'Unsent draft',
        messages: [
          { id: 'other-reply', role: 'assistant', text: 'Other secret history '.repeat(10000) },
        ],
      },
    ],
  }))
  const shell = await open(token, 4)
  shell.socket.send(JSON.stringify({ type: 'resume' }))
  const lightweight = await shell.wait('snapshot')
  expect(lightweight.snapshot.detailTaskIds).toEqual([])
  expect(lightweight.snapshot.workspace.tasks.every((task) => !task.messages.length)).toBe(true)
  expect(lightweight.snapshot.workspace.tasks[1]?.draft).toBe('Unsent draft')
  const detail = await open(token, 4, ['task'])
  detail.socket.send(
    JSON.stringify({ type: 'resume', epoch: lightweight.epoch, sequence: lightweight.sequence }),
  )
  const baseline = await detail.wait('snapshot')
  expect(baseline.epoch).not.toBe(lightweight.epoch)
  expect(baseline.snapshot.workspace.tasks[0]?.messages).toHaveLength(1)
  expect(baseline.snapshot.workspace.tasks[1]?.messages).toEqual([])
  runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    messages: task.messages.map((message) => ({ ...message, text: message.text + 'New output' })),
  }))
  const delta = await detail.wait('delta')
  expect(JSON.stringify(delta)).not.toContain('Other secret history')
  expect(
    applySnapshotDelta(baseline.snapshot, delta.delta).workspace.tasks[0]?.messages[0]?.text,
  ).toMatch(/New output$/)
  detail.socket.close()
  await once(detail.socket, 'close')
  const resumed = await open(token, 4, ['task'])
  resumed.socket.send(
    JSON.stringify({ type: 'resume', epoch: baseline.epoch, sequence: baseline.sequence }),
  )
  await resumed.wait('delta')
  await resumed.wait('heartbeat')
  expect(resumed.frames.some((frame) => frame.type === 'snapshot')).toBe(false)
})
it('deduplicates authenticated HTTP mutations after lost acknowledgements without overwriting newer edits', async () => {
  const { runtime } = await setup()
  const address = `http://127.0.0.1:${runtime.port}`
  const patch = {
    collection: 'tasks',
    id: 'task',
    changes: { title: { before: 'Task', after: 'Edited from phone' } },
  }
  const request = () =>
    fetch(`${address}/api/workspace`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Dovo-Mutation-Id': 'action',
      },
      body: JSON.stringify(patch),
    })
  const first = await request()
  expect(first.status).toBe(200)
  const response = await first.json()
  runtime.services.store.updateTask('task', (task) => ({ ...task, title: 'Newer desktop edit' }))
  const retried = await request()
  expect(retried.status).toBe(200)
  expect(await retried.json()).toEqual({ ...response, revision: runtime.services.store.version() })
  expect(runtime.services.store.task('task').title).toBe('Newer desktop edit')
})

it('omits tool output and raw events over HTTP and sync by default, and refreshes details on opt-in', async () => {
  const { runtime, open, address } = await setup()
  const payload = {
    turnId: 'turn',
    toolId: 'command',
    status: 'completed',
    event: {
      item: {
        command: 'pnpm test',
        aggregatedOutput: 'secret-output'.repeat(1000),
        raw: 'raw-provider-data',
      },
    },
  }
  runtime.services.activity.add('tool', 'task', 'Command', payload, 'command')
  const call = async (includeDetails?: boolean) => {
    const response = await fetch(`${address}/api/activity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'task', kind: 'task-activity', includeDetails }),
    })
    expect(response.status).toBe(200)
    return decode((await import('@dovo/protocol')).activitySchema, await response.json())
  }
  const compact = await call()
  const full = await call(true)
  expect(compact.events[0]!.payload).toContain('pnpm test')
  expect(compact.events[0]!.payload).not.toContain('secret-output')
  expect(compact.events[0]!.payload).not.toContain('raw-provider-data')
  expect(full.events[0]!.payload).toContain('secret-output')
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 10)
  const client = await open()
  client.socket.send(JSON.stringify({ type: 'resume' }))
  await client.wait('snapshot')
  client.socket.send(JSON.stringify({ type: 'watch', scopes: ['task'] }))
  expect((await client.wait('activity')).events[0]!.payload).not.toContain('secret-output')
  client.frames.length = 0
  client.socket.send(JSON.stringify({ type: 'watch', scopes: ['task'], detailScopes: ['task'] }))
  expect((await client.wait('activity')).events[0]!.payload).toContain('secret-output')
  client.frames.length = 0
  client.socket.send(JSON.stringify({ type: 'watch', scopes: ['task'] }))
  expect((await client.wait('activity')).events[0]!.payload).not.toContain('secret-output')
  expect(
    runtime.services.activity.list('', 'task-activity', 0, 'task').events[0]!.payload,
  ).toContain('raw-provider-data')
})
it('pushes created artifacts through compact activity, retains them past later calls and removes expired tiles', async () => {
  const { startRuntimeSync, watchRuntimeActivity } = await import('@dovo/protocol')
  const { runtime, address } = await setup()
  runtime.services.preferences.save({ enableArtifacts: true, settledArtifactRetention: '7-days' })
  vi.stubGlobal('WebSocket', WebSocket)
  cleanup.push(() => {
    vi.unstubAllGlobals()
  })
  const connection = { address, token }
  let references: ReturnType<typeof artifactReferences> = []
  let count = 0
  let wire = ''
  cleanup.push(
    watchRuntimeActivity(connection, 'task', (events) => {
      references = events.flatMap((event) => artifactReferences(event.payload))
      count = events.length
      wire = JSON.stringify(events)
    }),
  )
  const sync = startRuntimeSync(connection, { onSnapshot: () => {} })
  cleanup.push(sync.stop)
  await expect.poll(() => sync.online()).toBe(true)
  const artifact = await runtime.services.artifacts.write({
    taskId: 'task',
    title: 'Live preview',
    format: 'html',
    content: '<p>Private artifact body</p>',
  })
  await expect.poll(() => references.map((reference) => reference.id)).toEqual([artifact.id])
  runtime.services.db
    .prepare('UPDATE activity SET time=? WHERE id=?')
    .run('2026-01-01T00:00:00Z', `artifact:${artifact.id}:1`)
  for (let index = 0; index < 120; index++)
    runtime.services.activity.add('tool', 'task', 'Later command', {}, `later-${index}`)
  await expect.poll(() => count).toBe(101)
  expect(references).toHaveLength(1)
  expect(wire).not.toContain('Private artifact body')
  runtime.services.store.updateTask('task', (task) => ({ ...task, archived: true }))
  expect(runtime.services.artifacts.prune(Date.now() + 8 * 86_400_000)).toBe(1)
  await expect.poll(() => references).toEqual([])
})

it('updates a shared client activity subscription when detail visibility changes', async () => {
  const { startRuntimeSync, watchRuntimeActivity } = await import('@dovo/protocol')
  const { runtime, address } = await setup()
  vi.stubGlobal('WebSocket', WebSocket)
  cleanup.push(() => {
    vi.unstubAllGlobals()
  })
  runtime.services.activity.add(
    'tool',
    'task',
    'Command',
    {
      turnId: 'turn',
      toolId: 'cmd',
      status: 'completed',
      event: { item: { command: 'pwd', aggregatedOutput: 'full-client-output' } },
    },
    'command',
  )
  const connection = { address, token }
  let latest = ''
  const sync = startRuntimeSync(connection, { onSnapshot: () => {} })
  cleanup.push(sync.stop)
  let stop = watchRuntimeActivity(connection, 'task', (events) => {
    latest = events[0]?.payload ?? ''
  })
  await expect.poll(() => latest.includes('pwd')).toBe(true)
  expect(latest).not.toContain('full-client-output')
  stop()
  stop = watchRuntimeActivity(
    connection,
    'task',
    (events) => {
      latest = events[0]?.payload ?? ''
    },
    true,
  )
  await expect.poll(() => latest.includes('full-client-output')).toBe(true)
  stop()
  stop = watchRuntimeActivity(connection, 'task', (events) => {
    latest = events[0]?.payload ?? ''
  })
  cleanup.push(() => stop())
  await expect
    .poll(() => latest.includes('pwd') && !latest.includes('full-client-output'))
    .toBe(true)
})

it('avoids repeated idle defaults, devices and job projections and observes service invalidation', async () => {
  const { runtime, open } = await setup()
  const client = await open()
  client.socket.send(JSON.stringify({ type: 'resume' }))
  await client.wait('snapshot')
  const s = runtime.services
  const listJobs = vi.spyOn(s.jobs, 'list')
  const listDevices = vi.spyOn(s.devices, 'list')
  const prepare = vi.spyOn(s.db, 'prepare')
  try {
    await new Promise((resolve) => setTimeout(resolve, 650))
    expect(listJobs).not.toHaveBeenCalled()
    expect(listDevices).not.toHaveBeenCalled()
    expect(
      prepare.mock.calls.filter(([sql]) =>
        /provisional_devices|FROM documents WHERE id =/.test(sql),
      ),
    ).toHaveLength(0)
    s.defaults.save({
      ...s.defaults.get(),
      harness: { ...s.defaults.get().harness, model: 'sync-invalidated' },
    })
    s.devices.add('New device', 'new-device-token')
    const delta = await client.wait('delta')
    expect(JSON.stringify(delta)).toContain('sync-invalidated')
    expect(JSON.stringify(delta)).toContain('New device')
  } finally {
    listJobs.mockRestore()
    listDevices.mockRestore()
    prepare.mockRestore()
  }
})

it('shares activity preparation across clients, skips unrelated updates and releases the last subscriber', async () => {
  const { runtime, open } = await setup()
  const clients = await Promise.all([open(), open(), open()])
  const list = vi.spyOn(runtime.services.activity, 'list')
  for (const client of clients) {
    client.socket.send(JSON.stringify({ type: 'resume' }))
    await client.wait('snapshot')
    client.socket.send(JSON.stringify({ type: 'watch', scopes: ['task'] }))
    await client.wait('activity')
  }
  expect(list).toHaveBeenCalledTimes(1)
  list.mockClear()
  for (let index = 0; index < 5; index++)
    runtime.services.activity.add('tool', 'child', 'Child output')
  await new Promise((resolve) => setTimeout(resolve, 650))
  expect(list).not.toHaveBeenCalled()
  for (const client of clients) client.frames.length = 0
  runtime.services.activity.add('tool', 'task', 'Updated command', {}, 'command')
  for (const client of clients) expect((await client.wait('activity')).order).toEqual(['command'])
  expect(list).toHaveBeenCalledTimes(1)
  await Promise.all(
    clients.map(async (client) => {
      const closed = once(client.socket, 'close')
      client.socket.terminate()
      await closed
    }),
  )
  const next = await open()
  next.socket.send(JSON.stringify({ type: 'resume' }))
  await next.wait('snapshot')
  next.socket.send(JSON.stringify({ type: 'watch', scopes: ['task'] }))
  expect((await next.wait('activity')).order).toEqual(['command'])
  expect(list).toHaveBeenCalledTimes(2)
})
it('automatically reconciles stale patches and protects the durable recovery endpoint', async () => {
  const { runtime, address } = await setup()
  const response = await fetch(`${address}/api/workspace`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection: 'tasks',
      id: 'task',
      changes: {
        title: { before: 'Outdated', after: 'Local title' },
        draft: { before: '', after: 'Independent draft' },
      },
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ reconciled: true })
  expect(runtime.services.store.task('task')).toMatchObject({
    title: 'Task',
    draft: 'Independent draft',
  })
  expect((await fetch(`${address}/api/workspace/recovered-edits`)).status).toBe(401)
  const recovered = await fetch(`${address}/api/workspace/recovered-edits`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(recovered.status).toBe(200)
  expect(await recovered.json()).toMatchObject({
    edits: [{ patch: { changes: { title: { after: 'Local title' } } } }],
  })
})
it('settles rejected edits durably and lets the next independent HTTP edit proceed', async () => {
  const { runtime, address } = await setup()
  runtime.services.store.updateTask('task', (task) => ({ ...task, status: 'running' }))
  const patch = {
    collection: 'tasks',
    id: 'task',
    changes: {
      title: { before: 'Task', after: 'Local title' },
      agentId: { before: '', after: 'local-agent' },
    },
  }
  const request = (input: unknown, id: string) =>
    fetch(`${address}/api/workspace`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Dovo-Mutation-Id': id,
      },
      body: JSON.stringify(input),
    })
  const rejected = await request(patch, 'rejected')
  expect(rejected.status).toBe(200)
  expect(await rejected.json()).toMatchObject({
    outcome: 'rejected',
    reason: 'Stop the active turn before changing task settings',
    recoveryId: expect.any(String),
  })
  expect(runtime.services.store.task('task').title).toBe('Task')
  expect(runtime.services.store.recoveredEdits()).toHaveLength(1)
  expect(runtime.services.store.recoveredEdits()[0].patch).toEqual(patch)
  const next = await request(
    {
      collection: 'tasks',
      id: 'task',
      changes: { title: { before: 'Task', after: 'Independent title' } },
    },
    'next',
  )
  expect(next.status).toBe(200)
  expect(runtime.services.store.task('task').title).toBe('Independent title')
  const again = await request(patch, 'rejected')
  expect(await again.json()).toMatchObject({ outcome: 'rejected' })
  expect(runtime.services.store.recoveredEdits()).toHaveLength(1)
})
it('acknowledges retries after value reversal and deletion without repeating the operation', async () => {
  const { runtime, address } = await setup()
  const input = {
    collection: 'tasks',
    id: 'task',
    changes: { title: { before: 'Task', after: 'B' } },
  }
  const request = () =>
    fetch(`${address}/api/workspace`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Dovo-Mutation-Id': 'aba',
      },
      body: JSON.stringify(input),
    })
  expect((await request()).status).toBe(200)
  runtime.services.store.updateTask('task', (task) => ({ ...task, title: 'Task' }))
  expect((await request()).status).toBe(200)
  expect(runtime.services.store.task('task').title).toBe('Task')
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [] }))
  expect((await request()).status).toBe(200)
  expect(runtime.services.store.get().tasks).toEqual([])
})
it('archives conflicts even when another field makes the complete edit invalid', async () => {
  const { runtime, address } = await setup()
  const input = {
    collection: 'tasks',
    id: 'task',
    changes: {
      title: { before: 'Outdated', after: 'Local' },
      pinned: { before: null, after: 'not-a-boolean' },
    },
  }
  const response = await fetch(`${address}/api/workspace`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Dovo-Mutation-Id': 'invalid-compound',
    },
    body: JSON.stringify(input),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ outcome: 'rejected' })
  expect(runtime.services.store.recoveredEdits()[0].patch).toEqual(input)
  expect(runtime.services.store.task('task').title).toBe('Task')
})

it('exposes older recovery pages and rejects invalid cursors', async () => {
  const { runtime, address } = await setup()
  for (let index = 0; index < 102; index++)
    runtime.services.store.preserveEdit(
      {
        collection: 'tasks',
        id: 'task',
        changes: { title: { before: 'Before', after: String(index) } },
      },
      null,
    )
  const headers = { Authorization: `Bearer ${token}` }
  const first = decode(
    workspaceRecoveriesSchema,
    await (await fetch(`${address}/api/workspace/recovered-edits`, { headers })).json(),
  )
  expect(first.edits).toHaveLength(100)
  expect(first.nextCursor).toBeDefined()
  const second = decode(
    workspaceRecoveriesSchema,
    await (
      await fetch(`${address}/api/workspace/recovered-edits?cursor=${first.nextCursor}`, {
        headers,
      })
    ).json(),
  )
  expect(second.edits).toHaveLength(2)
  expect(second.nextCursor).toBeUndefined()
  expect(new Set([...first.edits, ...second.edits].map((edit) => edit.id)).size).toBe(102)
  expect(
    (await fetch(`${address}/api/workspace/recovered-edits?cursor=NaN`, { headers })).status,
  ).toBe(400)
})
