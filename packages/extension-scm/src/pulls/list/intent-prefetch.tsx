import { useCallback, useEffect, useRef } from 'react'
import { useWorkspace, WorkspaceRuntimeScope, type RepositorySource } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { usePullOverviewPrefetch } from '../detail/use-pull-detail'

/** A short rest separates intent from a pointer that only passes over a row. */
export const PULL_INTENT_DELAY_MS = 150

export type PullIntentTarget = { source: RepositorySource; number: number }

function PullOverviewPrefetch({ repositoryId, number }: { repositoryId: string; number: number }) {
  usePullOverviewPrefetch(repositoryId, number)
  return null
}

const targetKey = (target: PullIntentTarget) =>
  JSON.stringify([target.source.key, target.source.scope, target.number])

/** Warm the overview a row opens once the pointer or focus rests on it. Passing over rows sends
 * nothing. Leaving, switching, removing or opening a row unmounts its prefetch at once; a read
 * already sent is not cancelled, but finishes once into the shared bounded cache, with no further
 * reads or polling. Clicks never wait for the prefetch. */
export function usePullIntentPrefetch(eligible: (target: PullIntentTarget) => boolean) {
  const { runtimes } = useWorkspace()
  const [target, setTarget, targetRef] = useApplicationState<PullIntentTarget | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<string | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // A removed or opened row fires no leave event. A removed computer has no scope to read in.
  const active =
    target !== null &&
    eligible(target) &&
    runtimes.some((runtime) => runtime.profile.id === target.source.runtimeId)
  useEffect(() => {
    if (target !== null && !active) setTarget(null)
  }, [target, active])
  const intent = useCallback((next: PullIntentTarget | null) => {
    const key = next && targetKey(next)
    // Focus and pointer on the same row are one intent; keep its prefetch or its running timer.
    const current = targetRef.current
    if (key && current && targetKey(current) === key) {
      clearTimeout(timer.current)
      pending.current = undefined
      return
    }
    if (key && pending.current === key) return
    clearTimeout(timer.current)
    pending.current = undefined
    // Another row, or none: stop the previous row now, not when the next timer fires.
    if (current) setTarget(null)
    if (!next || !key) return
    pending.current = key
    timer.current = setTimeout(() => {
      pending.current = undefined
      setTarget(next)
    }, PULL_INTENT_DELAY_MS)
  }, [])
  // The detail opens inside its source's computer scope. Read inside that same scope.
  const prefetch = active ? (
    <WorkspaceRuntimeScope runtimeId={target.source.runtimeId}>
      <PullOverviewPrefetch
        key={JSON.stringify([target.source.scope, target.source.repository.id, target.number])}
        repositoryId={target.source.repository.id}
        number={target.number}
      />
    </WorkspaceRuntimeScope>
  ) : null
  return { intent, prefetch }
}
