import type { Repository } from '../../workspace.js'
import { gitRemoteIdentity } from '../../runtime/connection/project-machines.js'
import type { ForgeConnection } from '../forges/forges.js'
import type { PullSummary } from './pulls.js'

/** Match the public clone identity, even when API and clone URLs differ. */
export function forgePullIdentity(
  connection: Pick<ForgeConnection, 'provider' | 'baseUrl'>,
  repository: string,
) {
  const base =
    connection.provider === 'bitbucket'
      ? 'https://bitbucket.org'
      : connection.baseUrl.replace(/\/+$/, '')
  const [owner, name] = repository.split('/')
  const path = connection.provider === 'azure-devops' ? `${owner}/_git/${name}` : repository
  const identity = gitRemoteIdentity(`${base}/${path}`)
  return connection.provider === 'github' ? identity?.toLowerCase() : identity
}

/** Only PR target and account changes invalidate a summary, not live task activity. */
export function pullOverviewScope(repositories: readonly Repository[]) {
  return JSON.stringify(
    repositories.map((repository) => [
      repository.id,
      repository.path,
      repository.gitIdentity,
      repository.pullIdentity,
      repository.forge,
    ]),
  )
}

/** A bound PR target is authoritative; never match a stale checkout or its fork instead. */
export function pullRepositoryIdentity(repository: Repository) {
  return (
    repository.pullIdentity ||
    (!repository.kind && !repository.forge && !repository.gitIdentityError
      ? repository.gitIdentity
      : undefined)
  )
}

/** A forge binding can target a different repository from the checkout's origin. */
export function pullRepositoryKey(repository: Repository, sourceKey: string) {
  return pullRepositoryIdentity(repository) || sourceKey
}

/** One remote read per repository. Keep a stable owner until it disconnects; an explicit
 * project filter belongs before this selection so actions retain that project's account. */
export function selectPullSources<
  T extends { key: string; repository: Repository; connected: boolean; runtimeId?: string },
>(sources: readonly T[]): T[] {
  return assignRemoteSources(sources).selected
}

/** Older runtimes may not know their remote identity yet. Never merge viewer flags
 * from different accounts: the selected source owns the entire row. */
export function uniquePulls<T extends Pick<PullSummary, 'url'>>(pulls: readonly T[]): T[] {
  const selected = new Map<string, T>()
  for (const pull of pulls) {
    const url = new URL(pull.url)
    const key = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
    if (!selected.has(key)) selected.set(key, pull)
  }
  return [...selected.values()]
}

/** Public rows can remain visible during reader handoff; account relationships must be reloaded. */
export function publicPullSummaries(pulls: readonly PullSummary[]): PullSummary[] {
  return pulls.map((pull) => ({
    ...pull,
    viewerIsAuthor: undefined,
    viewerIsAssigned: undefined,
    viewerIsInvolved: undefined,
    viewerReviewRequested: undefined,
  }))
}

/** Deterministic owner assignment for remotes that several computers can read. The computer this
 * client is using serves what it has; other remotes spread across connected computers by load.
 * A previous owner is kept while it stays connected, so refreshes do not move between computers. */
export function assignRemoteSources<
  T extends {
    key: string
    repository?: Repository
    connected: boolean
    runtimeId?: string
    readerIdentity?: string
  },
>(
  sources: readonly T[],
  options: {
    previous?: ReadonlyMap<string, string>
    /** Verified identity of the previously selected reader, indexed by remote key. */
    previousReaderIdentities?: ReadonlyMap<string, string>
    requireSameReader?: boolean
    preferredRuntimeId?: string | null
    remote?: (source: T) => string
  } = {},
): { selected: T[]; owners: Map<string, string> } {
  const remote =
    options.remote ??
    ((source: T) =>
      source.repository ? pullRepositoryKey(source.repository, source.key) : source.key)
  const groups = new Map<string, T[]>()
  for (const source of [...sources].sort((a, b) => a.key.localeCompare(b.key))) {
    const key = remote(source)
    groups.set(key, [...(groups.get(key) ?? []), source])
  }
  const owners = new Map<string, string>()
  const load = new Map<string, number>()
  const computer = (source: T) => source.runtimeId ?? source.key
  const own = (key: string, source: T) => {
    owners.set(key, source.key)
    load.set(computer(source), (load.get(computer(source)) ?? 0) + 1)
  }
  const unassigned: [string, T[]][] = []
  for (const [key, candidates] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const online = candidates.filter((candidate) => candidate.connected)
    const previous = options.previous?.get(key)
    const previousSource = candidates.find((candidate) => candidate.key === previous)
    const previousIdentity =
      options.previousReaderIdentities?.get(key) ?? previousSource?.readerIdentity
    if (options.requireSameReader && previous) {
      const eligible = candidates.filter(
        (candidate) => previousIdentity && candidate.readerIdentity === previousIdentity,
      )
      const kept =
        previousSource &&
        (!previousIdentity || previousSource.readerIdentity === previousIdentity) &&
        (previousSource.connected || !eligible.some((candidate) => candidate.connected))
          ? previousSource
          : undefined
      if (kept) own(key, kept)
      else if (eligible.some((candidate) => candidate.connected)) unassigned.push([key, eligible])
      else {
        // Keep the assignment even if its source vanished. An unknown/new account must not
        // silently inherit the view. Its caller can retain cached rows and explain availability.
        owners.set(key, previous)
      }
    } else {
      const kept = candidates.find(
        (candidate) => candidate.key === previous && (candidate.connected || !online.length),
      )
      if (kept) own(key, kept)
      else unassigned.push([key, candidates])
    }
  }
  for (const [key, candidates] of unassigned) {
    const online = candidates.filter((candidate) => candidate.connected)
    const local = online.find((candidate) => computer(candidate) === options.preferredRuntimeId)
    const chosen =
      local ??
      online.reduce<T | undefined>(
        (best, candidate) =>
          !best || (load.get(computer(candidate)) ?? 0) < (load.get(computer(best)) ?? 0)
            ? candidate
            : best,
        undefined,
      ) ??
      candidates[0]
    if (chosen) own(key, chosen)
  }
  const keys = new Set(owners.values())
  return {
    selected: sources.filter((source) => {
      if (!keys.has(source.key)) return false
      const previousIdentity = options.previousReaderIdentities?.get(remote(source))
      return (
        !options.requireSameReader ||
        !previousIdentity ||
        source.readerIdentity === previousIdentity
      )
    }),
    owners,
  }
}
