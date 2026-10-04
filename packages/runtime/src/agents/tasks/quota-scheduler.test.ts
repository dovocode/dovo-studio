import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'quota-scheduler-owner-token-long-enough',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: { shared: [], environment: { taskBehavior: { quotaResume: true } } },
    },
    false,
  )
  const task = s.tasks.create({
    title: 'Quota',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: 'Work',
  })
  const at = new Date(Date.now() - 1000).toISOString()
  s.store.updateTask(task.id, (task) => ({
    ...task,
    status: 'failed',
    snoozedUntil: at,
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: 'agent',
        provider: 'codex',
        model: '',
        startedAt: at,
        finishedAt: at,
        status: 'failed',
      },
    ],
    quotaContinuation: { turnId: 'turn', at, resume: true },
  }))
  return { s, id: task.id, at }
}
it('consumes continuation before admission and never loops after an admission failure', async () => {
  const { s, id } = await setup()
  const start = vi.spyOn(s.tasks, 'start').mockRejectedValue(new Error('Checkout busy'))
  await s.tasks.runScheduled()
  await s.tasks.runScheduled()
  expect(start).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledWith(id, true)
  expect(s.store.task(id).quotaContinuation).toBeUndefined()
  expect(s.store.task(id).snoozedUntil).toBeNull()
})
it.each(['disabled', 'new turn', 'snooze only', 'queued input'] as const)(
  'does not resume after %s',
  async (reason) => {
    const { s, id, at } = await setup()
    if (reason === 'disabled')
      s.defaults.save(
        {
          ...s.defaults.get(),
          scopedSettings: { shared: [], environment: { taskBehavior: { quotaResume: false } } },
        },
        false,
      )
    else
      s.store.updateTask(id, (task) => ({
        ...task,
        ...(reason === 'new turn'
          ? { quotaContinuation: { turnId: 'old', at, resume: true } }
          : {}),
        ...(reason === 'snooze only'
          ? { quotaContinuation: { turnId: 'turn', at, resume: false } }
          : {}),
        ...(reason === 'queued input'
          ? {
              queue: [
                { id: 'message', role: 'user', text: 'New work', attachments: [], createdAt: at },
              ],
            }
          : {}),
      }))
    const start = vi.spyOn(s.tasks, 'start').mockResolvedValue({ done: Promise.resolve() })
    await s.tasks.runScheduled()
    expect(start).not.toHaveBeenCalled()
    expect(s.store.task(id).quotaContinuation).toBeUndefined()
  },
)
