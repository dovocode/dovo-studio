import { Schema } from 'effect'
import {
  mutableStruct,
  mutableArray,
  minValue,
  maxValue,
  refine,
  decodeResult,
} from '../shared/schema.js'
import type { QuestionPrompt } from '../conversation/workflow/questions.js'

const text = (limit: number) => maxValue(minValue(Schema.String, 1), limit)
export const notificationQuestionSchema = refine(
  mutableStruct({
    fieldId: text(200),
    mode: Schema.Literals(['choice', 'text']),
    choices: maxValue(mutableArray(mutableStruct({ label: text(48), value: text(80) })), 3),
  }),
  (q) => (q.mode === 'text' ? q.choices.length === 0 : q.choices.length > 0),
  'Invalid notification question',
)
export type NotificationQuestion = typeof notificationQuestionSchema.Type
export const notificationAnswerSchema = mutableStruct({
  taskId: text(200),
  id: text(200),
  fieldId: text(200),
  value: text(10000),
})
export type NotificationAnswer = typeof notificationAnswerSchema.Type

/** Keep full forms, sensitive fields and questions too long to read in the app. */
export function notificationQuestion(prompt: QuestionPrompt): NotificationQuestion | undefined {
  if (prompt.questions.length !== 1) return
  const q = prompt.questions[0]
  if (
    q.secret ||
    q.multiple ||
    q.inputType !== 'text' ||
    q.question.length > 250 ||
    notificationQuestionBody(prompt).length > 600
  )
    return
  if (!q.options.length) return q.custom ? { fieldId: q.id, mode: 'text', choices: [] } : undefined
  if (
    q.options.length > 3 ||
    q.options.some(
      (o) => !o.label.trim() || !o.value.trim() || o.label.length > 48 || o.value.length > 80,
    ) ||
    new Set(q.options.map((o) => o.value)).size !== q.options.length
  )
    return
  return {
    fieldId: q.id,
    mode: 'choice',
    choices: q.options.map(({ label, value }) => ({ label, value })),
  }
}
export function notificationQuestionBody(prompt: QuestionPrompt) {
  const q = prompt.questions[0]
  return [
    ...new Set([prompt.title, q.header, q.question].filter(Boolean)),
    ...q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`),
  ].join('\n')
}
export function notificationQuestionCategory(question: NotificationQuestion) {
  return question.mode === 'text'
    ? 'dovo-question-text'
    : `dovo-question-choice-${question.choices.length}`
}
export function parseNotificationQuestion(data: {
  kind?: unknown
  inputType?: unknown
  inputId?: unknown
  question?: unknown
}) {
  if (
    data.kind !== 'input' ||
    data.inputType !== 'question' ||
    typeof data.inputId !== 'string' ||
    !data.inputId ||
    typeof data.question !== 'string'
  )
    return
  try {
    const result = decodeResult(notificationQuestionSchema, JSON.parse(data.question))
    return result.success ? result.data : undefined
  } catch {
    return
  }
}
