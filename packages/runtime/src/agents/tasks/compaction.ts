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
  if (provider === 'cursor' && name === 'cursor/summary-completed') return 'auto'
  if (provider === 'opencode' && name === 'session.compacted') return 'auto'
  if (provider === 'opencode' && name === 'session.compaction.ended')
    return object(event.data).reason === 'manual' ? 'manual' : 'auto'
  return undefined
}

/** Compact a Bot session before admitting a new prompt. Two attempts per still-full session
 * prevent compaction loops. A smaller measured context or an explicit compact resets the guard. */
export async function compactBotSession(
  adapter: Pick<import('../execution/types.js').AgentAdapter, 'run'>,
  run: import('../execution/types.js').AgentRun,
  input: {
    used?: number
    limit?: number
    attempts: number
    nativeWork: boolean
    attempt: () => void
    completed: () => void
  },
) {
  if (
    !run.sessionId ||
    run.compact ||
    run.goal ||
    input.nativeWork ||
    input.attempts >= 2 ||
    !['codex', 'claude', 'opencode'].includes(run.agent.provider) ||
    !input.limit ||
    input.used === undefined ||
    input.used < input.limit * 0.8
  )
    return
  run.signal.throwIfAborted()
  input.attempt()
  let confirmed = false
  await adapter.run({
    ...run,
    signal: AbortSignal.any([run.signal, AbortSignal.timeout(120_000)]),
    prompt: '/compact',
    compact: true,
    goal: undefined,
    attachments: undefined,
    onPromptAccepted: undefined,
    onSteer: undefined,
    onQuestions: undefined,
    onNativeSession: undefined,
    onSubagentEvent: undefined,
    onNativeTurnEnd: undefined,
    nativeAgentInteractions: undefined,
    onSession: (id) => {
      if (id !== run.sessionId)
        throw new Error('Compaction changed the provider session. Retry the turn.')
    },
    onText: () => {},
    onTextReplace: undefined,
    onTextBoundary: undefined,
    onActivity: () => {},
    onEvent: (name, payload) => {
      if (completedCompaction(run.agent.provider, name, payload)) confirmed = true
    },
    approve: async () => 'deny',
    ask: async () => null,
  })
  run.signal.throwIfAborted()
  if (!confirmed)
    throw new Error('The provider did not confirm context compaction. Retry or compact manually.')
  input.completed()
}
