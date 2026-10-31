import type { ConversationPage } from './history.js'

const sizes = new WeakMap<object, number>()

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
  { budget, keep = 500, protectFrom }: { budget: number; keep?: number; protectFrom?: string },
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
