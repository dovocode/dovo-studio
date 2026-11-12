export type WorkspaceActivity = {
  key: string
  kind: 'thread' | 'browser' | 'terminal'
  pinned: boolean
  activityAt?: number
}

/** Mix input activity without moving pinned page tiles or guessing missing terminal times. */
export function sortWorkspaceActivity<T>(
  items: readonly T[],
  activity: (item: T) => WorkspaceActivity,
): T[] {
  return items
    .map((item) => {
      const facts = activity(item)
      return {
        item,
        key: facts.key,
        pinnedPage: facts.kind === 'browser' && facts.pinned,
        time:
          typeof facts.activityAt === 'number' && Number.isFinite(facts.activityAt)
            ? facts.activityAt
            : 0,
      }
    })
    .sort(
      (a, b) =>
        Number(b.pinnedPage) - Number(a.pinnedPage) ||
        (a.pinnedPage ? 0 : b.time - a.time || (a.time ? a.key.localeCompare(b.key) : 0)),
    )
    .map(({ item }) => item)
}
