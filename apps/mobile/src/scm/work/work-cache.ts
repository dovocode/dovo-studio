import type { JiraSource, Repository } from '@dovo/protocol'

// The RuntimeReadCache already separates computers and credentials. Project identity must
// also include its checkout and integration bindings so changing a provider cannot reuse data.
export function workCacheKey(
  repository: Pick<Repository, 'id' | 'path' | 'forge' | 'jira'> | JiraSource | undefined,
  area: 'issues' | 'pipelines',
  kind: 'options' | 'list' | 'detail',
  query: { id?: string; state?: string; cursor?: string; query?: string } = {},
) {
  if (repository && 'site' in repository)
    return JSON.stringify([
      'jira-work',
      repository.id,
      repository.site,
      repository.project,
      area,
      kind,
      query.id,
      query.state,
      query.cursor,
      query.query?.trim() || undefined,
    ])
  return JSON.stringify([
    'work',
    repository?.id,
    repository?.path,
    repository?.forge,
    repository?.jira,
    area,
    kind,
    query.id,
    query.state,
    query.cursor,
    ...(query.query?.trim() ? [query.query.trim()] : []),
  ])
}

export function assertWorkSource(
  area: 'issues' | 'pipelines',
  actualURL: string,
  expectedURL?: string,
) {
  if (expectedURL && actualURL !== expectedURL)
    throw new Error(
      `This project now points to a different ${area === 'issues' ? 'issue' : 'pipeline'} source. Open the original source on its server.`,
    )
}
