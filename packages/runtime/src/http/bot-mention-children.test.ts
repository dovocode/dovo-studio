import { expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { resolveTaskAgent } from '@dovo/protocol'
import { setupBotRuntime } from '../testing/bots.js'
import { waitForRuntime } from '../testing/integration.js'
import { fixture } from '../testing/fixture.js'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

it('saves one independent child with source history and settings while only the source runs', async () => {
  const f = await setupBotRuntime()
  const { task: bot, response } = await f.create()
  expect(response.status).toBe(200)
  const s = f.runtime.services
  const source = { ...f.draft(), title: 'Source thread' }
  source.harness = {
    ...source.harness!,
    model: 'test-model',
    permission: 'read-only',
    instructions: 'Source instructions',
  }
  source.messages = [
    { id: 'old-user', role: 'user', text: 'Earlier request', createdAt: source.createdAt },
    { id: 'old-answer', role: 'assistant', text: 'Earlier answer', createdAt: source.createdAt },
  ]
  s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, source] }))
  const input = {
    id: source.id,
    messageId: randomUUID(),
    text: `Ask @Release helper (\`studio:local:thread:${bot.id}\`) to check.`,
    attachmentIds: [],
  }
  const replies = await Promise.all([
    f.request('/api/tasks/message', input),
    f.request('/api/tasks/message', input),
  ])
  expect(replies.map((reply) => reply.status)).toEqual([200, 200])
  await waitForRuntime(() => expect(s.store.taskSummary(source.id).status).toBe('review'))
  expect(f.inputs.filter((input) => input.taskId === source.id)).toHaveLength(1)
  const copies = s.store.get().tasks.filter((task) => task.botMention)
  expect(copies).toHaveLength(1)
  const child = s.store.task(copies[0]!.id)
  expect(child.botMention).toEqual({
    runtimeId: s.runtimeId,
    botId: bot.id,
    sourceTaskId: source.id,
    sourceMessageId: input.messageId,
  })
  expect(resolveTaskAgent(child, s.store.get().agents)).toMatchObject({
    model: 'test-model',
    permission: 'read-only',
    instructions: 'Source instructions',
  })
  expect(child.messages.map((message) => message.text)).toEqual([
    'Earlier request',
    'Earlier answer',
    input.text,
  ])
  expect(child.queue ?? []).toEqual([])
  expect(child.turns ?? []).toEqual([])
  expect(child.sessionId).toBeUndefined()
  expect(f.inputs.some((input) => input.taskId === child.id || input.taskId === bot.id)).toBe(false)
  // The child is a separate conversation. A follow-up uses a fresh provider session.
  expect(
    (
      await f.request('/api/tasks/message', {
        id: child.id,
        messageId: randomUUID(),
        text: 'Continue this copy',
        attachmentIds: [],
      })
    ).status,
  ).toBe(200)
  await waitForRuntime(() =>
    expect(f.inputs.filter((input) => input.taskId === child.id)).toHaveLength(1),
  )
  expect(f.inputs.find((input) => input.taskId === child.id)?.sessionId).toBeUndefined()
  const childPrompt = f.inputs.find((input) => input.taskId === child.id)?.prompt
  expect(childPrompt).toContain('Earlier request')
  expect(childPrompt).toContain('Earlier answer')
  expect(childPrompt).toContain('Continue this copy')
  await waitForRuntime(() => expect(s.store.taskSummary(child.id).status).toBe('review'))
  await f.restart()
  expect((await f.request('/api/tasks/message', input)).status).toBe(200)
  expect(f.runtime.services.store.get().tasks.filter((task) => task.botMention)).toHaveLength(1)
  expect(f.runtime.run).not.toHaveBeenCalled()
})

