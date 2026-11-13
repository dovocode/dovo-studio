import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct, refine, strictStruct } from '../shared/schema.js'
import { taskSchema, turnSettingsSchema } from '../workspace.js'
import { startsCleanDraft } from './task-message.js'
import {
  automationPrepareCommandFields,
  automationListCommandFields,
  threadActionSchema,
  threadPrepareCommandSchema,
  responsePrepareCommandFields,
  responseDispatchSchema,
} from './thread-actions.js'

const id = maxValue(minValue(Schema.String, 1), 200)

export const threadPrepareRequestSchema = strictStruct({
  taskId: id,
  parentRunId: id,
  command: Schema.Union([
    strictStruct({ ...responsePrepareCommandFields, kind: Schema.Literal('response') }),
    strictStruct({ ...automationListCommandFields, kind: Schema.Literal('list-automations') }),
    strictStruct({
      ...automationPrepareCommandFields,
      kind: Schema.Literal('automation'),
    }),
    threadPrepareCommandSchema,
  ]),
})

/** `POST /api/thread-actions/send`, paired human clients only.
 *
 * `createTask` is a thread-start draft (same rules as `/api/tasks/message` `createTask`) in the
 * source thread's project. `text` is the edited prompt; `messageId` is its message id. Keep
 * the whole body for retries after a lost response. Once an action is sent, every later
 * request returns that sent action and starts nothing. */
export const threadActionSendSchema = refine(
  strictStruct({
    sourceTaskId: id,
    actionId: id,
    messageId: id,
    createTask: taskSchema,
    text: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120000),
    turnSettings: Schema.optional(turnSettingsSchema),
  }),
  (input) =>
    startsCleanDraft(input.createTask) &&
    input.createTask.id !== input.sourceTaskId &&
    !input.createTask.linkedCheckouts?.length,
  'An action starts a new empty draft without linked projects or runtime state',
)
export type ThreadActionSend = Schema.Schema.Type<typeof threadActionSendSchema>
/** `POST /api/thread-actions/dismiss`, paired human clients only. A sent action stays sent. */
export const threadActionDismissSchema = strictStruct({ sourceTaskId: id, actionId: id })
export type ThreadActionDismiss = Schema.Schema.Type<typeof threadActionDismissSchema>
/** Same cursor meaning as thread-start acknowledgements. */
export const threadActionResultSchema = mutableStruct({
  action: threadActionSchema,
  revision: Schema.Number,
  runtimeInstanceId: Schema.String,
})
export type ThreadActionResult = Schema.Schema.Type<typeof threadActionResultSchema>

/** Paired human confirmation of the exact reviewed automation revision. */
export const automationActionSendSchema = strictStruct({
  sourceTaskId: id,
  actionId: id,
  revision: id,
  text: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000),
})
export type AutomationActionSend = Schema.Schema.Type<typeof automationActionSendSchema>
export const threadActionReviewSchema = strictStruct({
  sourceTaskId: id,
  actionId: id,
  dispatch: Schema.optional(responseDispatchSchema),
})
export type ThreadActionReview = Schema.Schema.Type<typeof threadActionReviewSchema>

/** Exact reviewed action; no arbitrary target thread, command or tool can be injected at Run. */
export const responseActionSendSchema = strictStruct({
  sourceTaskId: id,
  actionId: id,
  response: Schema.Literal(true),
  revision: id,
  messageId: id,
  text: Schema.optional(
    maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000),
  ),
})
export type ResponseActionSend = typeof responseActionSendSchema.Type
