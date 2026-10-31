/** Navigation continuity only. Credentials are part of the caller-owned scope and never persisted. */
export type ConversationReadingPosition = {
  anchorId?: string
  /** Physical position of the anchor's top relative to the viewport's top. */
  anchorOffset: number
  scrollOffset: number
  atEnd: boolean
}

export function createReadingPositionCache(limit = 100) {
  const positions = new Map<string, ConversationReadingPosition>()
  return {
    read(scope: string) {
      return positions.get(scope)
    },
    remember(scope: string, position: ConversationReadingPosition) {
      if (![position.anchorOffset, position.scrollOffset].every(Number.isFinite)) return
      positions.delete(scope)
      positions.set(scope, { ...position })
      if (positions.size > limit) positions.delete(positions.keys().next().value!)
    },
  }
}

/** Inverted native lists move their cells down as their logical offset increases. */
export function readingPositionOffset(
  currentOffset: number,
  measuredAnchorOffset: number,
  wantedAnchorOffset: number,
  inverted = false,
) {
  return Math.max(
    0,
    currentOffset + (inverted ? -1 : 1) * (measuredAnchorOffset - wantedAnchorOffset),
  )
}
