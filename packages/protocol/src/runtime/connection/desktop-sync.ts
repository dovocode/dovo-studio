import { Schema } from 'effect'
import {
  decodeResult,
  mutableArray,
  mutableStruct,
  minValue,
  maxValue,
} from '../../shared/schema.js'
import { connectionSchema, type RuntimeSnapshot, type RuntimeConnection } from './runtime.js'
import type { activitySchema } from '../../automation/activity.js'
import type { RuntimeSyncStatus } from './live-sync.js'
import type { SnapshotDelta } from './sync.js'
const id = maxValue(minValue(Schema.String, 1), 300)
export const desktopSyncSubscriptionSchema = mutableStruct({
  id,
  connection: connectionSchema,
  tasks: maxValue(mutableArray(id), 8),
  settledLimit: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 100000 })),
    ),
  ),
  scopes: maxValue(mutableArray(id), 8),
  detailScopes: maxValue(mutableArray(id), 8),
})
export type DesktopSyncSubscription = typeof desktopSyncSubscriptionSchema.Type
export type DesktopSyncEvent =
  | { type: 'snapshot'; snapshot: RuntimeSnapshot; tag?: string; epoch?: string; sequence?: number }
  | {
      type: 'delta'
      delta: SnapshotDelta
      epoch: string
      base: number
      sequence: number
      tag?: string
    }
  | { type: 'status'; status: RuntimeSyncStatus; online: boolean }
  | { type: 'activity'; scope: string; events: (typeof activitySchema.Type)['events'] }
  | { type: 'error'; message: string }
  | { type: 'connection'; connection: RuntimeConnection }
export type DesktopRuntimeSyncBridge = {
  subscribe: (
    input: DesktopSyncSubscription,
    listener: (event: DesktopSyncEvent) => void,
  ) => () => void
  update: (input: DesktopSyncSubscription) => void
  refresh: (id: string, retry: boolean) => void
}
const bridgeSchema = mutableStruct({
  dovo: mutableStruct({
    runtimeSync: Schema.Unknown.pipe(
      Schema.refine(
        (value): value is DesktopRuntimeSyncBridge =>
          typeof value === 'object' &&
          value !== null &&
          'subscribe' in value &&
          typeof value.subscribe === 'function' &&
          'update' in value &&
          typeof value.update === 'function' &&
          'refresh' in value &&
          typeof value.refresh === 'function',
      ),
    ),
  }),
})
export function desktopRuntimeSyncBridge() {
  if (typeof window === 'undefined') return undefined
  const result = decodeResult(bridgeSchema, window)
  return result.success ? result.data.dovo.runtimeSync : undefined
}
