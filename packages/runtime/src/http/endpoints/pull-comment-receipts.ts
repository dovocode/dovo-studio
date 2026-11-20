import { decodeResult, pullLineCommentResponse, type PullCommentStatus } from '@dovo/protocol'
import type { MutationReceipts } from '../../storage/mutation-receipts.js'

/** Kept apart from mutation journal IDs, which the client acknowledges and retires. */
export const pullCommentReceiptId = (submissionId: string) => `pull-comment:${submissionId}`

/** Reports one Post press without repeating it. */
export function pullCommentStatus(
  receipt: ReturnType<MutationReceipts['status']>,
): PullCommentStatus {
  if (receipt.status === 'succeeded') {
    const posted = decodeResult(pullLineCommentResponse, receipt.value)
    return posted.success ? { status: 'posted', url: posted.data.url } : { status: 'uncertain' }
  }
  if (receipt.status === 'rejected') return { status: 'rejected', error: receipt.error }
  return { status: receipt.status }
}
