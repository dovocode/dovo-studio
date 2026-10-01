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
  const open = async (credential = token) => {
    const response = await fetch(`${address}/api/sync/ticket`, {
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
