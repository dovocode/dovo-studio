import type { Schema } from 'effect'
import type { RuntimeProfile } from '../../runtime/connection/runtime-fleet.js'
import type { RuntimeReadCache } from '../../runtime/cache/read-cache.js'
import { usageHistorySchema, type UsageHistoryResult } from './usage-history.js'
import { usageLimitsReadSchema, usageHubsSchema, type UsageHub } from '../workflow/plan-limits.js'
export type UsageRead = <S extends Schema.Codec<unknown, unknown>>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: S,
  method?: 'GET' | 'POST' | 'PATCH',
) => Promise<S['Type']>
/** Independent host results, progressive history, and credential-scoped offline replicas. */
export async function refreshUsageEntry(input: {
  profile: RuntimeProfile
  connected: boolean
  force: boolean
  /** Limits never need transcript scans or the potentially large saved history. */
  kind?: 'history' | 'limits'
  read: UsageRead
  cache: RuntimeReadCache
  refresh: () => Promise<void>
  publish: (history: UsageHistoryResult) => void
  publishHubs?: (hubs: UsageHub[]) => void
}) {
  const { profile, read, cache, publish } = input
  const notices: string[] = []
  const error = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  const cached =
    input.kind === 'limits'
      ? null
      : await cache.read('usage-history', usageHistorySchema).catch((cause) => {
          notices.push(`Usage cache: ${error(cause)}`)
          return null
        })
  if (cached) publish(cached.value)
  let savedHubs: UsageHub[] = []
  if (input.kind !== 'history' && input.publishHubs) {
    const saved = await cache.read('usage-hubs', usageHubsSchema).catch((cause) => {
      notices.push(`Hub cache: ${error(cause)}`)
      return null
    })
    if (saved) {
      savedHubs = saved.value
      input.publishHubs(saved.value)
    }
  }
  if (!input.connected) return notices
  const history =
    input.kind === 'limits'
      ? Promise.resolve()
      : read(
          profile,
          '/api/usage/history/read',
          { since: new Date(Date.now() - 90 * 86400000).toISOString(), force: input.force },
          usageHistorySchema,
          'POST',
        ).then(async (history) => {
          publish(history)
          notices.push(...history.notices)
          await cache
            .write('usage-history', history)
            .catch((cause) => notices.push(`Usage cache: ${error(cause)}`))
        })
  const limits =
    input.kind === 'history'
      ? Promise.resolve()
      : read(
          profile,
          '/api/usage/limits/read',
          { force: input.force, ...(input.publishHubs ? { section: 'local' } : {}) },
          usageLimitsReadSchema,
          'POST',
        ).then(async (limits) => {
          notices.push(
            ...limits.accounts.flatMap((account) =>
              account.status === 'ok'
                ? []
                : [
                    `${account.provider}: ${account.reason ?? 'Subscription windows unavailable for this configuration.'}`,
                  ],
            ),
          )
          await input.refresh()
        })
  // Old runtimes ignore the optional section and keep returning their combined result.
  const hubs =
    input.kind === 'history' || !input.publishHubs
      ? Promise.resolve()
      : read(
          profile,
          '/api/usage/limits/read',
          { force: input.force, section: 'hubs' },
          usageLimitsReadSchema,
          'POST',
        )
          .then(async (result) => {
            input.publishHubs?.(result.hubs ?? [])
            await cache
              .write('usage-hubs', result.hubs ?? [])
              .catch((cause) => notices.push(`Hub cache: ${error(cause)}`))
          })
          .catch((cause) => {
            input.publishHubs?.(
              savedHubs.map((hub) => ({
                ...hub,
                accounts: hub.accounts?.map((account) => ({
                  ...account,
                  status: 'failed' as const,
                })),
                error: 'Hub readings could not be refreshed.',
              })),
            )
            throw cause
          })
  const results = await Promise.allSettled([history, limits, hubs])
  for (const result of results) if (result.status === 'rejected') notices.push(error(result.reason))
  return [...new Set(notices)]
}
