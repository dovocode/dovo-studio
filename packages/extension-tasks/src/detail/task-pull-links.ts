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

export function pullReference(input: string): { number: number; url?: string } {
  const text = input.trim()
  if (/^#?\d+$/.test(text)) {
    const number = Number(text.replace('#', ''))
    if (Number.isSafeInteger(number) && number > 0) return { number }
  }
  try {
    const url = new URL(text)
    const match = url.pathname.match(/\/(?:pull|pulls|pull-requests|pullrequest)\/(\d+)\/?$/i)
    const number = Number(match?.[1])
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      Number.isSafeInteger(number) &&
      number > 0
    ) {
      url.hash = ''
      url.search = ''
      return { number, url: url.href.replace(/\/$/, '') }
    }
  } catch {
    // Fall through to the same actionable validation message for malformed URLs.
  }
  throw new Error('Enter a PR number or a full pull request URL.')
}

export function verifyPullUrl(input: string | undefined, actual: string) {
  if (!input) return
  const url = new URL(actual)
  url.hash = ''
  url.search = ''
  if (input !== url.href.replace(/\/$/, ''))
    throw new Error('That PR belongs to a different project. Use a PR from this task’s project.')
}
