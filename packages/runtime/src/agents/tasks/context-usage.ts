import type { Agent } from '@dovo/protocol'

export type ContextUsage = { used?: number; limit?: number }
export type TurnTokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
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
  if ((provider === 'acp' || provider === 'grok') && name === 'usage_update') {
    const update = record(event.update)
    const used = count(update.used)
    const limit = count(update.size)
    return used === undefined && limit === undefined ? undefined : { used, limit }
  }
  if (provider === 'hermes' && ['session.usage', 'message.complete'].includes(name)) {
    const usage = record(event.usage),
      used = count(usage.context_used),
      limit = count(usage.context_max)
    return used === undefined && limit === undefined ? undefined : { used, limit }
  }
  if (provider === 'copilot' && name === 'session.usage_info') {
    const used = count(event.currentTokens),
      limit = count(event.tokenLimit)
    return used === undefined && limit === undefined ? undefined : { used, limit }
  }
  if (provider === 'muse' && name === 'session/contextUsage') {
    const used = count(event.usedTokens),
      limit = count(event.windowTokens)
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
  let codexStartUsage: TurnTokenUsage | undefined
  let codexLatestUsage: TurnTokenUsage | undefined
  let claudeUsage: TurnTokenUsage | undefined
  let claudeModel: string | undefined
  let reportedModel: string | undefined
  const cursorUsage = new Map<string, TurnTokenUsage>()
  const cursorTotal = () =>
    cursorUsage.size
      ? [...cursorUsage.values()].reduce(
          (total, value) => ({
            input: total.input + value.input,
            output: total.output + value.output,
            cacheRead: total.cacheRead + value.cacheRead,
            cacheWrite: total.cacheWrite + value.cacheWrite,
          }),
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        )
      : undefined
  const opencodeUsage = new Map<string, TurnTokenUsage>()
  const opencodeCost = new Map<string, number>()
  let opencodeV2Usage: TurnTokenUsage | undefined
  let opencodeV2Start: TurnTokenUsage | undefined
  let opencodeV2StartCost = 0
  let opencodeV2Cost: number | undefined
  const claudeMessages = new Map<string, { model: string; usage: TurnTokenUsage; child: boolean }>()
  let claudeMixedModels = false
  const opencode = new Map<string, number>()
  let opencodeV2: number | undefined
  let opencodeV2Unavailable = false
  return {
    accept(name: string, payload: unknown) {
      const event = record(payload)
      if (provider === 'cursor' && name === 'cursor/usage' && typeof event.usageId === 'string') {
        const usage = record(event.usage)
        const input = count(usage.inputTokens),
          output = count(usage.outputTokens)
        if (input !== undefined && output !== undefined)
          cursorUsage.set(event.usageId, {
            input,
            output,
            cacheRead: count(usage.cacheReadTokens) ?? 0,
            cacheWrite: count(usage.cacheWriteTokens) ?? 0,
          })
      }
      if (provider === 'opencode' && name === 'dovo/usage/unavailable') opencodeV2Unavailable = true
      if (provider === 'codex' && name === 'model/rerouted' && typeof event.toModel === 'string')
        reportedModel = event.toModel
      if (provider === 'claude' && event.type === 'assistant') {
        const message = record(event.message),
          usage = record(message.usage)
        if (
          typeof message.id === 'string' &&
          typeof message.model === 'string' &&
          count(usage.input_tokens) !== undefined
        )
          claudeMessages.set(message.id, {
            model: message.model,
            child: event.parent_tool_use_id != null,
            usage: {
              input: count(usage.input_tokens) ?? 0,
              output: count(usage.output_tokens) ?? 0,
              cacheRead: count(usage.cache_read_input_tokens) ?? 0,
              cacheWrite: count(usage.cache_creation_input_tokens) ?? 0,
            },
          })
      }
      if (provider === 'opencode' && name === 'dovo/usage/baseline') {
        const parts = record(event.tokens),
          cache = record(parts.cache)
        opencodeV2Start = {
          input: count(parts.input) ?? 0,
          output: (count(parts.output) ?? 0) + (count(parts.reasoning) ?? 0),
          cacheRead: count(cache.read) ?? 0,
          cacheWrite: count(cache.write) ?? 0,
        }
        opencodeV2StartCost = typeof event.cost === 'number' ? event.cost : 0
      }
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
        const totalParts = record(usage.total)
        const lastParts = record(usage.last)
        const parts = (value: Record<string, unknown>): TurnTokenUsage | undefined => {
          const input = count(value.inputTokens)
          const output = count(value.outputTokens)
          const cacheRead = count(value.cachedInputTokens)
          if (input === undefined || output === undefined || cacheRead === undefined)
            return undefined
          return {
            input: Math.max(0, input - cacheRead - (count(value.cacheWriteInputTokens) ?? 0)),
            output,
            cacheRead,
            cacheWrite: count(value.cacheWriteInputTokens) ?? 0,
          }
        }
        const current = parts(totalParts)
        const last = parts(lastParts)
        if (current && last) {
          codexStartUsage ??= {
            input: Math.max(0, current.input - last.input),
            output: Math.max(0, current.output - last.output),
            cacheRead: Math.max(0, current.cacheRead - last.cacheRead),
            cacheWrite: Math.max(0, current.cacheWrite - last.cacheWrite),
          }
          codexLatestUsage = current
        }
      }
      if (provider === 'claude' && event.type === 'result') {
        const usage = record(event.usage)
        const observed = [...claudeMessages.values()]
        const models = [
          ...new Set(
            observed.some((message) => !message.child)
              ? observed.map((message) => message.model)
              : [
                  ...Object.keys(record(event.modelUsage)),
                  ...observed.map((message) => message.model),
                ],
          ),
        ]
        claudeMixedModels = models.length > 1
        claudeModel = models.length === 1 ? models[0] : undefined
        claude = sum(
          usage.input_tokens,
          usage.output_tokens,
          usage.cache_read_input_tokens,
          usage.cache_creation_input_tokens,
        )
        const input = count(usage.input_tokens)
        const output = count(usage.output_tokens)
        if (input !== undefined && output !== undefined)
          claudeUsage = {
            input,
            output,
            cacheRead: count(usage.cache_read_input_tokens) ?? 0,
            cacheWrite: count(usage.cache_creation_input_tokens) ?? 0,
          }
      }
      // The result's usage covers the main loop only. Child messages are per-request,
      // while result.modelUsage is cumulative across a warm/resumed session.
      if (provider === 'claude' && event.type === 'result' && claudeUsage) {
        for (const message of claudeMessages.values())
          if (message.child) {
            claudeUsage = {
              input: claudeUsage.input + message.usage.input,
              output: claudeUsage.output + message.usage.output,
              cacheRead: claudeUsage.cacheRead + message.usage.cacheRead,
              cacheWrite: claudeUsage.cacheWrite + message.usage.cacheWrite,
            }
          }
        claude = Object.values(claudeUsage).reduce((a, b) => a + b, 0)
      }
      if (provider === 'opencode' && name === 'message.updated') {
        const info = record(record(event.properties).info)
        if (info.role !== 'assistant' || typeof info.id !== 'string') return
        const tokens = record(info.tokens)
        const cache = record(tokens.cache)
        const used = sum(tokens.input, tokens.output, tokens.reasoning, cache.read, cache.write)
        if (used !== undefined) opencode.set(info.id, used)
        opencodeUsage.set(info.id, {
          input: count(tokens.input) ?? 0,
          output: (count(tokens.output) ?? 0) + (count(tokens.reasoning) ?? 0),
          cacheRead: count(cache.read) ?? 0,
          cacheWrite: count(cache.write) ?? 0,
        })
        if (typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost > 0)
          opencodeCost.set(info.id, info.cost)
        if (typeof info.modelID === 'string')
          reportedModel =
            typeof info.providerID === 'string'
              ? `${info.providerID}/${info.modelID}`
              : info.modelID
      }
      if (provider === 'opencode' && name === 'session.usage.updated') {
        const tokens = record(record(event.data).tokens)
        const cache = record(tokens.cache)
        const current = {
          input: count(tokens.input) ?? 0,
          output: (count(tokens.output) ?? 0) + (count(tokens.reasoning) ?? 0),
          cacheRead: count(cache.read) ?? 0,
          cacheWrite: count(cache.write) ?? 0,
        }
        opencodeV2Usage = {
          input: Math.max(0, current.input - (opencodeV2Start?.input ?? 0)),
          output: Math.max(0, current.output - (opencodeV2Start?.output ?? 0)),
          cacheRead: Math.max(0, current.cacheRead - (opencodeV2Start?.cacheRead ?? 0)),
          cacheWrite: Math.max(0, current.cacheWrite - (opencodeV2Start?.cacheWrite ?? 0)),
        }
        opencodeV2 = Object.values(opencodeV2Usage).reduce((a, b) => a + b, 0)
        const cost = record(event.data).cost
        if (typeof cost === 'number' && Number.isFinite(cost) && cost > opencodeV2StartCost)
          opencodeV2Cost = cost - opencodeV2StartCost
      }
    },
    total() {
      if (provider === 'cursor') {
        const usage = cursorTotal()
        return usage ? Object.values(usage).reduce((a, b) => a + b, 0) : undefined
      }
      if (provider === 'codex')
        return codexLatest !== undefined && codexStart !== undefined
          ? codexLatest - codexStart
          : undefined
      if (provider === 'claude') return claude
      if (provider === 'opencode' && opencode.size)
        return [...opencode.values()].reduce((total, value) => total + value, 0)
      if (provider === 'opencode') return opencodeV2Unavailable ? undefined : opencodeV2
      return undefined
    },
    usage(): TurnTokenUsage | undefined {
      if (provider === 'cursor') return cursorTotal()
      if (provider === 'claude') return claudeUsage
      if (provider === 'opencode' && opencodeV2Unavailable) return undefined
      if (provider === 'opencode')
        return opencodeUsage.size
          ? [...opencodeUsage.values()].reduce(
              (total, usage) => ({
                input: total.input + usage.input,
                output: total.output + usage.output,
                cacheRead: total.cacheRead + usage.cacheRead,
                cacheWrite: total.cacheWrite + usage.cacheWrite,
              }),
              { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            )
          : opencodeV2Usage
      if (provider !== 'codex' || !codexStartUsage || !codexLatestUsage) return undefined
      const delta = {
        input: codexLatestUsage.input - codexStartUsage.input,
        output: codexLatestUsage.output - codexStartUsage.output,
        cacheRead: codexLatestUsage.cacheRead - codexStartUsage.cacheRead,
        cacheWrite: codexLatestUsage.cacheWrite - codexStartUsage.cacheWrite,
      }
      return Object.values(delta).every((value) => value >= 0) ? delta : undefined
    },
    model() {
      return reportedModel ?? claudeModel
    },
    cost() {
      return provider === 'opencode' && !opencodeV2Unavailable
        ? opencodeCost.size === opencodeUsage.size && opencodeCost.size
          ? [...opencodeCost.values()].reduce((a, b) => a + b, 0)
          : opencodeV2Cost
        : undefined
    },
    mixedModels() {
      return claudeMixedModels
    },
  }
}
