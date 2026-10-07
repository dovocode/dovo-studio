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

/** A forge binding can target a different repository from the checkout's origin. */
export function pullRepositoryKey(repository: Repository, sourceKey: string) {
  return repository.pullIdentity || (!repository.forge && repository.gitIdentity) || sourceKey
}

/** One remote read per repository. Keep a stable owner until it disconnects; an explicit
 * project filter belongs before this selection so actions retain that project's account. */
export function selectPullSources<
  T extends { key: string; repository: Repository; connected: boolean },
>(sources: readonly T[]): T[] {
  const selected = new Map<string, T>()
  for (const source of [...sources].sort((a, b) => a.key.localeCompare(b.key))) {
    const key = pullRepositoryKey(source.repository, source.key)
    const previous = selected.get(key)
    if (!previous || (!previous.connected && source.connected)) selected.set(key, source)
  }
  const keys = new Set([...selected.values()].map((source) => source.key))
  return sources.filter((source) => keys.has(source.key))
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
