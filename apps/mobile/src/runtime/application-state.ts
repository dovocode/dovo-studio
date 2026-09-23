import { RegistryContext, useAtomSet, useAtomValue } from '@effect-atom/atom-react'
import { applicationState } from '@dovo/client-runtime'
import { useContext, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

/** React subscribes to Effect state; commands read that same atom synchronously. */
export function useApplicationState<A>(
  initial: A | (() => A),
  publish?: (previous: A | undefined, next: A) => A,
): readonly [A, Dispatch<SetStateAction<A>>, { current: A }] {
  const [{ atom, view }] = useState(() =>
    applicationState(typeof initial === 'function' ? (initial as () => A)() : initial, publish),
  )
  const registry = useContext(RegistryContext)
  const value = useAtomValue(view)
  const set = useAtomSet(atom)
  const current = useMemo(
    () => ({
      get current() {
        return registry.get(atom)
      },
      set current(value: A) {
        registry.set(atom, value)
      },
    }),
    [atom, registry],
  )
  return [value, set, current]
}
