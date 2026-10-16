import { expect, it, vi } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { AgentRegistry } from '../configuration/registry'
import type { TaskCheckout } from '../../scm/tasks/task-checkout'
import { TitleGeneration } from './title-generation'
import { decode, taskSchema } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import type { AgentAdapter, AgentRun } from '../execution/types'
function setup(checkouts?: ConstructorParameters<typeof TitleGeneration>[3]) {
  const db = openDatabase(':memory:')
  const store = new WorkspaceStore(db)
  store.update((w) => ({
    ...w,
    agents: [
      {
        id: 'harness',
        name: 'Title harness',
        provider: 'codex',
        model: 'task-model',
        reasoning: 'high',
        instructions: 'Perform project work',
        permission: 'full-access',
        endpoint: 'fixture-codex',
      },
    ],
  }))
  const registry = new AgentRegistry()
  const titles = new TitleGeneration(db, store, registry, checkouts)
  return { db, store, registry, titles }
}
it('persists independent title settings and generates using a temporary read-only session', async () => {
  const s = setup()
  let captured: AgentRun | undefined
  vi.spyOn(s.registry, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      captured = run
      run.onText('Improve ')
      run.onText('task creation')
    },
  })
  try {
    s.titles.save({ agentId: 'harness', model: 'title-model', reasoning: 'low' })
    expect(new TitleGeneration(s.db, s.store, s.registry).read()).toEqual({
      agentId: 'harness',
      model: 'title-model',
      reasoning: 'low',
    })
    expect(await s.titles.generate({ text: 'Improve task creation\nKeep all context' })).toEqual({
      title: 'Improve task creation',
    })
    expect(captured?.agent).toMatchObject({
      endpoint: 'fixture-codex',
      model: 'title-model',
      reasoning: 'low',
      permission: 'read-only',
    })
    expect(captured?.agent.instructions).not.toContain('Perform project work')
    expect(captured?.prompt).toContain(JSON.stringify('Improve task creation\nKeep all context'))
    expect(captured?.sessionId).toBeUndefined()
    expect(captured?.ephemeral).toBe(true)
    expect(existsSync(captured?.cwd ?? '')).toBe(false)
    expect(await captured?.approve('Write', 'file')).toBe('deny')
    expect(s.store.get().agents[0].model).toBe('task-model')
    expect(s.store.get().tasks).toEqual([])
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})
it.each(['', 'A title\nUnexpected second line', 'x'.repeat(121)])(
  'rejects invalid model output %j',
  async (output) => {
    const s = setup()
    vi.spyOn(s.registry, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => run.onText(output),
    })
    try {
      await expect(s.titles.generate({ text: 'Create a task' })).rejects.toThrow(/title model/)
    } finally {
      await s.titles.dispose()
      await s.registry.dispose()
      s.db.close()
    }
  },
)
it('generates titles with a direct harness when no saved agents exist', async () => {
  const s = setup()
  s.store.update((w) => ({ ...w, agents: [] }))
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onText('Direct harness title')
  })
  vi.spyOn(s.registry, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    s.titles.save({
      harness: { provider: 'claude', endpoint: 'custom-claude' },
      model: 'selected-model',
      reasoning: 'low',
    })
    expect(await s.titles.generate({ text: 'Make a title' })).toEqual({
      title: 'Direct harness title',
    })
    expect(run.mock.calls[0][0].agent).toMatchObject({
      provider: 'claude',
      endpoint: 'custom-claude',
      model: 'selected-model',
      reasoning: 'low',
    })
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})
it('answers side questions in an ephemeral session without joining the task', async () => {
  const s = setup()
  const task = decode(taskSchema, {
    id: 'aside-task',
    title: 'Existing task',
    repositoryId: 'repo',
    agentId: 'harness',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  s.titles.save({ agentId: 'harness', model: '', reasoning: '' })
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('The answer.'))
  vi.spyOn(s.registry, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    expect(
      await runClientEffect(s.titles.askEffect({ id: task.id, question: 'What happened?' })),
    ).toEqual({
      answer: 'The answer.',
    })
    expect(run.mock.calls[0][0]).toMatchObject({ ephemeral: true, tools: 'none' })
    expect(run.mock.calls[0][0].sessionId).toBeUndefined()
    expect(s.store.task(task.id).messages).toEqual(task.messages)
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})

it('persists separate side chats, includes their history, and follows archive and delete lifecycle', async () => {
  const s = setup()
  const task = decode(taskSchema, {
    id: 'side-owner',
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'harness',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  s.titles.save({ agentId: 'harness', model: '', reasoning: '' })
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Saved answer'))
  vi.spyOn(s.registry, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    const first = s.titles.saveSideChat({ id: task.id })
    const second = s.titles.saveSideChat({ id: task.id, title: 'Other topic' })
    await runClientEffect(
      s.titles.askSideChatEffect({ id: task.id, chatId: first.id, question: 'First question' }),
    )
    await runClientEffect(
      s.titles.askSideChatEffect({ id: task.id, chatId: first.id, question: 'Follow-up' }),
    )
    expect(run.mock.calls[1][0].prompt).toContain('First question')
    expect(run.mock.calls[1][0].prompt).toContain('Saved answer')
    expect(run.mock.calls[0][0]).toMatchObject({ ephemeral: true, tools: 'none' })
    expect(
      s.store.task(task.id).sideChats?.find((chat) => chat.id === first.id)?.messages,
    ).toHaveLength(2)
    expect(
      s.store.task(task.id).sideChats?.find((chat) => chat.id === second.id)?.messages,
    ).toEqual([])
    expect(new WorkspaceStore(s.db).task(task.id).sideChats).toEqual(
      s.store.task(task.id).sideChats,
    )
    await runClientEffect(
      s.titles.askSideChatEffect({
        id: task.id,
        chatId: second.id,
        question: 'Custom title first question',
      }),
    )
    expect(s.store.task(task.id).sideChats?.find((chat) => chat.id === second.id)?.title).toBe(
      'Other topic',
    )
    s.store.updateTask(task.id, (current) => ({
      ...current,
      sideChats: current.sideChats?.map((chat) =>
        chat.id === first.id
          ? {
              ...chat,
              messages: [
                {
                  id: 'large',
                  question: 'Old question',
                  answer: 'x'.repeat(39000),
                  status: 'completed',
                  createdAt: new Date().toISOString(),
                },
                {
                  id: 'recent',
                  question: 'Recent question',
                  answer: 'y'.repeat(2000),
                  status: 'completed',
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : chat,
      ),
    }))
    await runClientEffect(
      s.titles.askSideChatEffect({ id: task.id, chatId: first.id, question: 'Bounded history' }),
    )
    const serializedPrompt = run.mock.calls.at(-1)![0].prompt
    const prompt = JSON.parse(serializedPrompt.slice(serializedPrompt.indexOf('{')))
    expect(JSON.parse(prompt.history)).toEqual([
      { question: 'Recent question', answer: 'y'.repeat(2000) },
    ])
    s.store.updateTask(task.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }))
    expect(() => s.titles.saveSideChat({ id: task.id })).toThrow('Restore this thread')
    await expect(
      runClientEffect(
        s.titles.askSideChatEffect({ id: task.id, chatId: first.id, question: 'Truly archived' }),
      ),
    ).rejects.toThrow('Restore this thread')
    s.store.updateTask(task.id, (current) => ({ ...current, archivedAt: undefined }))
    s.store.updateTask(task.id, (current) => ({ ...current, archived: true }))
    expect(() => s.titles.saveSideChat({ id: task.id })).toThrow('Restore this thread')
    await expect(
      runClientEffect(
        s.titles.askSideChatEffect({ id: task.id, chatId: first.id, question: 'Archived' }),
      ),
    ).rejects.toThrow('Restore this thread')
    s.store.updateTask(task.id, (current) => ({ ...current, archived: false }))
    s.store.updateTaskHistory(task.id, (current) => ({
      ...current,
      sideChats: current.sideChats?.map((chat) =>
        chat.id === first.id
          ? {
              ...chat,
              messages: chat.messages.map((message, index) =>
                index === 0 ? { ...message, status: 'pending', answer: undefined } : message,
              ),
            }
          : chat,
      ),
    }))
    expect(() =>
      s.titles.saveSideChat({ id: task.id, chatId: first.id, draft: 'Already sent' }),
    ).toThrow('Wait for this side chat')
    const restarted = new TitleGeneration(s.db, s.store, s.registry)
    expect(
      s.store.task(task.id).sideChats?.find((chat) => chat.id === first.id)?.messages[0],
    ).toMatchObject({ status: 'failed', error: expect.stringContaining('Server restarted') })
    await restarted.dispose()
    s.titles.saveSideChat({ id: task.id, chatId: first.id, remove: true })
    expect(s.store.task(task.id).sideChats?.map((chat) => chat.id)).toEqual([second.id])
    expect(s.store.task(task.id).messages).toEqual([])
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})

it('cancels a deleted parent’s side request without recreating its saved data', async () => {
  const s = setup()
  const task = decode(taskSchema, {
    id: 'deleted-parent',
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'harness',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  s.titles.save({ agentId: 'harness', model: '', reasoning: '' })
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    await new Promise<void>((_, reject) => {
      if (input.signal.aborted) reject(new Error('Cancelled'))
      else
        input.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
    })
  })
  vi.spyOn(s.registry, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    const chat = s.titles.saveSideChat({ id: task.id })
    const result = runClientEffect(
      s.titles.askSideChatEffect({ id: task.id, chatId: chat.id, question: 'Question' }),
    ).catch((error: unknown) => error)
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    s.titles.cancelSideChats(task.id)
    s.store.update((workspace) => ({ ...workspace, tasks: [] }))
    expect(await result).toBeInstanceOf(Error)
    expect(s.store.get().tasks).toEqual([])
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})

it('organizes reviews with a request-local model without changing utility or coding settings', async () => {
  const s = setup()
  let captured: AgentRun | undefined
  vi.spyOn(s.registry, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      captured = run
      run.onText('{"groups":[]}')
    },
  })
  const before = s.titles.read()
  expect(
    await s.titles.organizeReview('{"changes":[]}', {
      agentId: 'harness',
      model: 'organizer-model',
      reasoning: 'low',
    }),
  ).toBe('{"groups":[]}')
  expect(captured?.agent).toMatchObject({
    model: 'organizer-model',
    reasoning: 'low',
    permission: 'read-only',
  })
  expect(captured?.tools).toBe('none')
  expect(captured?.ephemeral).toBe(true)
  expect(captured?.agent.instructions).toContain('Include each supplied changed path exactly once')
  expect(existsSync(captured?.cwd ?? '')).toBe(false)
  expect(s.titles.read()).toEqual(before)
  expect(s.store.get().agents[0].model).toBe('task-model')
  await s.titles.dispose()
  s.db.close()
})

it('side chats read the existing task checkout without sharing the coding session or deleting files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-side-checkout-'))
  await writeFile(join(directory, 'answer.txt'), 'Worktree-specific content')
  const fileDirectory = vi.fn<TaskCheckout['fileDirectory']>(async () => directory)
  const s = setup({ fileDirectory })
  const task = decode(taskSchema, {
    id: 'checkout-owner',
    title: 'Worktree context',
    repositoryId: 'repo',
    agentId: 'harness',
    status: 'running',
    sessionId: 'main-session',
    execution: 'worktree',
    createdAt: new Date().toISOString(),
    messages: [{ id: 'context', role: 'user', text: 'Explain our new feature' }],
    files: [],
    draft: '',
    example: false,
  })
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  s.titles.save({ agentId: 'harness', model: '', reasoning: '' })
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    expect(input.cwd).toBe(directory)
    expect(input.tools).toBeUndefined()
    expect(input.agent.permission).toBe('read-only')
    expect(input.agent.instructions).toContain('Never modify files')
    expect(input.agent.instructions).not.toContain('Do not use tools')
    expect(input.ephemeral).toBe(true)
    expect(input.sessionId).toBeUndefined()
    expect(input.taskId).toBeUndefined()
    expect(input.prompt).toContain('Explain our new feature')
    expect(await input.approve('Write', 'answer.txt')).toBe('deny')
    input.onActivity('tool')
    expect(input.signal.aborted).toBe(false)
    input.onText(await readFile(join(input.cwd, 'answer.txt'), 'utf8'))
  })
  vi.spyOn(s.registry, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    const chat = s.titles.saveSideChat({ id: task.id })
    expect(
      await runClientEffect(
        s.titles.askSideChatEffect({
          id: task.id,
          chatId: chat.id,
          question: 'What is in the checkout?',
        }),
      ),
    ).toEqual({ answer: 'Worktree-specific content' })
    expect(
      await runClientEffect(
        s.titles.askEffect({
          id: task.id,
          question: 'What is in the checkout?',
        }),
      ),
    ).toEqual({ answer: 'Worktree-specific content' })
    expect(fileDirectory.mock.calls).toEqual([[task.id], [task.id]])
    expect(await readFile(join(directory, 'answer.txt'), 'utf8')).toBe('Worktree-specific content')
    expect(s.store.task(task.id).sessionId).toBe('main-session')
    expect(s.store.task(task.id).status).toBe('running')
  } finally {
    await s.titles.dispose()
    s.db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
it('fails a side-chat answer when its checkout is unavailable instead of using another directory', async () => {
  const s = setup({
    fileDirectory: async () => {
      throw new Error('Checkout unavailable')
    },
  })
  const task = decode(taskSchema, {
    id: 'missing-checkout',
    title: 'Missing checkout',
    repositoryId: 'repo',
    agentId: 'harness',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  s.titles.save({ agentId: 'harness', model: '', reasoning: '' })
  const adapter = vi.spyOn(s.registry, 'get')
  try {
    const chat = s.titles.saveSideChat({ id: task.id, draft: 'Question' })
    await expect(
      runClientEffect(
        s.titles.askSideChatEffect({
          id: task.id,
          chatId: chat.id,
          question: 'Question',
        }),
      ),
    ).rejects.toThrow('Checkout unavailable')
    expect(adapter).not.toHaveBeenCalled()
    expect(s.store.task(task.id).sideChats?.[0].messages[0]).toMatchObject({
      question: 'Question',
      status: 'failed',
    })
  } finally {
    await s.titles.dispose()
    s.db.close()
  }
})
