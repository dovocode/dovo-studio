import type { PullCommentStatus } from '@dovo/protocol'

/** What the editor knows about a saved draft that a press of Post already sent. */
export type LineCommentRecovery =
  | PullCommentStatus
  | { status: 'checking' }
  /** The status check failed, for example offline. Posting waits for a successful check. */
  | { status: 'check-failed' }
  /** The runtime keeps no submission records, so it cannot tell. */
  | { status: 'legacy' }

/** A status check result for one saved ID. `check` changes when the user asks to check again. */
export type LineCommentCheck = { id: string; check: number; value: LineCommentRecovery }

/**
 * The recovery state for this render. It is synchronous: a saved ID without a matching result
 * is `checking` in the same render that shows the draft, so Post is never enabled before the
 * runtime answers. `posting` is the ID that this editor is sending now, which needs no check.
 */
export function lineCommentRecoveryState(input: {
  submissionId: string | undefined
  posting: string | undefined
  receipts: boolean
  connected: boolean
  checked: LineCommentCheck | undefined
  check: number
}): LineCommentRecovery | undefined {
  const { submissionId, posting, receipts, connected, checked, check } = input
  if (!submissionId || submissionId === posting) return undefined
  if (!receipts) return { status: 'legacy' }
  if (checked?.id === submissionId && checked.check === check) return checked.value
  return connected ? { status: 'checking' } : { status: 'check-failed' }
}

/** Post works directly only when nothing was sent, or the runtime rejected the earlier ID. */
export function lineCommentRecoveryAllowsPost(recovery: LineCommentRecovery | undefined) {
  return !recovery || recovery.status === 'rejected'
}

/**
 * Outcomes that only the user can resolve, by checking the pull request. Receipts belong to one
 * paired device on one runtime database. After a renewed pairing or a restored computer,
 * `unknown` is not proof that the comment was never posted. These need **Post anyway**.
 */
export function lineCommentRecoveryNeedsChoice(recovery: LineCommentRecovery | undefined) {
  return (
    recovery?.status === 'unknown' ||
    recovery?.status === 'uncertain' ||
    recovery?.status === 'legacy'
  )
}

/**
 * A retry keeps the saved ID when the runtime has no outcome for it. If this device's receipt does
 * exist, the runtime then returns that outcome instead of posting again. A rejected or uncertain ID
 * cannot be sent again, because the runtime repeats its error. Those need a new ID.
 */
export function lineCommentRecoveryReusesId(recovery: LineCommentRecovery | undefined) {
  return recovery?.status === 'unknown' || recovery?.status === 'legacy'
}

export function lineCommentRecoveryMessage(recovery: LineCommentRecovery | undefined) {
  switch (recovery?.status) {
    case 'checking':
      return 'Checking whether this comment was already posted…'
    case 'posted':
      return 'This comment was already posted. Remove the saved copy from this phone.'
    case 'pending':
      return 'This comment is still being posted. Check again in a moment.'
    case 'unknown':
      return 'This computer has no record of this comment. A renewed pairing or a restored computer can lose that record, so it may already be posted. Check the pull request before you post it again.'
    case 'uncertain':
      return 'Dovo could not confirm whether this comment was posted. Check the pull request before you post it again.'
    case 'legacy':
      return 'This computer cannot confirm whether this comment was posted. Check the pull request before you post it again.'
    case 'check-failed':
      return 'Could not check whether this comment was posted. Check again before you post it.'
    default:
      return undefined
  }
}
