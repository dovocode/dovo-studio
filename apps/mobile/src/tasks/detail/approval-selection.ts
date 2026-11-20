import { Schema } from 'effect'
import {
  activityEventSchema,
  approvalDecisionSchema,
  decodeResult,
  mutableStruct,
} from '@dovo/protocol'

/** An exact request link must never select a replacement request. */
export function selectTaskApprovals<T extends { id: string }>(
  visible: readonly T[],
  approvalId?: string,
): readonly T[] {
  return approvalId ? visible.filter((item) => item.id === approvalId) : visible
}

const recordedDecision = Schema.fromJsonString(
  mutableStruct({
    id: Schema.String,
    status: Schema.Literal('resolved'),
    decision: approvalDecisionSchema,
    /** Set when the request ended without a user decision, for example `withdrawn`. A newer
     * runtime can add other reasons. Older runtimes omit it. */
    reason: Schema.optional(Schema.String),
  }),
)

const endings = ['withdrawn', 'expired', 'access-changed', 'cancelled'] as const
type ApprovalEnding = (typeof endings)[number]
const isEnding = (reason: string): reason is ApprovalEnding =>
  endings.some((ending) => ending === reason)

export type RecordedApprovalOutcome =
  | { decision: typeof approvalDecisionSchema.Type }
  | { ended: ApprovalEnding | 'other' }

/**
 * The recorded outcome of one exact approval in the visible thread family. The runtime records an
 * approval under the thread that asked, which can be a child of the open thread.
 */
export function recordedApprovalOutcome(
  events: readonly (typeof activityEventSchema.Type)[],
  family: ReadonlySet<string>,
  approvalId: string,
): RecordedApprovalOutcome | undefined {
  for (const event of events) {
    if (!family.has(event.scope) || event.kind !== 'approval') continue
    const parsed = decodeResult(recordedDecision, event.payload)
    if (!parsed.success || parsed.data.id !== approvalId) continue
    const { reason, decision } = parsed.data
    if (reason === undefined || reason === 'decided') return { decision }
    return { ended: isEnding(reason) ? reason : 'other' }
  }
}
