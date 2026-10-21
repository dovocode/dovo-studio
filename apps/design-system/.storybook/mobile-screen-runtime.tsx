import { type ReactNode } from 'react'
import {
  RuntimeContext,
  useRuntime,
  type Runtime,
} from '../../mobile/src/runtime/connection/context'

export { RuntimeContext, useRuntime }
export type { Runtime }

export function RuntimeValueProvider({ value, children }: { value: Runtime; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

/** Catalog-only projection: screens consume the synthetic context, never mount transport effects. */
export function useRuntimeSelector<A>(select: (runtime: Runtime) => A): A {
  return select(useRuntime())
}

export function sameRuntimeFields<A extends object>(previous: A, next: A) {
  const keys = Object.keys(next) as (keyof A)[]
  return (
    Object.keys(previous).length === keys.length &&
    keys.every((key) => Object.is(previous[key], next[key]))
  )
}

export function RuntimeScope({ runtimeId, children }: { runtimeId: string; children: ReactNode }) {
  const runtime = useRuntime()
  const entry = runtime.overviews.find((overview) => overview.profile.id === runtimeId)
  if (!entry) throw new Error('Catalog has no fixture for runtime ' + runtimeId)
  return (
    <RuntimeContext.Provider
      value={{
        ...runtime,
        activeId: runtimeId,
        profile: entry.profile,
        connection: entry.profile.connection,
        snapshot: entry.snapshot,
        connected: entry.connected,
        error: entry.error ?? '',
      }}
    >
      {children}
    </RuntimeContext.Provider>
  )
}
