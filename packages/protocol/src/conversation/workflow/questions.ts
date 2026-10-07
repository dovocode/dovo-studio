import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { minValue, maxValue, refine } from '../../shared/schema.js'
import { Schema, Effect } from 'effect'
export const agentQuestionSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 200),
  header: maxValue(Schema.String, 200),
  question: maxValue(minValue(Schema.String, 1), 12000),
  options: maxValue(
    mutableArray(
      mutableStruct({
        value: maxValue(minValue(Schema.String, 1), 1000),
        label: maxValue(minValue(Schema.String, 1), 1000),
        description: maxValue(Schema.String, 4000).pipe(
          Schema.withDecodingDefaultType(Effect.sync(() => '')),
        ),
      }),
    ),
    50,
  ).pipe(Schema.withDecodingDefaultType(Effect.sync(() => []))),
  multiple: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  custom: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => true))),
  secret: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  required: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => true))),
  inputType: Schema.Literals(['text', 'number']).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => 'text')),
  ),
})
export const questionPromptSchema = refine(
  mutableStruct({
    title: maxValue(minValue(Schema.String, 1), 12000),
    /** Older harnesses block by default; Astra can ask while continuing its turn. */
    blocking: Schema.optional(Schema.Boolean),
    questions: maxValue(minValue(mutableArray(agentQuestionSchema), 1), 20),
  }),
  (v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length,
  'Question IDs must be unique',
)
export const questionAnswersSchema = Schema.Record(
  maxValue(minValue(Schema.String, 1), 200),
  Schema.mutableKey(maxValue(mutableArray(maxValue(Schema.String, 10000)), 50)),
)
export const pendingQuestionSchema = mutableStruct({
  id: Schema.String,
  taskId: Schema.String,
  prompt: questionPromptSchema,
  createdAt: Schema.String,
})
export const questionReplySchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 200),
  answers: Schema.NullOr(questionAnswersSchema),
})
export type AgentQuestion = Schema.Schema.Type<typeof agentQuestionSchema>
export type QuestionPrompt = Schema.Schema.Type<typeof questionPromptSchema>
export type QuestionAnswers = Schema.Schema.Type<typeof questionAnswersSchema>
export type PendingQuestion = Schema.Schema.Type<typeof pendingQuestionSchema>
export type QuestionDraft = {
  selected: string[]
  text: string
}
export function questionDraftAnswers(drafts: Record<string, QuestionDraft>): QuestionAnswers {
  return Object.fromEntries(
    Object.entries(drafts).map(([id, draft]) => [
      id,
      [...draft.selected, ...(draft.text.trim() ? [draft.text] : [])],
    ]),
  )
}
export function toggleQuestionChoice(
  q: AgentQuestion,
  draft: QuestionDraft,
  value: string,
): QuestionDraft {
  return q.multiple
    ? {
        ...draft,
        selected: draft.selected.includes(value)
          ? draft.selected.filter((v) => v !== value)
          : [...draft.selected, value],
      }
    : {
        selected: !q.required && draft.selected.includes(value) ? [] : [value],
        text: '',
      }
}
export function questionAnswerError(questions: AgentQuestion[], answers: QuestionAnswers) {
  if (Object.keys(answers).some((id) => !questions.some((q) => q.id === id)))
    return 'Unknown question in response'
  for (const q of questions) {
    const values = Object.hasOwn(answers, q.id) ? answers[q.id] : []
    if (q.required && !values.length) return `Answer ${q.header || q.question}`
    if (!q.multiple && values.length > 1) return `Choose one answer for ${q.header || q.question}`
    if (values.some((v) => !v.trim())) return 'Answers cannot be blank'
    if (new Set(values).size !== values.length) return 'Repeated answers are not allowed'
    if (!q.custom && values.some((v) => !q.options.some((o) => o.value === v)))
      return `Choose an available option for ${q.header || q.question}`
  }
}
