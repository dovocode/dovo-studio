import type { Task } from '../workspace.js'

/** Source and linked PRs belong to the thread, independent of watcher state. */
export function taskPullLinks(
  task: Pick<Task, 'pullRequest' | 'linkedPullRequests'> &
    Partial<Pick<Task, 'pullStatus' | 'pullStatuses'>>,
) {
  const links = new Map<string, NonNullable<Task['linkedPullRequests']>[number]>()
  if (task.pullRequest)
    links.set(task.pullRequest.url, { ...task.pullRequest, title: 'Source pull request' })
  for (const pull of task.linkedPullRequests ?? [])
    if (!links.has(pull.url)) links.set(pull.url, pull)
  return [...links.values()].map((pull) => ({
    ...pull,
    title: taskPullStatusFor(task, pull.url)?.title || pull.title,
  }))
}

/** Primary and additional PR metadata share one lookup across list and detail views. */
export function taskPullStatusFor(
  task: Partial<Pick<Task, 'pullStatus' | 'pullStatuses'>>,
  url: string,
) {
  const cached = task.pullStatuses?.find((status) => status.url === url)
  const primary = task.pullStatus?.url === url ? task.pullStatus : undefined
  if (!primary) return cached
  if (!cached) return primary
  const newest = Date.parse(cached.checkedAt) > Date.parse(primary.checkedAt) ? cached : primary
  return {
    ...primary,
    ...newest,
    stack: primary.stack,
    title: newest.title || primary.title || cached.title,
  }
}

function pullLinkIdentity(value: string) {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return undefined
    const path = parsed.pathname.replace(/\/$/, '')
    return `${parsed.host.toLowerCase()}${parsed.hostname === 'github.com' ? path.toLowerCase() : path}`
  } catch {
    return undefined
  }
}
const sourceIdentities = new WeakMap<NonNullable<Task['pullRequest']>, string | undefined>()
const linkedIdentities = new WeakMap<NonNullable<Task['linkedPullRequests']>, Set<string>>()
/** Reverse links need only associations, not status enrichment. Their immutable fields survive
 * message streaming, so parse each association once without retaining released threads. */
export function pullLinkedTasks<
  T extends Pick<Task, 'pullRequest' | 'linkedPullRequests' | 'example'>,
>(tasks: readonly T[], url: string): T[] {
  const target = pullLinkIdentity(url)
  if (!target) return []
  return tasks.filter((task) => {
    if (task.example) return false
    if (task.pullRequest) {
      if (!sourceIdentities.has(task.pullRequest))
        sourceIdentities.set(task.pullRequest, pullLinkIdentity(task.pullRequest.url))
      if (sourceIdentities.get(task.pullRequest) === target) return true
    }
    const links = task.linkedPullRequests
    if (!links) return false
    let identities = linkedIdentities.get(links)
    if (!identities) {
      identities = new Set(
        links.flatMap((link) => {
          const identity = pullLinkIdentity(link.url)
          return identity ? [identity] : []
        }),
      )
      linkedIdentities.set(links, identities)
    }
    return identities.has(target)
  })
}
