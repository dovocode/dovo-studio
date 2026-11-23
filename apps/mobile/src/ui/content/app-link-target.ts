import { resolveLinkTargets, type LinkTarget } from '@dovo/studio-core/links'
import { issueHref, jiraIssueHref, pipelineHref, pullHref } from '../../shell/source-route'
import type { RuntimeOverview, StudioLink } from '@dovo/protocol'
import type { LinkOrigin } from './link-origin'
import { taskHref } from '../../shell/task-route'

export function studioThreadHref(
  target: Extract<StudioLink, { kind: 'thread' }>,
  overviews: readonly RuntimeOverview[],
  localRuntimeId?: string | null,
) {
  const runtimeId = target.runtimeId === 'local' ? localRuntimeId : target.runtimeId
  if (!runtimeId) return undefined
  const owner = overviews.find(
    ({ profile, snapshot }) =>
      profile.id === runtimeId ||
      snapshot?.runtimeId === runtimeId ||
      profile.connection.runtimeId === runtimeId,
  )
  return owner ? taskHref(owner.profile.id, target.threadId) : undefined
}

export function linkTargetHref(target: LinkTarget) {
  if (target.kind === 'pull')
    return pullHref(target.runtimeId, target.repositoryId ?? target.url, target.number, target)
  if (target.kind === 'jira')
    return jiraIssueHref(target.runtimeId, target.jiraSourceId, target.itemId, target.url)
  return target.kind === 'pipeline'
    ? pipelineHref(target.runtimeId, target.repositoryId, target.itemId, target.url)
    : issueHref(target.runtimeId, target.repositoryId, target.itemId, target.url)
}
export function appLinkChoices(
  input: string,
  overviews: readonly RuntimeOverview[],
  origin?: LinkOrigin,
) {
  return resolveLinkTargets(input, overviews, origin).map((target) => ({
    ...target,
    href: linkTargetHref(target),
  }))
}
