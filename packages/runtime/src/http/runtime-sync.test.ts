import { afterEach, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { applySnapshotDelta, decode, syncFrameSchema, type SyncFrame } from '@dovo/protocol'
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
  const open = async (credential = token, format = 1, taskIds: string[] = []) => {
    const query = new URLSearchParams({ format: String(format) })
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
it('pushes small deltas and replays updates after reconnect without a second baseline', async () => {
  const { runtime, open } = await setup()
  const first = await open()
  first.socket.send(JSON.stringify({ type: 'resume' }))
  const baseline = await first.wait('snapshot')
  runtime.services.store.updateTask('task', (task) => ({
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

it('sends lightweight shells and only subscribed history, with safe replay per subscription', async () => {
  const { runtime, open } = await setup()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      workspace.tasks[0]!,
      {
        ...workspace.tasks[0]!,
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
  runtime.services.store.updateTask('task', (task) => ({
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
  expect(await retried.json()).toEqual(response)
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
