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

/** Reverse links use explicit thread associations, never coincidental branch names or PR numbers. */
export function pullLinkedTasks<
  T extends Pick<Task, 'pullRequest' | 'linkedPullRequests' | 'example'>,
>(tasks: readonly T[], url: string): T[] {
  const identity = (value: string) => {
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
  const target = identity(url)
  if (!target) return []
  return tasks.filter(
    (task) => !task.example && taskPullLinks(task).some((pull) => identity(pull.url) === target),
  )
}
