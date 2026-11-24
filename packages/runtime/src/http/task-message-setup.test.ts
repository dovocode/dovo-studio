import { expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { RuntimeMutations, responses, type MutationOutbox } from '@dovo/protocol'
import { createHash, randomUUID } from 'node:crypto'
import { RuntimePreferences } from '../storage/runtime-preferences'
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

it('preserves first-message Scope and permits a corrected send when an attachment is missing', async () => {
  const f = await fixture()
  const token = 'message-setup-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    new RuntimePreferences(s.db).save({ enableAutoProjectSelection: true })
    s.store.update(() => ({
      ...f.workspace,
      repositories: [
        { id: 'scratch', kind: 'scratch', name: 'General', path: f.directory, branch: '' },
      ],
      tasks: [
        {
          id: 'scope',
          title: 'New task',
          repositoryId: 'scratch',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Inspect the files',
          autoProject: true,
          example: false,
        },
      ],
    }))
    let journal: MutationOutbox = []
    const mutations = new RuntimeMutations({
      id: randomUUID,
      read: async () => journal,
      update: async (_connection, change) => (journal = change(journal)),
      clear: async () => {
        journal = []
      },
    })
    const connection = { address: `http://127.0.0.1:${runtime.port}`, token }
    const send = (attachmentIds: string[], id = 'scope') =>
      Effect.runPromise(
        mutations.requestEffect(
          connection,
          '/api/tasks/message',
          {
            id,
            messageId: randomUUID(),
            text: 'Inspect the files',
            queueOnly: true,
            selectProject: true,
            attachmentIds,
          },
          responses.ok,
        ),
      )
    const selection = vi.spyOn(s.titles, 'selectProjectsEffect')
    const resetSpend = vi.spyOn(s.tasks, 'resetSpendLimit')
    await expect(send([randomUUID()], 'absent')).rejects.toThrow('Attachment not found')
    expect(journal).toEqual([])
    await expect(send([randomUUID()])).rejects.toThrow('Attachment not found')
    expect(s.store.task('scope').autoProject).toBe(true)
    expect(s.store.task('scope').queue ?? []).toEqual([])
    expect(selection).not.toHaveBeenCalled()
    expect(resetSpend).not.toHaveBeenCalled()
    expect(journal).toEqual([])
    await expect(send([])).resolves.toMatchObject({ ok: true })
    expect(s.store.task('scope').queue?.map((message) => message.text)).toEqual([
      'Inspect the files',
    ])
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})

it('admits a delayed message once and preserves the newer same-text composer', async () => {
  const token = 'message-setup-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    const text = 'Inspect the files'
    s.store.update((workspace) => ({
      ...workspace,
      tasks: ['guarded', 'matched', 'legacy'].map((id) => ({
        id,
        title: 'Draft',
        repositoryId: '',
        agentId: '',
        status: 'draft' as const,
        createdAt: '',
        messages: [],
        files: [],
        draft: text,
        example: false,
      })),
    }))
    const call = (method: string, path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const attach = async (name: string) => {
      const id = randomUUID()
      const response = await call('POST', '/api/attachments/upload', {
        taskId: 'guarded',
        id,
        name,
        data: Buffer.from('test file').toString('base64'),
      })
      expect(response.ok).toBe(true)
      return id
    }
    const patch = async (changes: Record<string, { before: unknown; after: unknown }>) => {
      const response = await call('PATCH', '/api/workspace', {
        collection: 'tasks',
        id: 'guarded',
        changes,
      })
      expect(response.ok).toBe(true)
    }
    const original = await attach('original.txt')
    const submitted = {
      id: 'guarded',
      messageId: randomUUID(),
      text,
      attachmentIds: [original],
      queueOnly: true,
      draftIdentity: createHash('sha256')
        .update(JSON.stringify([text, [original], 'null', false]))
        .digest('hex'),
    }
    await patch({ draft: { before: text, after: 'Another draft' } })
    const added = await attach('added.txt')
    const newerSettings = { provider: 'codex', model: 'gpt-6.2-sol', reasoning: 'low' }
    await patch({
      draft: { before: 'Another draft', after: text },
      draftTurnSettings: { before: null, after: newerSettings },
      draftPlan: { before: null, after: true },
    })
    for (let i = 0; i < 2; i++) {
      expect((await call('POST', '/api/tasks/message', submitted)).ok).toBe(true)
      const current = s.store.task('guarded')
      expect(current.draft).toBe(text)
      expect(current.draftAttachments?.map(({ id }) => id)).toEqual([original, added])
      expect(current.draftPlan).toBe(true)
      expect(current.draftTurnSettings).toEqual(newerSettings)
      expect(current.queue?.map(({ id }) => id)).toEqual([submitted.messageId])
    }
    const legacy = await call('POST', '/api/tasks/message', {
      id: 'legacy',
      text,
      messageId: randomUUID(),
      queueOnly: true,
    })
    expect(legacy.ok).toBe(true)
    expect(s.store.task('legacy').draft).toBe('')
    const matched = await call('POST', '/api/tasks/message', {
      id: 'matched',
      text,
      messageId: randomUUID(),
      queueOnly: true,
      draftIdentity: createHash('sha256')
        .update(JSON.stringify([text, [], 'null', false]))
        .digest('hex'),
    })
    expect(matched.ok).toBe(true)
    expect(s.store.task('matched').draft).toBe('')
  } finally {
    await runtime.close()
  }
})

it('keeps a matching accepted mutation replayable after an unreferenced attachment is pruned', async () => {
  const token = 'message-setup-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    const task = {
      id: 'draft',
      title: 'New task',
      repositoryId: '',
      agentId: '',
      status: 'draft' as const,
      createdAt: '',
      messages: [],
      files: [],
      draft: 'Inspect the file',
      example: false,
    }
    const call = (path: string, body: unknown, mutationId?: string) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
        },
        body: JSON.stringify(body),
      })
    const attachment = randomUUID()
    const message = {
      id: task.id,
      messageId: randomUUID(),
      text: task.draft,
      attachmentIds: [attachment],
      queueOnly: true,
    }
    const standardSend = (mutationId?: string) => call('/api/tasks/message', message, mutationId)
    const beforeCreate = await call('/api/tasks/message', { ...message, createTask: task })
    expect(beforeCreate.status).toBe(400)
    expect(s.store.get().tasks.some(({ id }) => id === task.id)).toBe(false)
    s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
    const upload = await call('/api/attachments/upload', {
      taskId: task.id,
      id: attachment,
      name: 'attachment.txt',
      data: Buffer.from('file contents').toString('base64'),
    })
    expect(upload.ok).toBe(true)

    const mutationId = randomUUID()
    expect((await standardSend(mutationId)).ok).toBe(true)
    const remove = await call('/api/tasks/queue', {
      id: task.id,
      action: 'remove',
      messageId: message.messageId,
    })
    expect(remove.ok).toBe(true)
    await s.attachments.prune()
    expect(() => s.attachments.metadata(task.id, [attachment])).toThrow('Attachment not found')
    const replay = await standardSend(mutationId)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ ok: true })
    expect(s.store.task(task.id).queue ?? []).toEqual([])

    const withoutMutationReceipt = await standardSend()
    expect(withoutMutationReceipt.status).toBe(404)
    expect(await withoutMutationReceipt.json()).toEqual({ error: 'Attachment not found' })
  } finally {
    await runtime.close()
  }
})
