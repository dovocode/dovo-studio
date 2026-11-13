import { Schema } from 'effect'
import { isoDateTime, maxValue, minValue, mutableStruct, strictStruct } from '../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const provider = Schema.Literals([
  'codex',
  'opencode',
  'claude',
  'vibe',
  'hermes',
  'copilot',
  'grok',
  'muse',
  'cursor',
  'pi',
  'acp',
])

/** What an agent proposes. The person sending the action can change all of it. */
export const threadActionSuggestionSchema = mutableStruct({
  provider: Schema.optional(provider),
  model: Schema.optional(maxValue(minValue(Schema.String, 1), 500)),
  reasoning: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  agentId: Schema.optional(id),
})
export type ThreadActionSuggestion = Schema.Schema.Type<typeof threadActionSuggestionSchema>

/** A prepared "start a new agent thread" action. An agent creates it with the dovo_task
 * `thread_prepare` tool; nothing runs until a person reviews it and taps Send from a paired
 * client. Runtime-owned: workspace create/PATCH cannot add or change it. */
export const threadActionSchema = mutableStruct({
  /** Stable across retries of the same `key` in the same thread. */
  id,
  /** The agent's stable key. Preparing the same key again replaces the unsent action. */
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String, 1), 120),
  prompt: maxValue(minValue(Schema.String, 1), 20000),
  suggestion: Schema.optional(threadActionSuggestionSchema),
  /** The run that prepared it. Clients show the card after the last message with this
   * `turnId`, or at the end of the thread when no such message exists. */
  runId: id,
  state: Schema.Literals(['prepared', 'sent', 'dismissed']),
  createdAt: isoDateTime(Schema.String),
  updatedAt: isoDateTime(Schema.String),
  /** Set once, in the same transaction that creates the new thread. */
  sent: Schema.optional(
    mutableStruct({
      taskId: id,
      messageId: id,
      sentAt: isoDateTime(Schema.String),
    }),
  ),
})
export type ThreadAction = Schema.Schema.Type<typeof threadActionSchema>
export const maxThreadActions = 20

/** `thread_prepare` tool input. Run credentials only; the runtime binds it to the run's thread. */
export const threadPrepareCommandSchema = strictStruct({
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120),
  prompt: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000),
  ...threadActionSuggestionSchema.fields,
})
export type ThreadPrepareCommand = Schema.Schema.Type<typeof threadPrepareCommandSchema>
