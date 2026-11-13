import { expect, it } from 'vite-plus/test'
import { completedCompaction } from './compaction.js'

it('records only provider-confirmed compactions', () => {
  expect(
    completedCompaction('codex', 'item/started', { item: { type: 'contextCompaction' } }),
  ).toBeUndefined()
  expect(
    completedCompaction('codex', 'item/completed', { item: { type: 'contextCompaction' } }),
  ).toBe('auto')
  expect(
    completedCompaction('claude', 'system', {
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual' },
    }),
  ).toBe('manual')
  expect(completedCompaction('opencode', 'session.compacted', {})).toBe('auto')
  expect(
    completedCompaction('opencode', 'session.compaction.ended', { data: { reason: 'manual' } }),
  ).toBe('manual')
  expect(
    completedCompaction('acp', 'agent_message_chunk', { content: { text: 'Compacted' } }),
  ).toBeUndefined()
  expect(completedCompaction('acp', 'dovo/compaction/completed', {})).toBe('manual')
})

import { vi } from 'vite-plus/test'
import { compactBotSession } from './compaction.js'
import { defaultTaskHarness } from '@dovo/protocol'
import type { AgentRun } from '../execution/types.js'

const run: AgentRun = {
  agent: { ...defaultTaskHarness('codex'), id: 'compact-agent', name: 'Compaction test' },
  cwd: '/tmp',
  prompt: 'Keep working',
  sessionId: 'session',
  signal: new AbortController().signal,
  onSession: vi.fn<AgentRun['onSession']>(),
  onText: vi.fn<AgentRun['onText']>(),
  onActivity: vi.fn<AgentRun['onActivity']>(),
  approve: async () => 'deny',
  ask: async () => null,
}
it('compacts before a prompt without delivering that prompt or marking it accepted', async () => {
  const accepted = vi.fn<() => void>(),
    completed = vi.fn<() => void>(),
    attempt = vi.fn<() => void>()
  const adapter = {
    run: vi.fn<(input: AgentRun) => Promise<void>>(async (input: AgentRun) => {
      expect(input.prompt).toBe('/compact')
      expect(input.onPromptAccepted).toBeUndefined()
      expect(input.attachments).toBeUndefined()
      input.onEvent?.('item/completed', { item: { type: 'contextCompaction' } })
    }),
  }
  await compactBotSession(
    adapter,
    { ...run, onPromptAccepted: accepted },
    { used: 85, limit: 100, attempts: 0, nativeWork: false, completed, attempt },
  )
  expect(completed).toHaveBeenCalledOnce()
  expect(attempt).toHaveBeenCalledOnce()
  expect(accepted).not.toHaveBeenCalled()
})
it.each([
  { attempts: 2, nativeWork: false, used: 90 },
  { attempts: 0, nativeWork: true, used: 90 },
  { attempts: 0, nativeWork: false, used: 60 },
])('avoids ineffective loops, active children and unnecessary compaction: %j', async (values) => {
  const adapter = { run: vi.fn<(input: AgentRun) => Promise<void>>() }
  await compactBotSession(adapter, run, {
    ...values,
    limit: 100,
    completed: vi.fn<() => void>(),
    attempt: vi.fn<() => void>(),
  })
  expect(adapter.run).not.toHaveBeenCalled()
})
it('requires a native acknowledgement and preserves input when compaction fails', async () => {
  const completed = vi.fn<() => void>(),
    attempt = vi.fn<() => void>()
  await expect(
    compactBotSession({ run: async () => {} }, run, {
      used: 90,
      limit: 100,
      attempts: 0,
      nativeWork: false,
      completed,
      attempt,
    }),
  ).rejects.toThrow('did not confirm')
  expect(completed).not.toHaveBeenCalled()
  expect(attempt).toHaveBeenCalledOnce()
})
