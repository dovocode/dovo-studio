import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  activitySchema,
  botResultSchema,
  conversationPageSchema,
  decode,
  threadChildren,
  taskParentReference,
} from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

const readActivity = async (f: Awaited<ReturnType<typeof setupBotRuntime>>, scope: string) =>
  decode(
    activitySchema,
    await (
      await f.request('/api/activity', { scope, kind: 'task-activity', includeDetails: true })
    ).json(),
  ).events

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
  const turnId = before.turns!.at(-1)!.id
  s.activity.add('reasoning', id, 'Old reasoning', { turnId }, 'old-reasoning')
  s.activity.add('tool', id, 'Old command', { turnId }, 'old-command')
  s.activity.add('task-activity', id, 'Old unassigned activity', {}, 'old-unassigned')
  s.activity.add('task', id, 'Bot settings audit', {}, 'bot-settings-audit')
  s.activity.add('tool', id, 'Existing artifact tile', {}, 'artifact:existing:1')
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
  expect((await readActivity(f, id)).map((event) => event.id)).toEqual(['artifact:existing:1'])
  expect((await readActivity(f, saved.id)).map((event) => event.id).sort()).toEqual([
    'old-command',
    'old-reasoning',
    'old-unassigned',
  ])
  expect(s.activity.list('', 'task', 0, id).events.map((event) => event.id)).toContain(
    'bot-settings-audit',
  )
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
  const freshPage = decode(
    conversationPageSchema,
    await (await f.request('/api/tasks/history', { id })).json(),
  )
  const savedPage = decode(
    conversationPageSchema,
    await (await f.request('/api/tasks/history', { id: saved.id })).json(),
  )
  expect(freshPage.messages).toEqual([])
  expect(freshPage.turns).toEqual([])
  expect(freshPage.historyRevision).toBeGreaterThan(before.historyRevision ?? 0)
  expect(savedPage.messages.map((message) => message.id)).toEqual(
    before.messages.map((message) => message.id),
  )
  expect(
    (await f.request('/api/tasks/history', { id, before: before.messages[0]!.id })).status,
  ).toBe(409)
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
  expect(await readActivity(f, id)).toEqual([])
  expect(await readActivity(f, saved.id)).toHaveLength(3)
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

it('recovers old archives and matches Lean’s activity ownership and cutoff cases', async () => {
  const f = await setupBotRuntime()
  const { id } = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  const cases = readFileSync(
    new URL('../../../../../verification/bot-workflows-cases.jsonl', import.meta.url),
    'utf8',
  )
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          kind: string
          activity: 'conversation' | 'audit' | 'artifact'
          time: number
          owner: 'bot' | 'archive'
          visible: boolean
        },
    )
    .filter((entry) => entry.kind === 'archive')
  expect(cases).toHaveLength(9)
  s.store.updateTaskHistory(id, (task) => ({
    ...task,
    messages: [{ id: 'old', role: 'user', text: 'Old conversation' }],
  }))
  expect(
    (
      await f.request('/api/bots/archive-conversation', {
        id,
        expectedRevision: s.store.task(id).bot!.revision,
        expectedLastMessageId: 'old',
      })
    ).status,
  ).toBe(200)
  const archive = s.store.get().tasks.find((task) => task.botConversation?.botId === id)!
  const cutoff = archive.archivedAt!
  s.store.updateTask(id, (task) => ({
    ...task,
    bot: { ...task.bot!, conversationArchivedAt: undefined },
  }))
  for (const { activity, time } of cases) {
    const eventId = `${activity}:${time}`
    const kind = activity === 'conversation' ? 'reasoning' : activity === 'audit' ? 'task' : 'tool'
    const stamp = new Date(Date.parse(cutoff) + time - 1).toISOString()
    s.activity.add(kind, id, 'Recorded activity', {}, eventId)
    s.db.prepare('UPDATE activity SET time=? WHERE id=?').run(stamp, eventId)
  }
  // All display rows are still owned by the Bot, as in a database from the older runtime.
  await f.restart()
  expect(f.runtime.services.store.task(id).bot?.conversationArchivedAt).toBe(cutoff)
  const remaining = await readActivity(f, id)
  const archived = await readActivity(f, archive.id)
  expect(archived.map((event) => event.id).sort()).toEqual(['conversation:0', 'conversation:1'])
  expect(remaining).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'conversation:2' })]),
  )
  for (const { activity, time, owner, visible } of cases) {
    // Artifact tiles are regenerated from the artifact store on restart. The migration
    // cannot move them. A newer conversation event also belongs to the still-live Bot.
    if (activity === 'artifact') continue
    const eventId = `${activity}:${time}`
    const row = f.runtime.services.db.prepare('SELECT scope FROM activity WHERE id=?').get(eventId)
    expect(row).toEqual({ scope: owner === 'archive' && !visible ? archive.id : id })
  }
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
