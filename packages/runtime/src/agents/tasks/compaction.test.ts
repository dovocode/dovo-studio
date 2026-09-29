import { expect, it } from 'vitest'
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
