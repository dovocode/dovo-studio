/** Snapshot sent messages while browsing so incoming replies cannot shift the selection. */
export function createComposerHistory() {
  let history: string[] = []
  let started = false
  let generation = 0
  let index = -1
  let original = ''
  let recalled: string | undefined
  const reset = () => {
    history = []
    started = false
    generation++
    index = -1
    recalled = undefined
  }
  return {
    get active() {
      return started
    },
    get generation() {
      return generation
    },
    get atOldest() {
      return started && index === history.length - 1
    },
    appendOlder(messages: readonly { role: string; text: string }[]) {
      if (started)
        history.push(
          ...messages
            .filter((message) => message.role === 'user' && message.text.trim())
            .map((message) => message.text)
            .reverse(),
        )
    },
    reset,
    move(
      direction: 'older' | 'newer',
      draft: string,
      messages: readonly { role: string; text: string }[],
    ) {
      if (recalled !== undefined && recalled !== draft) reset()
      if (!started) {
        if (direction !== 'older' || draft.trim()) return
        history = messages
          .filter((message) => message.role === 'user' && message.text.trim())
          .slice(-50)
          .map((message) => message.text)
          .reverse()
        original = draft
        started = true
      }
      if (direction === 'older' && !history.length) return
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
