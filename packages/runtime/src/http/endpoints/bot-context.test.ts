import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botContextMessages, botResultSchema, decode, defaultTaskHarness } from '@dovo/protocol'
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

it('hands a Bot to another harness and model while retaining its identity, draft and reset context', async () => {
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
  await send('Keep the release plan')
  const boundary = s.store.task(created.id).turns![0]
  await send('Excluded later context')
  expect(
    (
      await f.request('/api/bots/reset-context', {
        id: created.id,
        turnId: boundary.id,
        expectedRevision: s.store.task(created.id).bot!.revision,
      })
    ).status,
  ).toBe(200)
  s.store.updateTask(created.id, (task) => ({ ...task, draft: 'Unsent human draft' }))
  const before = s.store.task(created.id)
  const handoff = {
    id: created.id,
    requestId: randomUUID(),
    harness: defaultTaskHarness('claude'),
    stop: false,
  }
  const response = await f.request('/api/tasks/continue-harness', handoff)
  expect(await response.text()).toBe('{"ok":true}')
  expect(response.status).toBe(200)
  const after = s.store.task(created.id)
  expect(after.bot).toEqual(before.bot)
  expect(after.title).toBe(before.title)
  expect(after.draft).toBe(before.draft)
  expect(after.messages).toEqual(before.messages)
  expect(after.turns).toEqual(before.turns)
  expect(after.files).toEqual(before.files)
  expect(after.threadActions).toEqual(before.threadActions)
  expect(after.sessionId).toBeUndefined()
  expect((await f.request('/api/tasks/continue-harness', handoff)).status).toBe(200)
  await send('Continue with Claude')
  expect(f.inputs.at(-1)?.agent.provider).toBe('claude')
  expect(f.inputs.at(-1)?.sessionId).toBeUndefined()
  expect(f.inputs.at(-1)?.prompt).toContain('Keep the release plan')
  expect(f.inputs.at(-1)?.prompt).not.toContain('Excluded later context')
  const previous = s.store.task(created.id).harness!
  const next = { ...previous, model: 'another-model' }
  expect(
    (
      await f.request(
        '/api/workspace',
        {
          collection: 'tasks',
          id: created.id,
          changes: { harness: { before: previous, after: next } },
        },
        'PATCH',
      )
    ).status,
  ).toBe(200)
  await f.restart()
  await send('Continue with the new model')
  expect(f.inputs.at(-1)?.agent.model).toBe('another-model')
  expect(f.inputs.at(-1)?.sessionId).toBeUndefined()
  expect(f.inputs.at(-1)?.prompt).toContain('Keep the release plan')
  expect(f.inputs.at(-1)?.prompt).toContain('Continue with Claude')
  expect(f.inputs.at(-1)?.prompt).not.toContain('Excluded later context')
  expect(f.runtime.services.store.task(created.id).bot).toEqual(before.bot)
})
