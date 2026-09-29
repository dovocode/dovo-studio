import { expect, it, vi } from 'vitest'
import type { AgentRun } from '../../execution/types.js'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

const mocks = vi.hoisted(() => ({
  query: vi.fn<(input: { prompt: string | AsyncIterable<SDKUserMessage> }) => unknown>(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../../configuration/claude-command.js', () => ({
  claudeCommand: async () => '/bin/claude',
}))

import { claudeAdapter } from './claude.js'

it('runs the Claude compact command and reports its boundary', async () => {
  mocks.query.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'manual', pre_tokens: 1000 },
      }
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
    },
    close: vi.fn<() => void>(),
  }))
  const events: string[] = []
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Claude',
      provider: 'claude',
      endpoint: '',
      model: '',
      instructions: '',
      permission: 'ask',
    },
    cwd: '/tmp',
    prompt: '/compact',
    compact: true,
    sessionId: 'session',
    signal: new AbortController().signal,
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    onEvent: (name) => events.push(name),
    approve: async () => false,
    ask: async () => null,
  }
  await claudeAdapter.run(run)
  expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ prompt: '/compact' }))
  expect(events).toContain('system')
  mocks.query.mockClear()
  await claudeAdapter.run({ ...run, compact: undefined, sessionId: undefined, ephemeral: true })
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({ options: expect.objectContaining({ persistSession: false }) }),
  )
})
it('keeps a streaming Claude connection across turns', async () => {
  mocks.query.mockClear()
  const prompts: string[] = []
  const close = vi.fn<() => void>()
  mocks.query.mockImplementation(({ prompt }) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected streaming input')
      for await (const message of prompt) {
        const content = message.message.content
        prompts.push(
          typeof content === 'string'
            ? content
            : (content.find((block) => block.type === 'text')?.text ?? ''),
        )
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
      }
    },
    close,
  }))
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Claude',
      provider: 'claude',
      endpoint: '',
      model: '',
      instructions: '',
      permission: 'ask',
    },
    taskId: 'warm-claude-task',
    cwd: '/tmp',
    prompt: 'first',
    signal: new AbortController().signal,
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    approve: async () => false,
    ask: async () => null,
  }
  try {
    await claudeAdapter.run(run)
    await claudeAdapter.run({ ...run, sessionId: 'session', prompt: 'second' })
    expect(prompts).toEqual(['first', 'second'])
    expect(mocks.query).toHaveBeenCalledTimes(1)
  } finally {
    await claudeAdapter.dispose?.()
  }
  expect(close).toHaveBeenCalled()
})
