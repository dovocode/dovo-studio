import { Effect, Schema } from 'effect'
import { decode, mutableStruct, usagePriceSchema, resolveTaskAgent } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { RuntimeServices } from '../../services.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'
import { errorMessage } from '../../errors.js'
export const usageHistory = (request: IncomingMessage, path: string) =>
  Effect.gen(function* () {
    const s = yield* RuntimeServices
    if (path === '/api/usage/prices/write') {
      const input = decode(
        mutableStruct({
          model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
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
          Schema.filter(
            (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
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
      Effect.catchAll((cause) =>
        Effect.sync(() => {
          notices.push(`${errorMessage(cause)}. Showing available cached or local rates.`)
        }),
      ),
    )
    const saved = yield* serviceResult(
      s.store.usage.read(new Date(Date.now() - 90 * 86400000).toISOString()),
    )
    const sessions = new Set(
      saved.flatMap((record) =>
        record.origin !== 'cli' && record.sessionId
          ? [`${record.turn.provider}:${record.sessionId}`]
          : [],
      ),
    )
    for (const task of s.store.get().tasks)
      if (task.sessionId) {
        const provider = task.turns?.at(-1)?.provider
        if (provider) sessions.add(`${provider}:${task.sessionId}`)
      }
    const external = yield* serviceResult(
      s.store.usageTranscripts.read(
        [
          ...s.store.get().agents,
          ...s.store.get().tasks.flatMap((task) => {
            const agent = resolveTaskAgent(task, s.store.get().agents)
            return agent ? [agent] : []
          }),
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
