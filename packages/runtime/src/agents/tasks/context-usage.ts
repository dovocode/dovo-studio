import type { Agent } from '@dovo/protocol'

export type ContextUsage = { used?: number; limit?: number }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
const sum = (...values: unknown[]) => {
  const numbers = values.map(count).filter((value) => value !== undefined)
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : undefined
}

/** How full the agent's context window is, read from a provider event. Returns undefined for
 * events that say nothing about it. `mainThread` filters out Codex subagent threads. */
export function contextUsage(
  provider: Agent['provider'],
  name: string,
  payload: unknown,
  mainThread?: string,
): ContextUsage | undefined {
  const event = record(payload)
  if (provider === 'codex' && name === 'thread/tokenUsage/updated') {
    const thread = typeof event.threadId === 'string' ? event.threadId : undefined
    if (thread && mainThread && thread !== mainThread) return undefined
    const usage = record(event.tokenUsage)
    // The last request's tokens are what currently sits in the window; the total is cumulative.
    const last = record(usage.last)
    const used = count(last.totalTokens) ?? sum(last.inputTokens, last.outputTokens)
    const limit = count(usage.modelContextWindow)
    return used === undefined && limit === undefined ? undefined : { used, limit }
  }
  if (provider === 'claude') {
    if (event.type === 'assistant' && event.parent_tool_use_id == null) {
      const usage = record(record(event.message).usage)
      const used = sum(
        usage.input_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
      )
      return used === undefined ? undefined : { used }
    }
    if (event.type === 'result') {
      // The main model is the one that read the most input.
      const models = Object.values(record(event.modelUsage)).map(record)
      const main = models.sort(
        (a, b) => (count(b.inputTokens) ?? 0) - (count(a.inputTokens) ?? 0),
      )[0]
      const limit = count(main?.contextWindow)
      return limit === undefined ? undefined : { limit }
    }
    return undefined
  }
  if (provider === 'acp' && name === 'usage_update') {
    const update = record(event.update)
    const used = count(update.used)
    const limit = count(update.size)
    return used === undefined && limit === undefined ? undefined : { used, limit }
  }
  if (provider === 'opencode' && name === 'message.updated') {
    const info = record(record(event.properties).info)
    if (info.role !== 'assistant') return undefined
    const tokens = record(info.tokens)
    const cache = record(tokens.cache)
    const used = sum(tokens.input, cache.read, cache.write)
    return used ? { used } : undefined
  }
  if (provider === 'opencode' && name === 'session.usage.updated') {
    const tokens = record(record(event.data).tokens)
    const cache = record(tokens.cache)
    const used = sum(tokens.input, cache.read, cache.write)
    return used === undefined ? undefined : { used }
  }
  return undefined
}

/** Counts the tokens one turn used, from the same provider events. Feed every event; read
 * `total()` when the turn ends (undefined when the provider reported nothing). */
export function turnTokenCounter(
  provider: Agent['provider'],
  mainThread: () => string | undefined,
) {
  let codexStart: number | undefined
  let codexLatest: number | undefined
  let claude: number | undefined
  const opencode = new Map<string, number>()
  let opencodeV2: number | undefined
  return {
    accept(name: string, payload: unknown) {
      const event = record(payload)
      if (provider === 'codex' && name === 'thread/tokenUsage/updated') {
        const thread = typeof event.threadId === 'string' ? event.threadId : undefined
        const main = mainThread()
        if (thread && main && thread !== main) return
        const usage = record(event.tokenUsage)
        const total = count(record(usage.total).totalTokens)
        if (total === undefined) return
        // The thread total is cumulative; before this turn it was total minus this request.
        codexStart ??= Math.max(0, total - (count(record(usage.last).totalTokens) ?? 0))
        codexLatest = total
      }
      if (provider === 'claude' && event.type === 'result') {
        const usage = record(event.usage)
        claude = sum(
          usage.input_tokens,
          usage.output_tokens,
          usage.cache_read_input_tokens,
          usage.cache_creation_input_tokens,
        )
      }
      if (provider === 'opencode' && name === 'message.updated') {
        const info = record(record(event.properties).info)
        if (info.role !== 'assistant' || typeof info.id !== 'string') return
        const tokens = record(info.tokens)
        const cache = record(tokens.cache)
        const used = sum(tokens.input, tokens.output, tokens.reasoning, cache.read, cache.write)
        if (used !== undefined) opencode.set(info.id, used)
      }
      if (provider === 'opencode' && name === 'session.usage.updated') {
        const tokens = record(record(event.data).tokens)
        const cache = record(tokens.cache)
        opencodeV2 = sum(tokens.input, tokens.output, tokens.reasoning, cache.read, cache.write)
      }
    },
    total() {
      if (provider === 'codex')
        return codexLatest !== undefined && codexStart !== undefined
          ? codexLatest - codexStart
          : undefined
      if (provider === 'claude') return claude
      if (provider === 'opencode' && opencode.size)
        return [...opencode.values()].reduce((total, value) => total + value, 0)
      if (provider === 'opencode') return opencodeV2
      return undefined
    },
  }
}
