import { Schema } from 'effect'
import { mutableStruct, mutableArray, maxValue, minValue, refine } from '../shared/schema.js'
import { connectServiceOriginSchema } from '../auth/service-urls.js'
export const pushDeliveryTokenSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
)
const text = (limit: number) => maxValue(minValue(Schema.String, 1), limit)
export const pushRegistrationSchema = refine(
  mutableStruct({
    runtimeId: text(200),
    platform: Schema.Literals(['ios', 'android']),
    token: text(4096),
    environment: Schema.Literals(['sandbox', 'production']),
    managedToken: Schema.optional(pushDeliveryTokenSchema),
    managedOrigin: Schema.optional(connectServiceOriginSchema),
    questionActions: Schema.optional(Schema.Literal(1)),
  }),
  (value) => value.platform !== 'ios' || /^[a-fA-F0-9]{32,512}$/.test(value.token),
  'Invalid Apple push token',
)
export const pushStatusSchema = mutableStruct({
  configured: Schema.Boolean,
  registered: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
})
export const relayNotificationSchema = mutableStruct({
  platform: Schema.Literals(['ios', 'android']),
  token: text(4096),
  environment: Schema.Literals(['sandbox', 'production']),
  id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  title: text(160),
  body: text(600),
  data: mutableStruct({
    runtimeId: text(200),
    taskId: text(200),
    kind: Schema.Literals(['input', 'done', 'failed', 'checks-passed', 'checks-failed']),
    turnId: Schema.optional(text(200)),
    inputId: Schema.optional(text(200)),
    inputType: Schema.optional(Schema.Literals(['question', 'approval'])),
    /** Bounded JSON; FCM data values must be strings. Never includes credentials. */
    question: Schema.optional(text(1600)),
    project: Schema.optional(maxValue(Schema.String, 200)),
  }),
})
export const relayResultSchema = mutableStruct({
  delivered: Schema.Boolean,
  invalidToken: Schema.Boolean,
})
export type PushRegistration = Schema.Schema.Type<typeof pushRegistrationSchema>
export type RelayNotification = Schema.Schema.Type<typeof relayNotificationSchema>

export const managedPushSubscriptionSchema = mutableStruct({
  runtimeId: text(200),
  platform: Schema.Literals(['ios', 'android']),
  token: text(4096),
  environment: Schema.Literals(['sandbox', 'production']),
})
export const managedPushGrantSchema = mutableStruct({ token: pushDeliveryTokenSchema })
export type ManagedPushSubscription = typeof managedPushSubscriptionSchema.Type

export const managedPushServersSchema = mutableStruct({
  runtimeIds: mutableArray(text(200)).pipe(Schema.check(Schema.isMaxLength(100))),
})
