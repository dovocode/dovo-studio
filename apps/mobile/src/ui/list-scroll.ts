/** Restore only after native layout can represent the saved position. */
export function createListScroll(saved: { current: number }, scrollTo: (offset: number) => void) {
  // Keep intent through all mount/inset passes, including a temporarily shorter list.
  // The first real drag takes ownership of the position again.
  let target: number | null = saved.current > 0 ? saved.current : null
  let viewport = 0,
    content = 0,
    actual = 0,
    focused = true
  const record = (offset: number) => {
    actual = Math.max(0, offset)
    if (!focused) return
    // Initial FlatList windows and changing tab insets can clamp a mount-time offset.
    if (target !== null && Math.abs(actual - target) > 1) return
    saved.current = actual
  }
  const restore = () => {
    if (!focused || target === null || !viewport || !content) return
    const offset = Math.min(target, Math.max(0, content - viewport))
    if (Math.abs(actual - offset) <= 1) return
    scrollTo(offset)
  }
  return {
    retainPosition() {
      // Capture before navigation dismisses the keyboard or hides the native tab bar.
      target = saved.current
    },
    setFocused(value: boolean) {
      if (focused && !value && target === null) target = saved.current
      focused = value
      if (focused) restore()
    },
    viewport(height: number) {
      viewport = height
      restore()
    },
    content(height: number) {
      content = height
      restore()
    },
    scroll: record,
    beginDrag() {
      if (!focused) return
      target = null
      saved.current = actual
    },
  }
}
