import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botResultSchema, decode, threadChildren, taskParentReference } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

it('atomically archives the complete conversation under the same Bot and starts a fresh provider session', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const id = created.id
  const send = async (text: string) => {
    expect(
      (await f.request('/api/tasks/message', { id, messageId: randomUUID(), text })).status,
    ).toBe(200)
    await waitForRuntime(() =>
      expect(f.runtime.services.store.taskSummary(id).status).toBe('review'),
    )
  }
  await send('Old conversation secret phrase')
  const s = f.runtime.services
  expect(
    (
      await f.request('/api/memory/write', {
        scope: 'bot',
        botId: id,
        key: 'preference',
        content: 'Use Dutch',
      })
    ).status,
  ).toBe(200)
  const { attachment } = await s.attachments.upload({
    taskId: id,
    id: randomUUID(),
    name: 'note.txt',
    data: Buffer.from('Keep this attachment').toString('base64'),
  })
  s.store.updateTaskHistory(id, (task) => ({
    ...task,
    messages: task.messages.map((message, index) =>
      index === 0 ? { ...message, attachments: [attachment] } : message,
    ),
    draft: 'Unsent draft stays',
    draftAttachments: [attachment],
    nativeTodos: [{ id: 'old', text: 'Old checklist', status: 'completed' }],
  }))
  const before = s.store.task(id)
  const routine = {
    id: 'saved-routine',
    name: 'Saved routine',
    enabled: false,
    nodes: [],
    edges: [],
  }
  s.store.update((workspace) => ({ ...workspace, automations: [routine] }))
  const memory = s.memory.availableScopes(id)
  const input = {
    id,
    expectedRevision: before.bot!.revision,
    expectedLastMessageId: before.messages.at(-1)!.id,
  }
  const response = await f.request('/api/bots/archive-conversation', input)
  expect(await response.text()).toContain('"runtimeInstanceId"')
  expect(response.status).toBe(200)
  const fresh = s.store.task(id)
  const archive = s.store.get().tasks.find((task) => task.botConversation?.botId === id)!
  const saved = s.store.task(archive.id)
  expect(saved.archivedAt).toBeTruthy()
  expect(saved.createdAt).toBe(saved.archivedAt)
  expect(saved.bot).toBeUndefined()
  expect(saved.botConversation?.requestRevision).toBe(input.expectedRevision)
  expect(saved.messages.map((message) => message.text)).toEqual(
    before.messages.map((message) => message.text),
  )
  expect(saved.turns).toEqual(before.turns)
  expect(saved.files).toEqual(before.files)
  expect(saved.nativeTodos).toEqual(before.nativeTodos)
  const copied = saved.messages[0]!.attachments![0]!
  expect(copied.id).not.toBe(attachment.id)
  expect(s.attachments.read(saved.id, copied.id).data).toBe(
    Buffer.from('Keep this attachment').toString('base64'),
  )
  expect(fresh.messages).toEqual([])
  expect(fresh.turns).toEqual([])
  expect(fresh.nativeTodos).toBeUndefined()
  expect(fresh.sessionId).toBeUndefined()
  expect(fresh.draft).toBe(before.draft)
  expect(fresh.draftAttachments).toEqual(before.draftAttachments)
  expect(s.store.get().automations).toEqual([routine])
  expect(fresh.harness).toEqual(before.harness)
  expect(fresh.linkedCheckouts).toEqual(before.linkedCheckouts)
  expect(fresh.bot).toMatchObject({
    role: before.bot!.role,
    responsibilities: before.bot!.responsibilities,
    state: before.bot!.state,
  })
  expect(fresh.bot?.revision).not.toBe(before.bot!.revision)
  expect(s.memory.availableScopes(id)).toEqual(memory)
  expect(s.memory.availableScopes(saved.id)).toEqual([])
  expect(taskParentReference(saved, null, s.store.get().tasks)?.threadId).toBe(id)
  expect(
    threadChildren([{ runtimeId: null, tasks: s.store.get().tasks }], { runtimeId: null, id }).map(
      (row) => row.task.id,
    ),
  ).toContain(saved.id)
  await f.restart()
  await send('Fresh conversation request')
  expect(f.inputs.at(-1)?.sessionId).toBeUndefined()
  expect(f.inputs.at(-1)?.prompt).toContain('Fresh conversation request')
  expect(f.inputs.at(-1)?.prompt).not.toContain('Old conversation secret phrase')
  expect((await f.request('/api/bots/archive-conversation', input)).status).toBe(200)
  expect(
    f.runtime.services.store
      .task(id)
      .messages.some((message) => message.text === 'Fresh conversation request'),
  ).toBe(true)
  expect(
    f.runtime.services.store.get().tasks.filter((task) => task.botConversation?.botId === id),
  ).toHaveLength(1)
  const notes = await (await f.request('/api/memory/list', { scope: 'bot', botId: id })).json()
  expect(JSON.stringify(notes)).toContain('Use Dutch')
  expect(
    (await f.request('/api/tasks/lifecycle', { id, action: 'delete', removeWorktrees: false }))
      .status,
  ).toBe(200)
  expect(f.runtime.services.store.get().tasks.some((task) => task.id === saved.id)).toBe(false)
})

it('rejects stale, empty and busy conversations without losing history', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  const input = {
    id: created.id,
    expectedRevision: created.bot.revision,
    expectedLastMessageId: 'old',
  }
  expect((await f.request('/api/bots/archive-conversation', input)).status).toBe(409)
  s.store.updateTaskHistory(created.id, (task) => ({
    ...task,
    messages: [{ id: 'old', role: 'user', text: 'Keep me' }],
    status: 'running',
  }))
  expect((await f.request('/api/bots/archive-conversation', input)).status).toBe(409)
  s.store.updateTask(created.id, (task) => ({
    ...task,
    status: 'review',
    queue: [
      {
        id: 'queued',
        role: 'user',
        createdAt: new Date().toISOString(),
        text: 'Next',
        attachments: [],
      },
    ],
  }))
  expect((await f.request('/api/bots/archive-conversation', input)).status).toBe(409)
  s.store.updateTask(created.id, (task) => ({ ...task, queue: [] }))
  expect(
    (
      await f.request('/api/bots/archive-conversation', {
        ...input,
        expectedRevision: randomUUID(),
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await f.request('/api/bots/archive-conversation', {
        ...input,
        expectedLastMessageId: 'newer-message',
      })
    ).status,
  ).toBe(409)
  expect(s.store.task(created.id).messages).toEqual([{ id: 'old', role: 'user', text: 'Keep me' }])
  expect(s.store.get().tasks.filter((task) => task.botConversation)).toEqual([])
})

it('rolls back the archive when a conversation attachment cannot be copied', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  s.store.updateTaskHistory(created.id, (task) => ({
    ...task,
    messages: [
      {
        id: 'broken',
        role: 'user',
        text: 'Keep me',
        attachments: [{ id: randomUUID(), name: 'missing.txt', mime: 'text/plain', size: 3 }],
      },
    ],
  }))
  const before = s.store.task(created.id)
  const response = await f.request('/api/bots/archive-conversation', {
    id: created.id,
    expectedRevision: created.bot.revision,
    expectedLastMessageId: 'broken',
  })
  expect(response.status).not.toBe(200)
  expect(s.store.task(created.id)).toEqual(before)
  expect(s.store.get().tasks.filter((task) => task.botConversation)).toEqual([])
})
