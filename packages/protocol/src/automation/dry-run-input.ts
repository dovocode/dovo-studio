import { Schema } from 'effect'
import { isoDateTime, maxValue, minValue, mutableStruct } from '../shared/schema.js'

// Schema leaves only: the agent tool bridge imports these without the dry-run logic.

/** Sample trigger data for a dry run. Absent fields use generated defaults. */
export const automationDryRunInputSchema = mutableStruct({
  /** Webhook body or GitHub event, as a real delivery would pass it to the steps. */
  payload: Schema.optional(Schema.Unknown),
  /** Due time for a schedule or one-time trigger. */
  scheduledFor: Schema.optional(isoDateTime(Schema.String)),
  /** Content of the monitored source. */
  sourceText: Schema.optional(maxValue(Schema.String, 64 * 1024)),
  /** Treat the monitored source as unchanged since the last successful run. */
  sourceUnchanged: Schema.optional(Schema.Boolean),
  /** JSON object mapping task step IDs to sample results. */
  stepResults: Schema.optional(maxValue(Schema.String, 16 * 1024)),
})
export type AutomationDryRunInput = typeof automationDryRunInputSchema.Type

/** Simulate a failed task or a rejected review at this step. Later steps are not reached. */
export const automationDryRunStopAtSchema = maxValue(minValue(Schema.String, 1), 200)
