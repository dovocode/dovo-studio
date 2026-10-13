/** Snapshot sent messages while browsing so incoming replies cannot shift the selection. */
export function createComposerHistory() {
  let history: string[] = []
  let index = -1
  let original = ''
  let recalled: string | undefined
  const reset = () => {
    history = []
    index = -1
    recalled = undefined
  }
  return {
    get active() {
      return index >= 0
    },
    reset,
    move(
      direction: 'older' | 'newer',
      draft: string,
      messages: readonly { role: string; text: string }[],
    ) {
      if (recalled !== undefined && recalled !== draft) reset()
      if (index < 0) {
        if (direction !== 'older' || draft.trim()) return
        history = messages
          .filter((message) => message.role === 'user' && message.text.trim())
          .map((message) => message.text)
          .reverse()
        if (!history.length) return
        original = draft
      }
      if (direction === 'older') index = Math.min(index + 1, history.length - 1)
      else index -= 1
      if (index < 0) {
        const restored = original
        reset()
        return restored
      }
      recalled = history[index]
      return recalled
    },
  }
}
