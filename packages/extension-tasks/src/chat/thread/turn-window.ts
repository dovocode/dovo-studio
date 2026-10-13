import { createContext, useCallback, useContext, useState } from 'react'

/** Conversation state that must outlive distant turns while they are unmounted. */
export class TurnWindow {
  /** Last rendered height of each turn; its placeholder keeps the same scroll extent. */
  readonly heights = new Map<string, number>()
  /** Turns whose content is currently mounted. */
  readonly mounted = new Set<string>()
  /** Disclosure choices change a turn's height, so they return with the turn. */
  readonly disclosures = new Map<string, boolean | null>()
  /** The conversation scroller, used to check whether the reader is at the live end. */
  scrollRoot: HTMLElement | null = null
  private readonly listeners = new Set<() => void>()
  setMounted(id: string, mounted: boolean) {
    if (mounted === this.mounted.has(id)) return
    if (mounted) this.mounted.add(id)
    else this.mounted.delete(id)
    for (const listener of this.listeners) listener()
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const TurnWindowContext = createContext<TurnWindow | null>(null)

/** A disclosure choice that survives its turn leaving and re-entering the render window. */
export function useTurnDisclosure(key: string | undefined, initial: boolean | null = null) {
  const turns = useContext(TurnWindowContext)
  const stored = () => {
    const value = key === undefined ? undefined : turns?.disclosures.get(key)
    return value === undefined ? initial : value
  }
  const [state, setState] = useState(() => ({ key, value: stored() }))
  const value = state.key === key ? state.value : stored()
  const setValue = useCallback(
    (next: boolean | null) => {
      if (key !== undefined) turns?.disclosures.set(key, next)
      setState({ key, value: next })
    },
    [turns, key],
  )
  return [value, setValue] as const
}
