import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../index.js'
import { compactActivityEvents, toolImageReferences } from '@dovo/protocol'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const token = 'task-image-test-owner-with-at-least-32-characters'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6K0sAAAAASUVORK5CYII=',
  'base64',
)
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-image-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: ['task', 'other'].map((id) => ({
      id,
      title: id,
      agentId: '',
      repositoryId: '',
      status: 'draft' as const,
      createdAt: '2026-10-10',
      messages: [],
      files: [],
      draft: '',
      example: false,
    })),
  }))
  vi.spyOn(runtime.services.checkouts, 'directory').mockResolvedValue(directory)
  const read = (body: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/images/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { runtime, directory, read }
}
it('requires pairing and reads compact references only from their own task', async () => {
  const { runtime, read } = await setup()
  runtime.services.activity.add(
    'tool',
    'task',
    'Screenshot',
    {
      toolId: 'shot',
      result: { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] },
    },
    'image-event',
  )
  const events = runtime.services.activity.list('', 'tool', 0, 'task').events
  const ref = toolImageReferences(compactActivityEvents(events)[0]!.payload)[0]!
  expect(ref).toMatchObject({ eventId: 'image-event', index: 0 })
  const input = { taskId: 'task', eventId: ref.eventId, index: ref.index }
  expect((await read(input, 'wrong')).status).toBe(401)
  expect(await (await read(input)).json()).toEqual({
    uri: `data:image/png;base64,${png.toString('base64')}`,
  })
  expect((await read({ ...input, taskId: 'other' })).status).toBe(404)
  expect((await read({ ...input, path: 'extra' })).status).toBe(400)
})
it('reads checkout images and assistant-shared temp images while denying unrelated files', async () => {
  const { runtime, directory, read } = await setup()
  await writeFile(join(directory, 'shot.png'), png)
  expect((await read({ taskId: 'task', path: 'shot.png' })).status).toBe(200)
  const outside = await mkdtemp(join(tmpdir(), 'dovo-outside-image-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  const path = join(outside, 'a b.png')
  await writeFile(path, png)
  expect((await read({ taskId: 'task', path })).status).toBe(403)
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    messages: [{ id: 'user', role: 'user', text: `![Shot](<${path}>)` }],
  }))
  expect((await read({ taskId: 'task', path })).status).toBe(403)
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    messages: [{ id: 'assistant', role: 'assistant', text: `![Shot](<${path}>)` }],
  }))
  expect((await read({ taskId: 'task', path })).status).toBe(200)
  await writeFile(join(directory, 'fake.png'), 'not an image')
  expect((await read({ taskId: 'task', path: 'fake.png' })).status).toBe(415)
  expect((await read({ taskId: 'task', path: 'missing.png' })).status).toBe(404)
})
