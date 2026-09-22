import type { JiraSource, RuntimeOverview, RuntimeProfile } from '@dovo/protocol'
import {
  collectionSources,
  projectContentIdentity,
  type ProjectSource,
} from '../runtime/collection-sources'

export type WorkSource =
  | (ProjectSource & { kind: 'repository' })
  | {
      kind: 'jira'
      key: string
      profile: RuntimeProfile
      jiraSource: JiraSource
      connected: boolean
    }

export const jiraSourceKey = (runtimeId: string, sourceId: string) =>
  JSON.stringify([runtimeId, 'jira', sourceId])
export const workSourceName = (source: WorkSource) =>
  source.kind === 'jira'
    ? source.jiraSource.name || source.jiraSource.project
    : source.repository.name
export const workSourceInput = (source: WorkSource) =>
  source.kind === 'jira'
    ? { jiraSourceId: source.jiraSource.id }
    : { repositoryId: source.repository.id }
export const workSourceContentIdentity = (source: WorkSource) =>
  source.kind === 'jira'
    ? JSON.stringify([
        source.key,
        source.profile.connection,
        source.jiraSource.site,
        source.jiraSource.project,
      ])
    : projectContentIdentity(source)
export const workSourceIdentity = (sources: WorkSource[]) =>
  JSON.stringify(
    sources.map((source) => [
      workSourceContentIdentity(source),
      source.connected,
      source.profile.name,
      workSourceName(source),
    ]),
  )
export function workSources(
  overviews: RuntimeOverview[],
  area: 'issues' | 'pipelines',
): WorkSource[] {
  const projects: WorkSource[] = collectionSources(overviews).map((source) => ({
    ...source,
    kind: 'repository',
  }))
  if (area === 'pipelines') return projects
  return [
    ...overviews.flatMap((entry) =>
      (entry.snapshot?.workspace.jiraSources ?? []).map((jiraSource) => ({
        kind: 'jira' as const,
        key: jiraSourceKey(entry.profile.id, jiraSource.id),
        profile: entry.profile,
        jiraSource,
        connected: entry.connected,
      })),
    ),
    ...projects,
  ]
}
export function retainWorkPages<T extends { source: WorkSource }>(
  pages: T[],
  sources: WorkSource[],
): T[] {
  const current = new Map(sources.map((source) => [source.key, source]))
  return pages.flatMap((page) => {
    const source = current.get(page.source.key)
    return source && workSourceContentIdentity(source) === workSourceContentIdentity(page.source)
      ? [{ ...page, source }]
      : []
  })
}
