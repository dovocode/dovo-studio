import type { Repository, RuntimeOverview, RuntimeProfile } from '@dovo/protocol'

export type ProjectSource = {
  key: string
  profile: RuntimeProfile
  repository: Repository
  connected: boolean
}

export const projectSourceKey = (runtimeId: string, repositoryId: string) =>
  JSON.stringify([runtimeId, repositoryId])

export function collectionSources(overviews: RuntimeOverview[]): ProjectSource[] {
  return overviews.flatMap((entry) =>
    (entry.snapshot?.workspace.repositories ?? []).map((repository) => ({
      key: projectSourceKey(entry.profile.id, repository.id),
      profile: entry.profile,
      repository,
      connected: entry.connected,
    })),
  )
}

// Live snapshots update every second. Reload collections only when their actual source changes.
export const collectionSourceIdentity = (sources: ProjectSource[]) =>
  JSON.stringify(
    sources.map(({ key, profile, repository, connected }) => ({
      key,
      connection: profile.connection,
      name: profile.name,
      connected,
      repository: {
        id: repository.id,
        path: repository.path,
        name: repository.name,
        forge: repository.forge,
        jira: repository.jira,
      },
    })),
  )

/** Connectivity and labels can change without invalidating the last loaded data. */
export const projectContentIdentity = ({ key, profile, repository }: ProjectSource) =>
  JSON.stringify([
    key,
    profile.connection.address,
    profile.connection.token,
    repository.path,
    repository.forge,
    repository.jira,
  ])

export function retainProjectPages<T extends { source: ProjectSource }>(
  pages: T[],
  sources: ProjectSource[],
): T[] {
  const current = new Map(sources.map((source) => [source.key, source]))
  return pages.flatMap((page) => {
    const source = current.get(page.source.key)
    return source && projectContentIdentity(source) === projectContentIdentity(page.source)
      ? [{ ...page, source }]
      : []
  })
}
