import type { Agent } from '@dovo/protocol'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** Only provider acknowledgements count; a request or text mentioning compaction does not. */
export function completedCompaction(
  provider: Agent['provider'],
  name: string,
  payload: unknown,
): 'manual' | 'auto' | undefined {
  const event = object(payload)
  if (name === 'dovo/compaction/completed') return 'manual'
  if (provider === 'codex' && name === 'item/completed')
    return object(event.item).type === 'contextCompaction' ? 'auto' : undefined
  if (provider === 'claude' && name === 'system' && event.subtype === 'compact_boundary')
    return object(event.compact_metadata).trigger === 'manual' ? 'manual' : 'auto'
  if (provider === 'opencode' && name === 'session.compacted') return 'auto'
  if (provider === 'opencode' && name === 'session.compaction.ended')
    return object(event.data).reason === 'manual' ? 'manual' : 'auto'
  return undefined
}
