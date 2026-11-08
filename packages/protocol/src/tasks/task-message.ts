import { Effect, Schema } from 'effect'
import { maxValue, minValue, mutableStruct, refine } from '../shared/schema.js'
import { attachmentIdsSchema } from '../shared/attachments.js'
import { turnSettingsSchema } from '../workspace.js'

const id = maxValue(minValue(Schema.String, 1), 200)
/** One durable submission, including first-message setup on runtimes that advertise it. */
export const taskMessageSchema = refine(
  mutableStruct({
    id,
    messageId: id,
    text: maxValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 120000),
    attachmentIds: attachmentIdsSchema.pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
    turnSettings: Schema.optional(turnSettingsSchema),
    review: Schema.optional(Schema.Boolean),
    plan: Schema.optional(Schema.Boolean),
    queueOnly: Schema.optional(Schema.Boolean),
    preserveQueuePause: Schema.optional(Schema.Boolean),
    sendNow: Schema.optional(Schema.Boolean),
    runId: Schema.optional(id),
    selectProject: Schema.optional(Schema.Boolean),
    initialTitle: Schema.optional(
      mutableStruct({
        before: Schema.String,
        after: maxValue(minValue(Schema.String, 1), 80),
      }),
    ),
  }),
  (input) => !!input.text || !!input.attachmentIds.length,
  'Add a message or attachment',
)
