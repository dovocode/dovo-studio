import type { PullPage } from '@dovo/studio-core'

export type CachedPullPage = PullPage & { firstPageIds?: string[] }

export function refreshPageCount(
  previous: CachedPullPage | undefined,
  force: boolean,
  lastFullSweep: number,
  now: number,
) {
  if (force || !previous || previous.page <= 1) return 1
  return !previous.firstPageIds || now - lastFullSweep >= 120000 ? previous.page : 1
}

/** Keep explicitly loaded later pages while replacing rows that used to be on page one. */
export function refreshPullPage(
  previous: CachedPullPage | undefined,
  incoming: PullPage,
  force: boolean,
): CachedPullPage {
  const firstPageIds = incoming.pulls.map((pull) => String(pull.number))
  if (force || !incoming.hasMore || !previous || previous.page <= 1 || !previous.firstPageIds)
    return { ...incoming, firstPageIds }

  const replaced = new Set([...previous.firstPageIds, ...firstPageIds])
  return {
    ...incoming,
    page: previous.page,
    hasMore: previous.hasMore,
    stale: true,
    refreshError: incoming.refreshError,
    firstPageIds,
    pulls: [
      ...incoming.pulls,
      ...previous.pulls.filter((pull) => !replaced.has(String(pull.number))),
    ],
  }
}
