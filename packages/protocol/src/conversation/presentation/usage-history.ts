import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { turnSchema } from '../../workspace.js'
export const usageRecordSchema = mutableStruct({
  taskId: Schema.String,
  title: Schema.String,
  sessionId: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.Literals(['dovo', 'cli'])),
  turn: turnSchema,
})
export type UsageRecord = Schema.Schema.Type<typeof usageRecordSchema>
const rate = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
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
  transcriptNoticeSources: Schema.optional(
    Schema.Record(Schema.String, mutableArray(Schema.String)),
  ),
  pricingUpdatedAt: Schema.optional(Schema.String),
  overrides: Schema.optional(Schema.Record(Schema.String, usagePriceSchema)),
})
export type UsageHistoryResult = Schema.Schema.Type<typeof usageHistorySchema>

/** A generic warning is shared only when every directory contributing to it has been seen. */
export function mergeUsageNotices(
  entries: readonly {
    id: string
    notices: readonly string[]
    sources?: UsageHistoryResult['transcriptNoticeSources']
  }[],
) {
  const seen = new Set<string>()
  return Object.fromEntries(
    entries.map(({ id, notices, sources }) => [
      id,
      notices
        .filter((notice) => {
          const paths = sources && Object.hasOwn(sources, notice) ? sources[notice] : []
          const keys = paths.map((source) => JSON.stringify([source, notice]))
          if (!keys.length) return true
          const duplicate = keys.every((key) => seen.has(key))
          for (const key of keys) seen.add(key)
          return !duplicate
        })
        .join(' '),
    ]),
  )
}
export const usageRetentionSchema = mutableStruct({
  days: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 36500 }))),
})
export const usageStorageSchema = mutableStruct({
  ...usageRetentionSchema.fields,
  count: Schema.Number,
  oldest: Schema.NullOr(Schema.String),
  newest: Schema.NullOr(Schema.String),
})
export const usageExportCursorSchema = mutableStruct({ at: Schema.String, id: Schema.String })
export const usageExportSchema = mutableStruct({
  sourceId: Schema.String,
  records: mutableArray(usageRecordSchema),
  next: Schema.optional(usageExportCursorSchema),
})

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
