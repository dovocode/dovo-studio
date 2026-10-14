import type { PullDetail } from '@dovo/protocol'

export type PullTab = 'overview' | 'changes' | 'discussion' | 'checks'
export function pullFragment(commentUrl: string) {
  try {
    return new URL(commentUrl).hash
  } catch {
    return ''
  }
}

/** Resolve against returned provider data, never invent an anchor or a file. */
export function pullDestination(
  detail: Pick<PullDetail, 'comments'>,
  tab: PullTab,
  fragment: string,
) {
  const comment = fragment
    ? detail.comments.find((item) => pullFragment(item.url) === fragment)
    : undefined
  return {
    tab: comment ? (comment.kind === 'inline' ? 'changes' : 'discussion') : tab,
    path: comment?.kind === 'inline' ? comment.path : undefined,
    comment,
  }
}