it('deduplicates targets, preserves scope, and never dispatches a remote Bot', async () => {
  const f = await setupBotRuntime()
  const source = f.draft()
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, source] }))
  const mention = '@Dory (`studio:other-runtime:thread:same-id`)'
  const input = {
    id: source.id,
    messageId: randomUUID(),
    text: `${mention} and ${mention}`,
    attachmentIds: [],
    queueOnly: true,
  }
  expect((await f.request('/api/tasks/message', input)).status).toBe(200)
  const copies = s.store.get().tasks.filter((task) => task.botMention)
  expect(copies).toHaveLength(1)
  expect(copies[0]?.botMention?.runtimeId).toBe('other-runtime')
  expect(f.runtime.run).not.toHaveBeenCalled()
  // A conflicting retry cannot replace history or create more copies.
  expect(
    (await f.request('/api/tasks/message', { ...input, text: input.text + 'changed' })).status,
  ).toBe(409)
  expect(s.store.get().tasks.filter((task) => task.botMention)).toHaveLength(1)
  expect(
    (
      await f.request(
        '/api/workspace',
        {
          collection: 'tasks',
          id: source.id,
          changes: { botMention: { before: null, after: copies[0]?.botMention } },
        },
        'PATCH',
      )
    ).status,
  ).toBe(400)
  s.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((task) => !task.botMention),
  }))
  expect((await f.request('/api/tasks/message', input)).status).toBe(200)
  expect(s.store.get().tasks.filter((task) => task.botMention)).toHaveLength(0)
})

it('does not copy excluded Bot history or turn historical mentions into new children', async () => {
  const f = await setupBotRuntime()
  const source = (await f.create()).task
  const target = (await f.create()).task
  const s = f.runtime.services
  s.store.updateTaskHistory(source.id, (task) => ({
    ...task,
    messages: [
      { id: 'keep', role: 'user', text: 'Keep this', createdAt: source.createdAt },
      { id: 'private', role: 'assistant', text: 'Excluded context', createdAt: source.createdAt },
    ],
    bot: {
      ...task.bot!,
      contextResets: [
        {
          requestRevision: randomUUID(),
          turnId: 'reset',
          afterMessageId: 'keep',
          throughMessageId: 'private',
          at: source.createdAt,
        },
      ],
    },
  }))
  const input = {
    id: source.id,
    messageId: randomUUID(),
    text: `@Helper (\`studio:local:thread:${target.id}\`)`,
    attachmentIds: [],
    queueOnly: true,
  }
  const sent = await f.request('/api/tasks/message', input)
  expect(sent.status).toBe(200)
  const child = s.store.task(s.store.get().tasks.find((task) => task.botMention)!.id)
  expect(child.messages.map((message) => message.text)).toEqual(['Keep this', input.text])
  expect(child.bot).toBeUndefined()
  expect(
    (
      await f.request('/api/tasks/message', {
        ...input,
        id: child.id,
        messageId: randomUUID(),
        text: 'New input without a mention',
      })
    ).status,
  ).toBe(200)
  expect(s.store.get().tasks.filter((task) => task.botMention)).toHaveLength(1)
})

it('copies attachments independently and starts Git follow-ups in a separate checkout', async () => {
  const f = await setupBotRuntime()
  const project = await fixture()
  const s = f.runtime.services
  try {
    const { task: bot } = await f.create()
    const source = { ...f.draft(), repositoryId: 'repo' }
    s.store.update((workspace) => ({
      ...workspace,
      repositories: [...workspace.repositories, ...project.workspace.repositories],
      tasks: [...workspace.tasks, source],
    }))
    const data = Buffer.from('Attached context')
    const original = s.attachments.receiveHandoff(
      source.id,
      { id: randomUUID(), name: 'context.txt', mime: 'text/plain', size: data.length },
      data,
    )
    const input = {
      id: source.id,
      messageId: randomUUID(),
      text: `Ask @Helper (\`studio:local:thread:${bot.id}\`)`,
      attachmentIds: [original.id],
      queueOnly: true,
    }
    expect((await f.request('/api/tasks/message', input)).status).toBe(200)
    const child = s.store.task(s.store.get().tasks.find((task) => task.botMention)!.id)
    const copied = child.messages.at(-1)?.attachments?.[0]
    expect(copied).toBeDefined()
    expect(copied?.id).not.toBe(original.id)
    expect(s.attachments.read(child.id, copied!.id).data).toBe(data.toString('base64'))
    expect(() => s.attachments.read(source.id, copied!.id)).toThrow('another task')
    expect(child.execution).toBe('worktree')
    expect(child.forkedFrom?.head).toMatch(/^[a-f0-9]{40,64}$/)
    const cwd = await s.checkouts.directory(child.id)
    expect(cwd).not.toBe(project.directory)
    await writeFile(join(cwd, 'hello.txt'), 'Independent copy\n')
    expect(await readFile(join(project.directory, 'hello.txt'), 'utf8')).toBe('original\n')
  } finally {
    await project.cleanup()
  }
})

