import { Schema } from 'effect'
import { isoDateTime, maxValue, mutableStruct } from '../shared/schema.js'

/** Computer-wide limit, in USD, on estimated cost of work that runs without a new owner message.
 * The runtime measures it per thread family: a top-level thread or Bot with the child agents and
 * Bot workers it started. Off when null. */
export const unattendedSpendLimitSchema = maxValue(
  Schema.Number.pipe(Schema.check(Schema.isFinite()), Schema.check(Schema.isGreaterThan(0))),
  10000,
)

const amount = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)

/** Runtime-owned. Present while new unattended work of this thread waits for Continue or a new
 * owner message. A running turn is never interrupted. */
export const spendPauseSchema = mutableStruct({
  /** Estimated cost of priced turns in the family since the last owner message or Continue. */
  spentUsd: amount,
  /** Finished turns without a price. Their cost is unknown, so any of them holds work. */
  unpricedTurns: amount.pipe(Schema.check(Schema.isInt())),
  limitUsd: unattendedSpendLimitSchema,
  at: isoDateTime(Schema.String),
})
export type SpendPause = Schema.Schema.Type<typeof spendPauseSchema>

/** Amounts in the limit setting and the spend pause. */
export const formatSpendUsd = (value: number) => `$${value.toFixed(2)}`

/** Settings input: the limit in USD, or undefined when the text is not a valid amount. A blank
 * field is not valid. Turning the limit off is a separate, explicit action. */
export function unattendedSpendLimitInput(text: string): number | undefined {
  const trimmed = text.trim().replace(/^\$/, '')
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Schema.is(unattendedSpendLimitSchema)(value) ? value : undefined
}
