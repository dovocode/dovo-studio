import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import type { AgentAdapter } from '../../agents/execution/types'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Continue',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First request',
  })
  const send = (messageId: string, text: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, messageId, text }),
    })
  return { ...runtime.services, task, send }
}
it.each(['cancelled', 'failed', 'review'] as const)(
  'sending a follow-up resumes an idle %s thread and preserves queue order',
  async (status) => {
    const s = await setup()
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onText('Done')
    })
    vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
    s.tasks.queue.add(s.task.id, 'earlier', 'Earlier queued request')
    s.store.updateTask(s.task.id, (task) => ({
      ...task,
      status,
      queuePaused: true,
      restartRecovery: { kind: 'turn', automatic: false },
    }))
    expect((await s.send('next', 'New follow-up')).status).toBe(200)
    await waitForRuntime(() => {
      expect(s.store.task(s.task.id).status).toBe('review')
      expect(s.store.task(s.task.id).queue ?? []).toHaveLength(0)
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]?.[0].prompt).toContain('Earlier queued request')
    expect(run.mock.calls[1]?.[0].prompt).toContain('New follow-up')
    expect(s.store.task(s.task.id).queuePaused).toBe(false)
    expect(s.store.task(s.task.id).restartRecovery).toBeUndefined()
  },
)
it('sending while a turn is active does not resume a deliberately paused queue', async () => {
  const s = await setup()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    await gate
    input.onText('Done')
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    const active = await s.tasks.start(s.task.id)
    await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(1))
    s.tasks.queue.change(s.task.id, 'pause')
    expect((await s.send('later', 'Wait for my resume')).status).toBe(200)
    expect(s.store.task(s.task.id).queuePaused).toBe(true)
    release()
    await active.done
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.store.task(s.task.id).queue?.map((message) => message.id)).toEqual(['later'])
    expect((await s.send('later', 'Wait for my resume')).status).toBe(200)
    expect(s.store.task(s.task.id).queuePaused).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  } finally {
    release()
  }
})

it('sending to a stopped thread with no queued messages immediately starts the new turn', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Done'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  s.store.updateTask(s.task.id, (task) => ({ ...task, status: 'cancelled', queuePaused: true }))
  expect((await s.send('new', 'Continue with this change')).status).toBe(200)
  await waitForRuntime(() => {
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.store.task(s.task.id).status).toBe('review')
  })
  expect(run.mock.calls[0]?.[0].prompt).toContain('Continue with this change')
})
