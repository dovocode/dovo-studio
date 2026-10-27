import { registerAccessibleNotificationInput, type AccessibleNotificationInput } from './visibility'

export type Rectangle = { x: number; y: number; width: number; height: number }
export type Measure = (callback: (rectangle: Rectangle) => void) => void

export function createNotificationViewport(measureViewport: Measure) {
  const entries = new Set<{
    input: AccessibleNotificationInput
    measure: Measure
    remove?: () => void
  }>()
  let revision = 0
  const refresh = () => {
    const current = ++revision
    for (const entry of entries) {
      entry.remove?.()
      entry.remove = undefined
    }
    measureViewport((viewport) => {
      if (revision !== current || viewport.width <= 0 || viewport.height <= 0) return
      for (const entry of entries) {
        entry.measure((card) => {
          if (revision !== current || !entries.has(entry)) return
          if (
            card.width > 0 &&
            card.height > 0 &&
            card.x >= viewport.x &&
            card.y >= viewport.y &&
            card.x + card.width <= viewport.x + viewport.width &&
            card.y + card.height <= viewport.y + viewport.height
          )
            entry.remove = registerAccessibleNotificationInput(entry.input)
        })
      }
    })
  }
  return {
    refresh,
    observe(input: AccessibleNotificationInput, measure: Measure) {
      const entry: { input: AccessibleNotificationInput; measure: Measure; remove?: () => void } = {
        input,
        measure,
      }
      entries.add(entry)
      refresh()
      return () => {
        entry.remove?.()
        entries.delete(entry)
        refresh()
      }
    },
  }
}
