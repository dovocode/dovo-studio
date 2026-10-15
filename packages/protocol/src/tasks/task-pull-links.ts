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
