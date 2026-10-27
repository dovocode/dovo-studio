import type { PullPage } from '@dovo/studio-core'
import { retainNewerPullSnapshot } from '@dovo/protocol'

export type CachedPullPage = PullPage & { firstPageIds?: string[] }

/** Publish one complete opened-page snapshot; shifted boundaries must never reuse old pages. */
export function refreshPullPage(
  previous: CachedPullPage | undefined,
  incoming: PullPage,
  laterPages: PullPage[] = [],
): CachedPullPage {
  const retained = retainNewerPullSnapshot(previous, incoming)
  if (retained !== incoming) return retained
  const firstPageIds = incoming.pulls.map((pull) => String(pull.number))
  const failed = laterPages.find((page) => page.stale || page.refreshError)
  if (failed)
    return {
      ...(previous ?? incoming),
      stale: true,
      refreshError: failed.refreshError ?? 'Older PR pages are unavailable; showing saved results.',
    }
  const last = laterPages.at(-1) ?? incoming
  return {
    ...incoming,
    page: last.page,
    hasMore: last.hasMore,
    firstPageIds,
    pulls: [
      ...new Map(
        [incoming, ...laterPages].flatMap((page) => page.pulls).map((pull) => [pull.number, pull]),
      ).values(),
    ],
  }
}
