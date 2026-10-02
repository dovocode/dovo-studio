import { Schema } from 'effect'
import { mutableStruct, maxValue, minValue, refine } from '../shared/schema.js'
const text = (limit: number) => maxValue(minValue(Schema.String, 1), limit)
export const pushRegistrationSchema = refine(
  mutableStruct({
    runtimeId: text(200),
    platform: Schema.Literal('ios', 'android'),
    token: text(4096),
    environment: Schema.Literal('sandbox', 'production'),
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
  platform: Schema.Literal('ios', 'android'),
  token: text(4096),
  environment: Schema.Literal('sandbox', 'production'),
  id: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  title: text(160),
  body: text(600),
  data: mutableStruct({
    runtimeId: text(200),
    taskId: text(200),
    kind: Schema.Literal('input', 'done', 'failed', 'checks-passed', 'checks-failed'),
    inputId: Schema.optional(text(200)),
    inputType: Schema.optional(Schema.Literal('question', 'approval')),
    project: Schema.optional(maxValue(Schema.String, 200)),
  }),
})
export const relayResultSchema = mutableStruct({
  delivered: Schema.Boolean,
  invalidToken: Schema.Boolean,
})
export type PushRegistration = Schema.Schema.Type<typeof pushRegistrationSchema>
export type RelayNotification = Schema.Schema.Type<typeof relayNotificationSchema>
