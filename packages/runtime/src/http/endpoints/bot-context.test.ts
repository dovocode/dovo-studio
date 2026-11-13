import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botContextMessages, botResultSchema, decode } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

it('resets only future model context and preserves files, actions and the saved transcript across restart', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  const send = async (text: string) => {
    const messageId = randomUUID()
    expect(
      (await f.request('/api/tasks/message', { id: created.id, messageId, text })).status,
    ).toBe(200)
    await waitForRuntime(() => {
      const task = f.runtime.services.store.task(created.id)
      expect(task.messages.some((m) => m.id === messageId)).toBe(true)
      expect(task.status).toBe('review')
      expect(task.queue?.length ?? 0).toBe(0)
    })
  }
  await send('Keep this context')
  const turn = s.store.task(created.id).turns![0]
  await send('Exclude this context')
  const before = s.store.task(created.id)
  const input = { id: created.id, turnId: turn.id, expectedRevision: before.bot!.revision }
  expect((await f.request('/api/bots/reset-context', input)).status).toBe(200)
  const after = s.store.task(created.id)
  expect(after.messages).toEqual(before.messages)
  expect(after.files).toEqual(before.files)
  expect(after.threadActions).toEqual(before.threadActions)
  expect(after.turns).toEqual(before.turns)
  expect(after.sessionId).toBeUndefined()
  expect(after.consumedMessageIds).toBeUndefined()
  expect(
    botContextMessages(after.messages, after.bot).some((m) => m.text === 'Exclude this context'),
  ).toBe(false)
  expect((await f.request('/api/tasks/fork', { id: created.id, turnId: turn.id })).status).toBe(409)
  await f.restart()
  await send('New request after reset')
  expect(f.inputs.at(-1)?.sessionId).toBeUndefined()
  expect(f.inputs.at(-1)?.prompt).toContain('Keep this context')
  expect(f.inputs.at(-1)?.prompt).toContain('New request after reset')
  expect(f.inputs.at(-1)?.prompt).not.toContain('Exclude this context')
  expect((await f.request('/api/bots/reset-context', input)).status).toBe(200)
  expect(f.runtime.services.store.task(created.id).bot?.contextResets).toHaveLength(1)
  expect(
    botContextMessages(
      f.runtime.services.store.task(created.id).messages,
      f.runtime.services.store.taskSummary(created.id).bot,
    ).some((m) => m.text === 'New request after reset'),
  ).toBe(true)
})

it('keeps the Bot interactive while delegated work runs and receives the child result afterward', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  let childId = ''
  let instructions = ''
  let release!: () => void
  const working = new Promise<void>((resolve) => {
    release = resolve
  })
  f.runtime.run.mockImplementation(async (run) => {
    if (run.taskId !== created.id) {
      await working
      run.onText('Checked child result')
    } else if (!childId) {
      instructions = run.agent.instructions
      childId = s.tasks.subagentSpawn({
        taskId: created.id,
        key: 'work',
        name: 'Worker',
        prompt: 'Do the longer work',
        provider: 'codex',
      }).id
      run.onText('Worker started. You can keep talking to me.')
    } else {
      if (s.store.taskSummary(childId).status === 'review')
        s.tasks.subagentResult(created.id, childId)
      run.onText('Still available')
    }
  })
  try {
    expect(
      (
        await f.request('/api/tasks/message', {
          id: created.id,
          messageId: randomUUID(),
          text: 'Do the longer work',
        })
      ).status,
    ).toBe(200)
    await waitForRuntime(() => {
      expect(s.store.task(created.id).turns?.at(-1)?.error).toBeUndefined()
      expect(childId).not.toBe('')
    })
    await waitForRuntime(() => expect(s.store.taskSummary(childId).status).toBe('running'))
    expect(instructions).toContain('finish your reply')
    expect(instructions).toContain('Expected output, and Verification')
    expect(instructions).toContain('Configured Bot routines on this computer')
    expect(instructions).toContain(JSON.stringify(created.id))
    await waitForRuntime(() => expect(s.store.taskSummary(created.id).status).toBe('review'))
    expect(
      (
        await f.request('/api/tasks/message', {
          id: created.id,
          messageId: randomUUID(),
          text: 'Can we discuss something else?',
        })
      ).status,
    ).toBe(200)
    await waitForRuntime(() =>
      expect(s.store.task(created.id).messages.some((m) => m.text === 'Still available')).toBe(
        true,
      ),
    )
    expect(s.store.taskSummary(childId).status).toBe('running')
  } finally {
    release()
  }
  await waitForRuntime(() => {
    expect(s.store.taskSummary(childId).status).toBe('review')
    expect(s.tasks.hasWorkingFamily(created.id)).toBe(false)
  })
})
