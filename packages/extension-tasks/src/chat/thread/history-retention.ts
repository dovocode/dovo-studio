import { compactConversationPages, type ConversationPage, type Task } from '@dovo/protocol'

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

const sizes = new WeakMap<object, number>()
const retained = new Map<string, RetainedHistory>()

/** Approximate retained string memory; cached per immutable message or turn object. */
function retainedSize(value: object) {
  let size = sizes.get(value)
  if (size === undefined) {
    size = JSON.stringify(value).length * 2
    sizes.set(value, size)
  }
  return size
}

export function conversationPagesSize(pages: readonly ConversationPage[]) {
  let size = 0
  for (const page of pages) {
    for (const message of page.messages) size += retainedSize(message)
    for (const turn of page.turns) size += retainedSize(turn)
  }
  return size
}

/**
 * Drop the oldest whole messages until loaded history fits its budget. The recent window and
 * everything from `protectFrom` onward stay, even when one of those messages alone is oversized.
 */
export function trimConversationPages(
  pages: ConversationPage[],
  {
    budget,
    keep = recentMessageCount,
    protectFrom,
  }: { budget: number; keep?: number; protectFrom?: string },
): ConversationPage[] {
  let changed = false
  const trimmed = pages.map((page) => {
    const { messages } = page
    const protectedIndex =
      protectFrom === undefined ? -1 : messages.findIndex((message) => message.id === protectFrom)
    let required = Math.max(0, messages.length - keep)
    if (protectedIndex >= 0) required = Math.min(required, protectedIndex)
    const turnsByMessage = new Map(page.turns.map((turn) => [turn.assistantId, turn]))
    let start = messages.length
    let size = 0
    while (start > 0) {
      const message = messages[start - 1]!
      const turn = turnsByMessage.get(message.id)
      const next = retainedSize(message) + (turn ? retainedSize(turn) : 0)
      if (start - 1 < required && size + next > budget) break
      size += next
      start--
    }
    // Start at a request so the oldest retained turn keeps its prompt.
    while (start > 0 && start < required && messages[start]!.role !== 'user') start++
    if (start === 0) return page
    changed = true
    const kept = messages.slice(start)
    const ids = new Set(kept.map((message) => message.id))
    const owned = new Set(kept.flatMap((message) => (message.turnId ? [message.turnId] : [])))
    return {
      ...page,
      messages: kept,
      turns: page.turns.filter((turn) => ids.has(turn.assistantId) || owned.has(turn.id)),
      before: kept[0]!.id,
    }
  })
  return changed ? trimmed : pages
}

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
