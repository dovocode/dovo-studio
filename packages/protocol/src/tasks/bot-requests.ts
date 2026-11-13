import { Schema } from 'effect'
import {
  maxValue,
  minValue,
  mutableStruct,
  refine,
  strictStruct,
  uuidSchema,
} from '../shared/schema.js'
import { taskSchema } from '../workspace.js'
import { startsCleanDraft } from './task-message.js'
import { botResourcesSchema, botResponsibilitiesSchema, botRoleSchema, botSchema } from './bots.js'

const id = maxValue(minValue(Schema.String, 1), 200)

/** `createTask` uses the thread-start draft shape. A retry with the same request returns the
 * original Bot; another body for the same thread id is rejected. */
export const botCreateSchema = refine(
  strictStruct({
    requestId: uuidSchema,
    createTask: taskSchema,
    role: botRoleSchema,
    responsibilities: botResponsibilitiesSchema,
  }),
  (input) => startsCleanDraft(input.createTask),
  'A Bot starts from a new empty draft without runtime state',
)
export type BotCreate = Schema.Schema.Type<typeof botCreateSchema>
export const botUpdateSchema = strictStruct({
  id,
  expectedRevision: uuidSchema,
  role: Schema.optional(botRoleSchema),
  responsibilities: Schema.optional(botResponsibilitiesSchema),
  /** Replaces this Bot's own resources. Stored-secret references keep saved values. */
  resources: Schema.optional(botResourcesSchema),
})
export type BotUpdate = Schema.Schema.Type<typeof botUpdateSchema>
export const botLifecycleSchema = strictStruct({
  id,
  action: Schema.Literals(['pause', 'resume']),
  /** Omit only to act on the current state; a stale revision returns 409. */
  expectedRevision: Schema.optional(uuidSchema),
})
export type BotLifecycle = Schema.Schema.Type<typeof botLifecycleSchema>
/** `revision` and `runtimeInstanceId` match thread-start acknowledgements: a snapshot of
 * that runtime instance at `revision` or later contains this Bot state. */
export const botResultSchema = mutableStruct({
  id,
  bot: botSchema,
  revision: Schema.Number,
  runtimeInstanceId: Schema.String,
})
export type BotResult = Schema.Schema.Type<typeof botResultSchema>
