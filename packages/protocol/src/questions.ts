import { z } from 'zod'
export const agentQuestionSchema = z.object({
  id: z.string().min(1).max(200),
  header: z.string().max(200),
  question: z.string().min(1).max(12000),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(1000),
        label: z.string().min(1).max(1000),
        description: z.string().max(4000).default(''),
      }),
    )
    .max(50)
    .default([]),
  multiple: z.boolean().default(false),
  custom: z.boolean().default(true),
  secret: z.boolean().default(false),
  required: z.boolean().default(true),
  inputType: z.enum(['text', 'number']).default('text'),
})
export const questionPromptSchema = z
  .object({
    title: z.string().min(1).max(12000),
    /** Older harnesses block by default; Astra can ask while continuing its turn. */
    blocking: z.boolean().optional(),
    questions: z.array(agentQuestionSchema).min(1).max(20),
  })
  .refine(
    (v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length,
    'Question IDs must be unique',
  )
export const questionAnswersSchema = z.record(
  z.string().min(1).max(200),
  z.array(z.string().max(10000)).max(50),
)
export const pendingQuestionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  prompt: questionPromptSchema,
  createdAt: z.string(),
})
export const questionReplySchema = z.object({
  id: z.string().min(1).max(200),
  answers: questionAnswersSchema.nullable(),
})
export type AgentQuestion = z.infer<typeof agentQuestionSchema>
export type QuestionPrompt = z.infer<typeof questionPromptSchema>
export type QuestionAnswers = z.infer<typeof questionAnswersSchema>
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>
export type QuestionDraft = { selected: string[]; text: string }
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
    : { selected: !q.required && draft.selected.includes(value) ? [] : [value], text: '' }
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
