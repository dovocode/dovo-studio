import type { Task } from '@dovo/studio-core'

export function taskPullLinks(task: Pick<Task, 'pullRequest' | 'linkedPullRequests'>) {
  const links = new Map<string, NonNullable<Task['linkedPullRequests']>[number]>()
  if (task.pullRequest)
    links.set(task.pullRequest.url, { ...task.pullRequest, title: 'Source pull request' })
  for (const pull of task.linkedPullRequests ?? []) {
    if (!links.has(pull.url)) links.set(pull.url, pull)
  }
  return [...links.values()]
}

export { pullReference, verifyPullUrl } from '@dovo/protocol'
