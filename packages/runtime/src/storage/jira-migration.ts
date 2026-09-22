import { createHash } from 'node:crypto'
import { jiraBindingSchema, type JiraBinding, type Workspace } from '@dovo/protocol'

/** Convert old repository-scoped Jira connections without losing existing task sources. */
export function migrateJiraSources(workspace: Workspace): Workspace {
  if (!workspace.repositories.some((repository) => repository.jira)) return workspace
  const sources = [...(workspace.jiraSources ?? [])]
  const links = [...(workspace.jiraIssueLinks ?? [])]
  const legacySources = new Map<string, string>()
  const ensureSource = (jira: JiraBinding) => {
    const site = new URL(jira.site).origin
    let source = sources.find(
      (source) => new URL(source.site).origin === site && source.project === jira.project,
    )
    if (!source) {
      source = {
        id: `jira-${createHash('sha256').update(`${site}/${jira.project}`).digest('hex').slice(0, 24)}`,
        site,
        project: jira.project,
      }
      sources.push(source)
    }
    return source.id
  }
  const repositories = workspace.repositories.map((repository) => {
    if (!repository.jira) return repository
    const { jira, ...rest } = repository
    legacySources.set(repository.id, ensureSource(jira))
    return rest
  })
  const tasks = workspace.tasks.map((task) => {
    let sourceId = legacySources.get(task.repositoryId)
    if (!sourceId || task.workItem?.kind !== 'issue' || task.workItem.provider !== 'jira')
      return task
    // A repository may have switched Jira namespaces after the task was created.
    // Its original issue URL, rather than today's binding, identifies that history.
    const issueUrl = new URL(task.workItem.url)
    const binding = jiraBindingSchema.safeParse({
      site: issueUrl.origin,
      project: /^(.+)-\d+$/.exec(task.workItem.id)?.[1],
    })
    if (binding.success && issueUrl.pathname === `/browse/${task.workItem.id}`)
      sourceId = ensureSource(binding.data)
    const workItem = { ...task.workItem, jiraSourceId: task.workItem.jiraSourceId ?? sourceId }
    if (
      !links.some((link) => link.sourceId === workItem.jiraSourceId && link.issueId === workItem.id)
    )
      links.push({
        sourceId: workItem.jiraSourceId,
        issueId: workItem.id,
        repositoryId: task.repositoryId,
      })
    return { ...task, workItem }
  })
  return { ...workspace, repositories, tasks, jiraSources: sources, jiraIssueLinks: links }
}
