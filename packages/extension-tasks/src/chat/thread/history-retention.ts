import {
  compactConversationPages,
  conversationPagesSize,
  trimConversationPages,
  type ConversationPage,
  type Task,
} from '@dovo/protocol'

type LiveWindow = Pick<Task, 'messages' | 'turns' | 'historyBefore' | 'historyRevision'>
type RetainedHistory = {
  revision: number
  pages: ConversationPage[]
  size: number
  readers: number
}

/** Desktop and web fill this many recent messages before older pages load on demand. */
export const recentMessageCount = 500
/** Approximate UTF-16 bytes kept for every remembered conversation together. */
export const sessionHistoryBudget = 48 * 1024 * 1024
/** Older pages beyond the recent window are trimmed once a conversation exceeds this. */
export const conversationHistoryBudget = 12 * 1024 * 1024

const retained = new Map<string, RetainedHistory>()
export { conversationPagesSize, trimConversationPages } from '@dovo/protocol'

/** Pages remembered from an earlier visit, only if they still join the live window. */
export function restoreConversationPages(
  scope: string,
  revision: number,
  live: LiveWindow,
): ConversationPage[] {
  const entry = retained.get(scope)
  if (!entry) return []
  retained.delete(scope)
  const first = live.messages[0]?.id
  // A remembered page that no longer reaches the live window would hide a gap as complete history.
  if (
    entry.revision !== revision ||
    !live.historyBefore ||
    first === undefined ||
    !entry.pages.some((page) => page.messages.some((message) => message.id === first))
  ) {
    // Another panel may still own this scope. Invalidate its pages without losing reader leases.
    if (entry.readers) retained.set(scope, { revision, pages: [], size: 0, readers: entry.readers })
    return []
  }
  retained.set(scope, entry)
  return entry.pages
}

/** Record the pages a thread currently shows; a shown thread is never evicted. */
export function rememberConversationPages(
  scope: string,
  revision: number,
  pages: ConversationPage[],
) {
  const entry = retained.get(scope)
  retained.delete(scope)
  if (!pages.length) {
    if (entry?.readers) retained.set(scope, { revision, pages, size: 0, readers: entry.readers })
    return
  }
  retained.set(scope, {
    revision,
    pages,
    size: entry?.pages === pages ? entry.size : conversationPagesSize(pages),
    readers: entry?.readers ?? 0,
  })
  enforceSessionBudget()
}

/** Protect a scope while a thread shows it; release keeps a bounded copy for returning. */
export function holdConversationPages(scope: string) {
  const entry = retained.get(scope)
  if (entry) entry.readers++
  else retained.set(scope, { revision: 0, pages: [], size: 0, readers: 1 })
  return (live: LiveWindow) => {
    const current = retained.get(scope)
    if (!current) return
    current.readers--
    if (current.readers > 0) return
    if (
      !current.pages.length ||
      !live.historyBefore ||
      (live.historyRevision ?? 0) !== current.revision
    ) {
      retained.delete(scope)
      return
    }
    const pages = trimConversationPages(
      compactConversationPages([
        ...current.pages,
        {
          messages: live.messages,
          turns: live.turns ?? [],
          historyRevision: current.revision,
          before: live.historyBefore,
        },
      ]),
      { budget: conversationHistoryBudget },
    )
    retained.set(scope, { ...current, pages, size: conversationPagesSize(pages) })
    enforceSessionBudget()
  }
}

function enforceSessionBudget() {
  let total = 0
  for (const entry of retained.values()) total += entry.size
  // Map order is least recently used first.
  for (const [scope, entry] of retained) {
    if (total <= sessionHistoryBudget) return
    if (entry.readers) continue
    retained.delete(scope)
    total -= entry.size
  }
}
