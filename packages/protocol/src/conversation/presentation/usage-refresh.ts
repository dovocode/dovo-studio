import type { Schema } from 'effect'
import type { RuntimeProfile } from '../../runtime/connection/runtime-fleet.js'
import type { RuntimeReadCache } from '../../runtime/cache/read-cache.js'
import { usageHistorySchema, type UsageHistoryResult } from './usage-history.js'
import { usageLimitsReadSchema } from '../workflow/plan-limits.js'
export type UsageRead = <S extends Schema.Schema.AnyNoContext>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: S,
  method?: 'GET' | 'POST' | 'PATCH',
) => Promise<Schema.Schema.Type<S>>
/** Independent host results, progressive history, and credential-scoped offline replicas. */
export async function refreshUsageEntry(input: {
  profile: RuntimeProfile
  connected: boolean
  force: boolean
  read: UsageRead
  cache: RuntimeReadCache
  refresh: () => Promise<void>
  publish: (history: UsageHistoryResult) => void
}) {
  const { profile, read, cache, publish } = input
  const notices: string[] = []
  const error = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  const cached = await cache.read('usage-history', usageHistorySchema).catch((cause) => {
    notices.push(`Usage cache: ${error(cause)}`)
    return null
  })
  if (cached) publish(cached.value)
  if (!input.connected) return notices
  const history = read(
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
  const limits = read(
    profile,
    '/api/usage/limits/read',
    { force: input.force },
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
  const results = await Promise.allSettled([history, limits])
  for (const result of results) if (result.status === 'rejected') notices.push(error(result.reason))
  return [...new Set(notices)]
}
