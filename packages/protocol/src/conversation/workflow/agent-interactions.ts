import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, refine } from '../../shared/schema.js'
import { agentQuestionSchema, questionPromptSchema } from './questions.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const agentTodoSchema = mutableStruct({
  /** Native task identity, when the provider updates individual entries. */
  id: Schema.optional(id),
  text: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 2000),
  status: Schema.Literals(['pending', 'in-progress', 'completed']),
})
export const agentTodosSchema = refine(
  maxValue(mutableArray(agentTodoSchema), 100),
  (items) => {
    const ids = items.flatMap((item) => (item.id ? [item.id] : []))
    return new Set(ids).size === ids.length
  },
  'Checklist IDs must be unique',
)
export const agentTodosCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list') }),
  mutableStruct({ action: Schema.Literal('set'), items: agentTodosSchema }),
])
export const agentQuestionCommandSchema = mutableStruct({
  /** Stable within this turn: retries return the same question instead of opening another. */
  key: id,
  title: questionPromptSchema.fields.title,
  // Answers are delivered as conversation messages. Secret input belongs in a native
  // blocking form, where it can return directly to the provider without being persisted.
  questions: maxValue(
    minValue(
      mutableArray(
        mutableStruct({
          ...agentQuestionSchema.fields,
          secret: Schema.optional(Schema.Literal(false)),
        }),
      ),
      1,
    ),
    20,
  ),
})
export const agentQuestionRequestSchema = mutableStruct({
  taskId: id,
  parentRunId: id,
  command: agentQuestionCommandSchema,
})
export const agentTodosRequestSchema = mutableStruct({
  taskId: id,
  parentRunId: id,
  command: agentTodosCommandSchema,
})
