import { expect, it, vi } from 'vitest'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { journalProvider } from './journal-provider'
import type { AgentRun } from './types'

it('retires callbacks after every physical execution, including hook repair attempts', async () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
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
    let previous: AgentRun | undefined
    const provider = journalProvider(
      {
        run: async (current) => {
          if (previous) {
            previous.onText('Retired text')
            previous.onSession('Retired session')
            previous.onPromptAccepted?.()
            retiredReplies.push(await previous.approve('Retired approval', ''))
            retiredReplies.push(
              await previous.ask({ title: 'Retired', questions: [], blocking: true }),
            )
            current.onText('Repair text')
          }
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
    expect(retiredReplies).toEqual([false, null])
    expect(input.onText).toHaveBeenCalledExactlyOnceWith('Repair text')
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
