import { randomUUID } from '@dovo/protocol'

/** Invalid URLs must never issue a request with a coerced or unsafe PR number. */
export function pullRouteNumber(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

export function pullRouteDestination(tab: string | string[] | undefined) {
  if (tab === 'configure-agent-review')
    return {
      initialTab: 'overview',
      initialAgentReview: true,
      configureInitialReview: true,
    } as const
  if (tab === 'agent-review') return { initialTab: 'overview', initialAgentReview: true } as const
  if (tab === 'overview' || tab === 'changes' || tab === 'checks')
    return { initialTab: tab } as const
  return {}
}

// The route can carry an ID, but only an action in this app session can authorize a run.
let pendingReview:
  | { id: string; runtimeId: string; repositoryId: string; number: number }
  | undefined

export function createPullReviewRequest(runtimeId: string, repositoryId: string, number: number) {
  const id = randomUUID()
  pendingReview = { id, runtimeId, repositoryId, number }
  return id
}

export function claimPullReviewRequest(
  id: string,
  runtimeId: string,
  repositoryId: string,
  number: number,
) {
  if (
    !pendingReview ||
    pendingReview.id !== id ||
    pendingReview.runtimeId !== runtimeId ||
    pendingReview.repositoryId !== repositoryId ||
    pendingReview.number !== number
  )
    return false
  pendingReview = undefined
  return true
}
