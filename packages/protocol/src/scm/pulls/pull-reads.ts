import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'
import {
  pullDetailSchema,
  pullPageSchema,
  type PullDetail,
  type PullDetailSection,
} from './pulls.js'

export const pullReadVersionSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const unchanged = mutableStruct({
  unchanged: Schema.Literal(true),
  readVersion: pullReadVersionSchema,
})
export const pullPageReadSchema = Schema.Union([
  unchanged,
  mutableStruct({ ...pullPageSchema.fields, readVersion: Schema.optional(pullReadVersionSchema) }),
])
export const pullDetailReadSchema = Schema.Union([
  unchanged,
  mutableStruct({
    ...pullDetailSchema.fields,
    readVersion: Schema.optional(pullReadVersionSchema),
  }),
])

/** Check running work often; settled reports and descriptions need fewer reads. */
export function pullSectionInterval(section: PullDetailSection, detail: PullDetail | null) {
  if (detail?.refreshError) return 60_000
  // The runtime can return a saved description while its background read completes.
  if (detail?.stale) return 2_000
  if (section === 'overview' || section === 'stack' || section === 'changes') return 60_000
  if (section === 'discussion') return 30_000
  if (!detail || detail.pull.state !== 'open') return 60_000
  const pending = /PENDING|EXPECTED|RUNNING|IN_PROGRESS|QUEUED|WAITING|REQUESTED/i
  const active =
    section === 'status'
      ? pending.test(detail.pull.checksState ?? '')
      : detail.checks.some((check) => pending.test(check.status))
  return active ? 10_000 : 30_000
}
