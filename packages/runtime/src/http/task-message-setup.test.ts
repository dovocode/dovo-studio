import { expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'

it('accepts first-message setup in one request, preserves renames and deduplicates title generation', async () => {
  const f = await fixture()
  const token = 'message-setup-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'New task',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    const order: string[] = []
    const selection = vi.spyOn(s.titles, 'selectProjectsEffect').mockImplementation(() =>
      Effect.sync(() => {
        order.push('project')
        return s.store.task(task.id)
      }),
    )
    const generate = vi
      .spyOn(s.titles, 'generateEffect')
      .mockReturnValue(Effect.succeed({ title: 'Generated title' }))
    const send = s.tasks.sendEffect.bind(s.tasks)
    vi.spyOn(s.tasks, 'sendEffect').mockImplementation((...args) => {
      order.push('send')
      return send(...args)
    })
    const call = (input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/message`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const input = {
      id: task.id,
      messageId: 'first',
      text: 'Fix startup',
      queueOnly: true,
      selectProject: true,
      initialTitle: { before: 'New task', after: 'Fix startup' },
    }
    expect((await call(input)).status).toBe(200)
    expect(order).toEqual(['project', 'send'])
    expect(selection).toHaveBeenCalledWith({ id: task.id, requestId: 'first', text: 'Fix startup' })
    expect(s.store.task(task.id).title).toBe('Fix startup')
    expect(s.store.task(task.id).queue?.map((message) => message.id)).toEqual(['first'])
    expect(generate).toHaveBeenCalledTimes(1)
    expect((await call(input)).status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(1)
    const renamed = s.tasks.create({
      title: 'My title',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    expect(
      (
        await call({
          ...input,
          id: renamed.id,
          selectProject: false,
          messageId: 'renamed',
          initialTitle: { before: 'Old title', after: 'Do not overwrite' },
        })
      ).status,
    ).toBe(200)
    expect(s.store.task(renamed.id).title).toBe('My title')
    expect(generate).toHaveBeenCalledTimes(1)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
