import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { turnSchema } from '../../workspace.js'
export const usageRecordSchema = mutableStruct({
  taskId: Schema.String,
  title: Schema.String,
  sessionId: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.Literal('dovo', 'cli')),
  turn: turnSchema,
})
export type UsageRecord = Schema.Schema.Type<typeof usageRecordSchema>
const rate = Schema.Number.pipe(Schema.finite(), Schema.nonNegative())
export const usagePriceSchema = mutableStruct({
  input: rate,
  output: rate,
  cacheRead: rate,
  cacheWrite: rate,
})
export type UsagePrice = Schema.Schema.Type<typeof usagePriceSchema>
export const usageHistorySchema = mutableStruct({
  sourceId: Schema.String,
  records: mutableArray(usageRecordSchema),
  notices: mutableArray(Schema.String),
  pricingUpdatedAt: Schema.optional(Schema.String),
  overrides: Schema.optional(Schema.Record({ key: Schema.String, value: usagePriceSchema })),
})
export type UsageHistoryResult = Schema.Schema.Type<typeof usageHistorySchema>

/** Blank cache prices use the input price; zero is a valid explicit price. */
export function usagePriceInput(
  values: Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', string>,
): UsagePrice | undefined {
  const number = (value: string) => Number(value.trim().replace(',', '.'))
  if (!values.input.trim() || !values.output.trim()) return undefined
  const input = number(values.input),
    output = number(values.output)
  const cacheRead = values.cacheRead.trim() ? number(values.cacheRead) : input
  const cacheWrite = values.cacheWrite.trim() ? number(values.cacheWrite) : input
  return [input, output, cacheRead, cacheWrite].every(
    (value) => Number.isFinite(value) && value >= 0,
  )
    ? { input, output, cacheRead, cacheWrite }
    : undefined
}
