import { expect, it, vi } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { AgentRegistry } from '../configuration/registry'
import { TitleGeneration } from './title-generation'
import { decode, taskSchema } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import type { AgentAdapter, AgentRun } from '../execution/types'
function setup() {
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
  const titles = new TitleGeneration(db, store, registry)
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
    expect(await captured?.approve('Write', 'file')).toBe(false)
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
    s.store.updateTask(task.id, (current) => ({ ...current, archived: true }))
    expect(() => s.titles.saveSideChat({ id: task.id })).toThrow('Restore this thread')
    await expect(
      runClientEffect(
        s.titles.askSideChatEffect({ id: task.id, chatId: first.id, question: 'Archived' }),
      ),
    ).rejects.toThrow('Restore this thread')
    s.store.updateTask(task.id, (current) => ({ ...current, archived: false }))
    s.store.updateTask(task.id, (current) => ({
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
