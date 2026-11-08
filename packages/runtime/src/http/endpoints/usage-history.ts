import { Effect, Schema } from 'effect'
import {
  decode,
  mutableStruct,
  usagePriceSchema,
  resolveTaskAgent,
  type Agent,
} from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { RuntimeServices } from '../../runtime-services.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'
import { errorMessage } from '../../errors.js'
export const usageHistory = (request: IncomingMessage, path: string) =>
  Effect.gen(function* () {
    const s = yield* RuntimeServices
    if (path === '/api/usage/prices/write') {
      const input = decode(
        mutableStruct({
          model: Schema.String.pipe(
            Schema.check(Schema.isMinLength(1)),
            Schema.check(Schema.isMaxLength(300)),
          ),
          price: Schema.optional(usagePriceSchema),
        }),
        yield* serviceResult(body(request)),
      )
      s.store.usagePricing.setOverride(input.model, input.price)
      return { ok: true }
    }
    const input = decode(
      mutableStruct({
        force: Schema.optional(Schema.Boolean),
        since: Schema.String.pipe(
          Schema.check(
            Schema.makeFilter(
              (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
            ),
          ),
        ),
      }),
      yield* serviceResult(body(request)),
    )
    const since = new Date(
      Math.max(Date.parse(input.since), Date.now() - 90 * 86400000),
    ).toISOString()
    const notices: string[] = []
    yield* serviceResult(s.store.usagePricing.refresh(input.force ?? false)).pipe(
      Effect.catch((cause) =>
        Effect.sync(() => {
          notices.push(`${errorMessage(cause)}. Showing available cached or local rates.`)
        }),
      ),
    )
    const sessions = yield* serviceResult(
      s.store.usage.ownedSessions(new Date(Date.now() - 90 * 86400000).toISOString()),
    )
    for (const task of s.store.get().tasks)
      if (task.sessionId) {
        const provider = task.history.latestTurn?.provider
        if (provider) sessions.add(`${provider}:${task.sessionId}`)
      }
    // Transcript scanning only needs directories. Never unlock unrelated API credentials
    // just to read local history, and never fall back to a different account on failure.
    const workspace = s.store.get()
    const configuredAgents = [
      ...workspace.agents,
      ...workspace.tasks.flatMap((task) => {
        const agent = resolveTaskAgent(task, workspace.agents)
        return agent ? [agent] : []
      }),
    ]
    const directoryVariables = new Set([
      'HOME',
      'XDG_DATA_HOME',
      'CODEX_HOME',
      'CLAUDE_CONFIG_DIR',
      'OPENCODE_DATA_DIR',
    ])
    const agents: Agent[] = []
    for (const agent of configuredAgents) {
      if (!['codex', 'claude', 'opencode'].includes(agent.provider)) continue
      const resolved = yield* serviceResult(
        s.agents.secretReferences
          .resolve(
            s.agents.configure({
              ...agent,
              envSecrets: Object.fromEntries(
                Object.entries(agent.envSecrets ?? {}).filter(([name]) =>
                  directoryVariables.has(name),
                ),
              ),
            }),
          )
          .then(
            (agent) => ({ agent }),
            () => ({ agent: undefined }),
          ),
      )
      if (resolved.agent) agents.push(resolved.agent)
      else
        notices.push(
          `Could not resolve transcript directories for agent ${agent.id}. Its configured history was not scanned.`,
        )
    }
    const external = yield* serviceResult(
      s.store.usageTranscripts.read(
        [
          ...agents,
          ...(['codex', 'claude', 'opencode'] as const).map((provider) => ({
            id: `usage:${provider}`,
            name: provider,
            provider,
            endpoint: '',
            model: '',
            instructions: '',
            permission: 'ask' as const,
          })),
        ],
        sessions,
        input.force ?? false,
      ),
    )
    s.store.usage.recordExternal(external.records)
    return {
      sourceId: s.store.usage.sourceId,
      records: (yield* serviceResult(s.store.usage.read(since))).map((record) =>
        s.store.usagePricing.price(record),
      ),
      notices: [...notices, ...external.notices],
      pricingUpdatedAt: s.store.usagePricing.updatedAt,
      overrides: s.store.usagePricing.getOverrides(),
    }
  })
