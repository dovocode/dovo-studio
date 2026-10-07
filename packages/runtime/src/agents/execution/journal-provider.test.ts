import { expect, it, vi } from 'vite-plus/test'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { journalProvider } from './journal-provider'
import type { AgentRun } from './types'

it('retires callbacks after every physical execution, including hook repair attempts', async () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'thread',
          title: 'Test',
          agentId: 'agent',
          repositoryId: '',
          status: 'running',
          createdAt: '',
          draft: '',
          messages: [],
          files: [],
          example: false,
        },
      ],
    }))
    const input: AgentRun = {
      agent: {
        id: 'agent',
        name: 'Test',
        provider: 'codex',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
      },
      cwd: '/tmp',
      prompt: 'Request',
      signal: new AbortController().signal,
      onText: vi.fn<AgentRun['onText']>(),
      onTextReplace: vi.fn<NonNullable<AgentRun['onTextReplace']>>(),
      onActivity: vi.fn<AgentRun['onActivity']>(),
      onSession: vi.fn<AgentRun['onSession']>(),
      onPromptAccepted: vi.fn<NonNullable<AgentRun['onPromptAccepted']>>(),
      ask: vi.fn<AgentRun['ask']>().mockResolvedValue(null),
      approve: vi.fn<AgentRun['approve']>().mockResolvedValue(false),
    }
    store.providerActions.record({
      id: 'start:attempt',
      taskId: 'thread',
      attemptId: 'attempt',
      kind: 'start',
      state: 'pending',
    })
    const retiredReplies: unknown[] = []
    let unownedTextError: unknown
    let previous: AgentRun | undefined
    const provider = journalProvider(
      {
        run: async (current) => {
          if (previous) {
            previous.onText('Retired text')
            previous.onTextReplace?.('Retired replacement', 0)
            previous.onSession('Retired session')
            previous.onPromptAccepted?.()
            retiredReplies.push(await previous.approve('Retired approval', ''))
            retiredReplies.push(
              await previous.ask({ title: 'Retired', questions: [], blocking: true }),
            )
            try {
              current.onTextReplace?.('Erase previous execution', 1)
            } catch (error) {
              unownedTextError = error
            }
            current.onText('Repair text')
            current.onTextReplace?.('Repaired', 'Repair text'.length)
          } else current.onText('Original text')
          previous = current
        },
      },
      store,
      'thread',
      'attempt',
      () => true,
    )
    await provider.run(input)
    await provider.run(input)
    previous?.onText('Late repair text')
    previous?.onTextReplace?.('Late replacement', 0)
    expect(retiredReplies).toEqual([false, null])
    expect(unownedTextError).toEqual(
      new Error('Provider text replacement exceeds its streamed output'),
    )
    expect(vi.mocked(input.onText).mock.calls).toEqual([['Original text'], ['Repair text']])
    expect(input.onTextReplace).toHaveBeenCalledExactlyOnceWith('Repaired', 'Repair text'.length)
    expect(input.onSession).not.toHaveBeenCalled()
    expect(input.onPromptAccepted).not.toHaveBeenCalled()
    expect(input.ask).not.toHaveBeenCalled()
    expect(input.approve).not.toHaveBeenCalled()
    expect(store.providerActions.list('thread').map((action) => action.state)).toEqual([
      'completed',
      'completed',
    ])
  } finally {
    db.close()
  }
})
