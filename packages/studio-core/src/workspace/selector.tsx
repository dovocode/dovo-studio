import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { WorkspaceContext, type WorkspaceContextValue } from './context'

const WorkspaceStateContext = createContext<Atom.Writable<WorkspaceContextValue> | null>(null)

/** Broad readers keep the context value; selectors subscribe only to the slice they render. */
export function WorkspaceValueProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue
  children: ReactNode
}) {
  // A rebuilt atom node reads the latest committed value, never a retained first snapshot.
  const committed = useRef(value)
  const [atom] = useState(() =>
    Atom.writable(
      () => committed.current,
      (context, next: WorkspaceContextValue) => context.setSelf(next),
    ),
  )
  const registry = useContext(RegistryContext)
  // Publish after commit, as the conversation selectors do, so render stays free of updates.
  useLayoutEffect(() => {
    committed.current = value
    registry.set(atom, value)
  }, [registry, atom, value])
  return (
    <WorkspaceStateContext.Provider value={atom}>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </WorkspaceStateContext.Provider>
  )
}

/**
 * Re-render only when the selected value changes. Keep `select` and `equals` stable, for
 * example at module scope or with useCallback, so the derived subscription is reused.
 */
export function useWorkspaceSelector<A>(
  select: (value: WorkspaceContextValue) => A,
  equals: (previous: A, next: A) => boolean = Object.is,
): A {
  const atom = useContext(WorkspaceStateContext)
  if (!atom) throw new Error('WorkspaceProvider is required')
  const selected = useMemo(
    () => Atom.withEquality(Atom.map(atom, select), equals),
    [atom, select, equals],
  )
  return useAtomValue(selected)
}

/** Compare selected records field by field, for action and identity slices. */
export function sameWorkspaceFields<A extends object>(previous: A, next: A) {
  const keys = Object.keys(next) as (keyof A)[]
  return (
    Object.keys(previous).length === keys.length &&
    keys.every((key) => Object.is(previous[key], next[key]))
  )
}
