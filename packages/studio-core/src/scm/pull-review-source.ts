import { useEffect, useRef, useState } from 'react'
import {
  forgePullTarget,
  forgeSourceIdentitySchema,
  pullDetailSchema,
  pullReference,
  verifyPullUrl,
  type ForgeSourceIdentity,
  type PullDetail,
  type Repository,
} from '@dovo/protocol'
import type { WorkspaceRequest } from '../workspace/context'

/** Match destination projects by forge identity. Origin-local IDs are never portable. */
export function pullReviewRepositories(url: string, repositories: readonly Repository[]) {
  return repositories.filter((repository) => {
    if (repository.kind) return false
    const identity = repository.pullIdentity ?? repository.gitIdentity
    const target = forgePullTarget(url, [{ identity }])
    return !!identity && target?.identity === identity
  })
}

export async function resolvePullReviewSource({
  detail,
  repositoryId,
  request,
  pin,
  remember,
}: {
  detail: Pick<PullDetail, 'pull'>
  repositoryId: string
  request: WorkspaceRequest
  pin?: ForgeSourceIdentity
  remember: (identity: ForgeSourceIdentity) => void
}) {
  const identity =
    pin ??
    (await request(
      '/api/scm/source/identity',
      { repositoryId, refresh: true },
      forgeSourceIdentitySchema,
    ))
  remember(identity)
  const resolved = await request(
    '/api/scm/pulls/detail',
    {
      repositoryId,
      number: detail.pull.number,
      section: 'overview',
      refresh: true,
      expectedDestination: identity.destination,
      expectedReaderIdentity: identity.readerIdentity,
    },
    pullDetailSchema,
  )
  verifyPullUrl(pullReference(detail.pull.url).url, resolved.pull.url)
  if (
    resolved.stale ||
    resolved.refreshError ||
    resolved.pull.headSha !== detail.pull.headSha ||
    resolved.pull.baseSha !== detail.pull.baseSha
  )
    throw new Error(
      'This PR changed or is unavailable on this computer. Refresh the PR before continuing.',
    )
  return { ...resolved, destination: identity.destination }
}

export function usePullReviewSource({
  detail,
  repositories,
  request,
  scope,
  connected,
}: {
  detail: Pick<PullDetail, 'pull'>
  repositories: readonly Repository[]
  request: WorkspaceRequest
  scope: string
  connected: boolean
}) {
  const currentDetail = useRef(detail)
  currentDetail.current = detail
  const candidates = pullReviewRepositories(detail.pull.url, repositories)
  const [chosen, setChosen] = useState('')
  const repositoryId =
    (candidates.some((repository) => repository.id === chosen) ? chosen : '') ||
    (candidates.length === 1
      ? candidates[0].id
      : candidates.length
        ? ''
        : (forgePullTarget(detail.pull.url)?.url ?? ''))
  const key = JSON.stringify([
    scope,
    repositoryId,
    detail.pull.url,
    detail.pull.headSha,
    detail.pull.baseSha,
  ])
  const pins = useRef(new Map<string, ForgeSourceIdentity>())
  const pinKey = JSON.stringify([scope, repositoryId])
  const [attempt, setAttempt] = useState(0)
  const sourceKey = JSON.stringify([scope, repositoryId, detail.pull.url])
  const [state, setState] = useState<{
    key: string
    sourceKey: string
    detail?: PullDetail
    error?: string
  }>()
  useEffect(() => {
    if (!connected || !repositoryId) return
    let disposed = false
    void resolvePullReviewSource({
      detail: currentDetail.current,
      repositoryId,
      request,
      pin: pins.current.get(pinKey),
      remember: (identity) => pins.current.set(pinKey, identity),
    }).then(
      (detail) => {
        if (!disposed) setState({ key, sourceKey, detail })
      },
      (error) => {
        if (!disposed)
          setState((previous) => ({
            key,
            sourceKey,
            detail: previous?.sourceKey === sourceKey ? previous.detail : undefined,
            error: error instanceof Error ? error.message : String(error),
          }))
      },
    )
    return () => {
      disposed = true
    }
  }, [key, pinKey, sourceKey, request, connected, attempt])
  return {
    candidates,
    repositoryId,
    choose: setChosen,
    detail: state?.sourceKey === sourceKey ? state.detail : undefined,
    ready: state?.key === key && !state.error,
    error: state?.key === key ? state.error : undefined,
    refresh: () => {
      setState((previous) => (previous ? { ...previous, key: '' } : undefined))
      setAttempt((n) => n + 1)
    },
  }
}
