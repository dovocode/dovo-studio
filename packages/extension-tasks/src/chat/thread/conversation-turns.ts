export { conversationTurns, conversationTurnLabel, type ConversationTurn } from '@dovo/protocol'
import type { ConversationTurn } from '@dovo/protocol'

/** Paging can reveal an earlier request in a mounted turn; keep its existing message tree. */
export function createConversationTurnKeys() {
  let previous = new Map<string, string>()
  let sequence = 0
  return (groups: ConversationTurn[]) => {
    const used = new Set<string>()
    const next = new Map<string, string>()
    // A regrouping preserves the latest visible reply when multiple old groups join or split.
    const result = [...groups].reverse().map((group) => {
      const existing = [...group.messages]
        .reverse()
        .map((message) => previous.get(message.id))
        .find((key) => key !== undefined && !used.has(key))
      const key = existing ?? String(sequence++)
      used.add(key)
      for (const message of group.messages) next.set(message.id, key)
      return { ...group, key }
    })
    previous = next
    return result.reverse()
  }
}
