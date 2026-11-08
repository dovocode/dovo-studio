import { mergeThreadReplicaPage, type Task } from '@dovo/protocol'

type Message = Task['messages'][number]

/**
 * How a late older page relates to the current window. The cursor is the window's oldest message,
 * so a gap reset, a newest-page reload or a history rewrite while the page loaded changes it.
 * Attaching the old window's page and cursor to a new window would hide the gap from paging.
 */
export type OlderReplicaPageFit = 'apply' | 'window-changed' | 'newer-revision'
export function olderReplicaPageFit(
  current: Task,
  page: Task,
  cursor: string,
): OlderReplicaPageFit {
  const revision = current.historyRevision ?? 0
  const pageRevision = page.historyRevision ?? 0
  // The owner rewrote history after this window loaded; only its newest page can restart it.
  if (pageRevision > revision) return 'newer-revision'
  return pageRevision === revision && current.historyBefore === cursor ? 'apply' : 'window-changed'
}
/** Apply an older page only to the window whose cursor requested it. */
export function applyOlderReplicaPage(current: Task, page: Task, cursor: string) {
  return olderReplicaPageFit(current, page, cursor) === 'apply'
    ? mergeThreadReplicaPage(current, page, true)
    : current
}

/** True when a merge replaced the loaded window instead of extending it. */
export function replacedReplicaWindow(previous: readonly Message[], next: readonly Message[]) {
  const last = previous.at(-1)?.id
  return !!last && !!next.length && !next.some((message) => message.id === last)
}
