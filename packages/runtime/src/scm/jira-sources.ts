import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { forgeIssueDetailSchema, jiraSourceSchema } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { Services } from '../services.js'
import { JiraWork } from './jira.js'

export async function saveJiraSource(s: Services, value: unknown) {
  const { source: input } = z
    .object({ source: jiraSourceSchema.partial({ id: true }) })
    .parse(value)
  const site = new URL(input.site).origin
  const existing = input.id
    ? s.store.get().jiraSources?.find((source) => source.id === input.id)
    : undefined
  if (input.id && !existing) throw new HttpError(404, 'Jira source not found')
  if (existing && (new URL(existing.site).origin !== site || existing.project !== input.project))
    throw new HttpError(409, 'Add a new Jira source to change its site or Jira project.')
  const source = { ...input, site, id: existing?.id ?? randomUUID() }
  await new JiraWork(s.commands.get().acli, source, undefined, homedir()).verify()
  if (
    existing &&
    !isDeepStrictEqual(
      existing,
      s.store.get().jiraSources?.find((item) => item.id === existing.id),
    )
  )
    throw new HttpError(409, 'This Jira source changed. Refresh before continuing.')
  const duplicate = s.store
    .get()
    .jiraSources?.find(
      (item) => new URL(item.site).origin === site && item.project === source.project,
    )
  if (!existing && duplicate) return duplicate
  s.store.update((workspace) => ({
    ...workspace,
    jiraSources: [...(workspace.jiraSources ?? []).filter((item) => item.id !== source.id), source],
  }))
  return source
}

export function removeJiraSource(s: Services, value: unknown) {
  const { sourceId } = z.object({ sourceId: jiraSourceSchema.shape.id }).parse(value)
  s.store.update((workspace) => ({
    ...workspace,
    jiraSources: workspace.jiraSources?.filter((source) => source.id !== sourceId),
    jiraIssueLinks: workspace.jiraIssueLinks?.filter((link) => link.sourceId !== sourceId),
  }))
  return { ok: true }
}

export async function linkJiraIssue(s: Services, value: unknown) {
  const input = z
    .object({
      sourceId: jiraSourceSchema.shape.id,
      issueId: z.string().min(1).max(300),
      repositoryId: z.string().min(1).max(200).nullable(),
    })
    .parse(value)
  const source = s.store.get().jiraSources?.find((item) => item.id === input.sourceId)
  if (!source) throw new HttpError(404, 'Jira source not found')
  const repository = input.repositoryId
    ? s.store.get().repositories.find((item) => item.id === input.repositoryId)
    : undefined
  if (input.repositoryId && !repository) throw new HttpError(404, 'Project not found')
  const detail = forgeIssueDetailSchema.parse(
    await s.forgeWork.requestJira(source.id, 'issues/detail', { id: input.issueId, refresh: true }),
  )
  if (detail.stale || detail.refreshError)
    throw new HttpError(409, 'Refresh this issue before changing its project link.')
  if (detail.issue.id !== input.issueId)
    throw new HttpError(409, 'Jira returned a different issue. Refresh before continuing.')
  if (
    !isDeepStrictEqual(
      source,
      s.store.get().jiraSources?.find((item) => item.id === source.id),
    ) ||
    (repository &&
      !isDeepStrictEqual(
        repository,
        s.store.get().repositories.find((item) => item.id === repository.id),
      ))
  )
    throw new HttpError(
      409,
      'The source or destination project changed. Refresh before continuing.',
    )
  s.store.update((workspace) => ({
    ...workspace,
    jiraIssueLinks: [
      ...(workspace.jiraIssueLinks ?? []).filter(
        (link) => link.sourceId !== source.id || link.issueId !== input.issueId,
      ),
      ...(input.repositoryId
        ? [{ sourceId: source.id, issueId: input.issueId, repositoryId: input.repositoryId }]
        : []),
    ],
  }))
  return { ok: true }
}