it('rolls back admission when the child copy cannot be stored', async () => {
  const f = await setupBotRuntime()
  const { task: bot } = await f.create()
  const source = f.draft()
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, source] }))
  const data = Buffer.from('context')
  const original = s.attachments.receiveHandoff(
    source.id,
    { id: randomUUID(), name: 'context.txt', mime: 'text/plain', size: data.length },
    data,
  )
  const copy = vi.spyOn(s.attachments, 'copy').mockImplementation(() => {
    throw Error('Copy failed')
  })
  const input = {
    id: source.id,
    messageId: randomUUID(),
    text: `@Helper (\`studio:local:thread:${bot.id}\`)`,
    attachmentIds: [original.id],
    queueOnly: true,
  }
  expect((await f.request('/api/tasks/message', input)).status).toBe(500)
  expect(s.store.taskSummary(source.id).queue ?? []).toEqual([])
  expect(s.store.get().tasks.filter((task) => task.botMention)).toHaveLength(0)
  copy.mockRestore()
  expect((await f.request('/api/tasks/message', input)).status).toBe(200)
  expect(s.store.get().tasks.filter((task) => task.botMention)).toHaveLength(1)
})

it('saves steered mentions once while the source provider keeps running', async () => {
  const f = await setupBotRuntime()
  const { task: bot } = await f.create()
  const source = f.draft()
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, source] }))
  let finish = () => {}
  let ready = false
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const steered: string[] = []
  f.runtime.run.mockImplementation(async (run) => {
    run.onPromptAccepted?.()
    run.onSteer?.(async (input) => {
      steered.push(input.prompt)
    })
    ready = true
    await done
    run.onText('Completed source work')
  })
  try {
    expect(
      (
        await f.request('/api/tasks/message', {
          id: source.id,
          messageId: randomUUID(),
          text: 'Start source',
          attachmentIds: [],
        })
      ).status,
    ).toBe(200)
    await waitForRuntime(() => expect(ready).toBe(true))
    const input = {
      id: source.id,
      messageId: randomUUID(),
      text: `@Helper (\`studio:local:thread:${bot.id}\`)`,
      attachmentIds: [],
      runId: s.store.taskSummary(source.id).activeRunId,
    }
    expect((await f.request('/api/tasks/steer', { ...input, runId: 'old-run' })).status).toBe(409)
    expect(s.store.get().tasks.filter((task) => task.botMention)).toHaveLength(0)
    expect((await f.request('/api/tasks/steer', input)).status).toBe(200)
    expect((await f.request('/api/tasks/steer', input)).status).toBe(200)
    expect(steered).toEqual([input.text])
    const copies = s.store.get().tasks.filter((task) => task.botMention)
    expect(copies).toHaveLength(1)
    expect(s.store.task(copies[0]!.id).messages.at(-1)?.text).toBe(input.text)
    expect(f.runtime.run).toHaveBeenCalledTimes(1)
  } finally {
    finish()
  }
  await waitForRuntime(() => expect(s.store.taskSummary(source.id).status).toBe('review'))
})

it('keeps an unborn source branch untouched when saving a Git child', async () => {
  const f = await setupBotRuntime()
  const project = await fixture()
  const s = f.runtime.services
  try {
    await s.git.command(project.directory, ['checkout', '--orphan', 'empty-source'])
    await s.git.command(project.directory, ['rm', '-rf', '.'])
    const { task: bot } = await f.create()
    const source = { ...f.draft(), repositoryId: 'repo' }
    s.store.update((workspace) => ({
      ...workspace,
      repositories: [...workspace.repositories, ...project.workspace.repositories],
      tasks: [...workspace.tasks, source],
    }))
    expect(
      (
        await f.request('/api/tasks/message', {
          id: source.id,
          messageId: randomUUID(),
          text: `@Helper (\`studio:local:thread:${bot.id}\`)`,
          attachmentIds: [],
          queueOnly: true,
        })
      ).status,
    ).toBe(200)
    const child = s.store.get().tasks.find((task) => task.botMention)!
    expect(child.execution).toBe('worktree')
    expect(child.forkedFrom?.head).toMatch(/^[a-f0-9]{40,64}$/)
    await expect(
      s.git.command(project.directory, ['rev-parse', '--verify', 'HEAD']),
    ).rejects.toThrow('Needed a single revision')
  } finally {
    await project.cleanup()
  }
})
