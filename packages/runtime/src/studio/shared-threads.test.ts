import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  decryptSharedContent,
  mutableStruct,
  sharePacketSchema,
  sharingSigningKey,
  type SharePacket,
  type SharingWriterConfig,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { SharedThreads } from './shared-threads.js'

afterEach(() => vi.unstubAllGlobals())

const key = () => randomBytes(32).toString('hex')
const putSchema = mutableStruct({ packet: sharePacketSchema })

async function setup() {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'shared-thread-owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  // The service's own interval would race the explicit ticks below.
  await runtime.services.sharedThreads.dispose()
  const { db, store, devices, artifacts, mcpApps } = runtime.services
  const writer = () =>
    new SharedThreads(
      db,
      store,
      devices,
      artifacts,
      () => runtime.services.artifactFeeds,
      mcpApps,
      () => false,
    )
  store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Shared',
        repositoryId: 'repo',
        agentId: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        messages: [{ id: 'one', role: 'user', text: 'Hello' }],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  const config: SharingWriterConfig = {
    taskId: 'task',
    id: randomUUID(),
    origin: 'http://share.test',
    writerSecret: key(),
    contentKey: key(),
    signingSeed: key(),
    generation: randomUUID(),
  }
  const packets: SharePacket[] = []
  let generation = config.generation
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'PUT' && typeof init.body === 'string')
        packets.push(decode(putSchema, JSON.parse(init.body)).packet)
      return Response.json({ generation, version: packets.length })
    }),
  )
  const published = () => {
    const packet = packets.at(-1)
    if (!packet) throw new Error('Nothing was published')
    return decryptSharedContent(config.id, packet, {
      contentKey: config.contentKey,
      signingKey: sharingSigningKey(config.signingSeed),
      suggestionKey: key(),
    })
  }
  // `enable` publishes in the background; wait until that write has recorded its fingerprint.
  const settled = (count: number) =>
    vi.waitFor(() => {
      expect(packets).toHaveLength(count)
      expect(
        db.prepare('SELECT fingerprint FROM shared_thread_writers WHERE id=?').get(config.id),
      ).toMatchObject({ fingerprint: expect.stringMatching(/^(?!$)/) })
    })
  return {
    runtime,
    settled,
    store,
    writer,
    config,
    packets,
    published,
    rotate: (next: string) => (generation = next),
  }
}

it('skips loading and hashing unchanged shared threads while publishing title and history edits', async () => {
  const s = await setup()
  const threads = s.writer()
  try {
    await threads.enable(s.config, 'owner')
    await s.settled(1)
    const load = vi.spyOn(s.store, 'task')
    await threads.tick()
    await threads.tick()
    // Metadata outside the shared allowlist replaces the summary, but not its title or history.
    s.store.updateTask('task', (task) => ({ ...task, draft: 'unsent' }))
    await threads.tick()
    expect(load).not.toHaveBeenCalled()
    expect(s.packets).toHaveLength(1)

    s.store.updateTask('task', (task) => ({ ...task, title: 'Renamed' }))
    await threads.tick()
    expect(load).toHaveBeenCalledTimes(1)
    expect(s.packets).toHaveLength(2)
    expect(s.published()).toMatchObject({ title: 'Renamed' })

    s.store.updateTaskHistory('task', (task) => ({
      ...task,
      messages: [...task.messages, { id: 'two', role: 'assistant', text: 'Hi' }],
    }))
    await threads.tick()
    expect(s.packets).toHaveLength(3)
    expect(s.published()).toMatchObject({
      messages: [{ id: 'one' }, { id: 'two', text: 'Hi' }],
    })

    // Editing a message in place replaces the history facts too, even with the same count.
    s.store.updateTaskHistory('task', (task) => ({
      ...task,
      messages: task.messages.map((message) =>
        message.id === 'two' ? { ...message, text: 'Edited' } : message,
      ),
    }))
    await threads.tick()
    expect(s.packets).toHaveLength(4)
    expect(s.published()).toMatchObject({ messages: [{ id: 'one' }, { text: 'Edited' }] })
    load.mockClear()
    await threads.tick()
    expect(load).not.toHaveBeenCalled()
    expect(s.packets).toHaveLength(4)
  } finally {
    await threads.dispose()
    await s.runtime.close()
  }
})

it('still authorizes unchanged shared threads on every tick', async () => {
  const s = await setup()
  const threads = s.writer()
  try {
    await threads.enable(s.config, 'owner')
    await s.settled(1)
    await threads.tick()
    // Archiving touches neither title nor history, so only authorization can stop this writer.
    s.store.updateTask('task', (task) => ({ ...task, archived: true }))
    await threads.tick()
    expect(threads.status('task', s.config.id)).toEqual({
      enabled: true,
      error: 'Restore this thread before enabling updates',
    })
    expect(s.packets).toHaveLength(1)
  } finally {
    await threads.dispose()
    await s.runtime.close()
  }
})

it('hashes once after a restart, publishing only offline changes, and republishes new settings', async () => {
  const s = await setup()
  const first = s.writer()
  try {
    await first.enable(s.config, 'owner')
    await s.settled(1)
  } finally {
    await first.dispose()
  }
  const restarted = s.writer()
  const load = vi.spyOn(s.store, 'task')
  try {
    await restarted.tick()
    expect(load).toHaveBeenCalledTimes(1)
    expect(s.packets).toHaveLength(1)
    await restarted.tick()
    expect(load).toHaveBeenCalledTimes(1)
  } finally {
    await restarted.dispose()
  }
  s.store.updateTask('task', (task) => ({ ...task, title: 'Renamed while closed' }))
  const again = s.writer()
  try {
    await again.tick()
    expect(s.packets).toHaveLength(2)
    expect(s.published()).toMatchObject({ title: 'Renamed while closed' })

    const generation = s.rotate(randomUUID())
    await again.enable({ ...s.config, generation }, 'owner')
    await s.settled(3)
    expect(s.packets.at(-1)).toMatchObject({ generation })

    again.stop('task', s.config.id)
    s.store.updateTask('task', (task) => ({ ...task, title: 'Paused' }))
    await again.tick()
    expect(s.packets).toHaveLength(3)
  } finally {
    await again.dispose()
    await s.runtime.close()
  }
})
