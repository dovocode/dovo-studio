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
  }),
)

export function recordedApprovalDecision(
  events: readonly (typeof activityEventSchema.Type)[],
  taskId: string,
  approvalId: string,
) {
  for (const event of events) {
    if (event.scope !== taskId || event.kind !== 'approval') continue
    const parsed = decodeResult(recordedDecision, event.payload)
    if (parsed.success && parsed.data.id === approvalId) return parsed.data.decision
  }
}
