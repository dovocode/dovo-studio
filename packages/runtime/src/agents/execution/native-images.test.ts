import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  compactActivityEvents,
  defaultTaskHarness,
  toolImageReferences,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'
import type { AgentAdapter } from './types'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('carries native Codex image lifecycle events into compact activity and paired image reads', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'native-image-owner-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const { default: sharp } = await import('sharp')
  const image = await sharp({
    create: { width: 16, height: 8, channels: 3, background: '#124578' },
  })
    .png()
    .toBuffer()
  const s = runtime.services
  s.store.update(() => f.workspace)
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onSession('codex-images')
      for (const type of ['imageGeneration', 'imageView']) {
        const item =
          type === 'imageGeneration'
            ? { id: type, type, status: 'completed', result: image.toString('base64') }
            : { id: type, type, path: '/runtime-only/view.png' }
        run.onEvent?.('item/started', {
          threadId: 'codex-images',
          item: { ...item, status: 'inProgress' },
        })
        run.onEvent?.('item/completed', { threadId: 'codex-images', item })
      }
      run.onText('Image ready')
    },
  })
  const task: Task = {
    id: 'images',
    title: 'Images',
    repositoryId: 'repo',
    agentId: '',
    harness: { ...defaultTaskHarness('codex'), permission: 'ask' },
    status: 'draft',
    createdAt: '2026-10-16T20:00:00Z',
    messages: [{ id: 'request', role: 'user', text: 'Create an image' }],
    files: [],
    draft: '',
    example: false,
  }
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  await (
    await s.tasks.start(task.id)
  ).done
  const events = s.activity.list('', 'tool', 0, task.id).events
  expect(events).toHaveLength(4)
  const compact = compactActivityEvents(events)
  const outputs = compact.flatMap((event) => toolImageReferences(event.payload))
  expect(outputs).toHaveLength(2)
  expect(JSON.stringify(compact)).not.toContain(image.toString('base64'))
  const generated = outputs.find((reference) => reference.mime === 'image/png')!
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/images/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId: task.id,
      eventId: generated.eventId,
      index: generated.index,
      maxSize: 128,
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    uri: expect.stringContaining('data:image/webp;base64,'),
  })
})
