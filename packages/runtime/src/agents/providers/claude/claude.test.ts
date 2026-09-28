import { expect, it, vi } from 'vitest'
import type { AgentRun } from '../../execution/types.js'

const mocks = vi.hoisted(() => ({ query: vi.fn<() => unknown>() }))
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
})
