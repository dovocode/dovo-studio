import type { PullComment } from './pulls.js'
/** Only inline review threads collapse. General comments and review decisions stay visible. */
export function pullDiscussionGroups(comments: readonly PullComment[]) {
  const groups = new Map<string, { key: string; comments: PullComment[]; resolved: boolean }>()
  const roots = new Map(comments.map((comment) => [comment.id, comment]))
  const root = (comment: PullComment) => {
    const seen = new Set<string>()
    let current = comment
    while (current.replyTo && !seen.has(current.id)) {
      seen.add(current.id)
      const parent = roots.get(current.replyTo)
      if (!parent) return current.replyTo
      current = parent
    }
    return current.id
  }
  for (const comment of comments) {
    const key =
      comment.kind === 'inline'
        ? `thread:${comment.threadId ?? root(comment)}`
        : `comment:${comment.id}`
    const group = groups.get(key) ?? { key, comments: [], resolved: true }
    group.comments.push(comment)
    group.resolved &&= comment.kind === 'inline' && comment.resolved === true
    groups.set(key, group)
  }
  return [...groups.values()]
}
