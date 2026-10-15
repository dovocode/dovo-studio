import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, questionPromptSchema } from '@dovo/protocol'
import type { AgentRun } from '../../execution/types.js'
const requestSchema = mutableStruct({
  questions: mutableArray(
    mutableStruct({
      question: Schema.String,
      header: Schema.optional(Schema.String),
      multiSelect: Schema.optional(Schema.Boolean),
      hideOther: Schema.optional(Schema.Boolean),
      options: mutableArray(
        mutableStruct({ label: Schema.String, description: Schema.optional(Schema.String) }),
      ),
    }),
  ),
})
export async function vibeQuestions(raw: unknown, run: AgentRun) {
  const { questions } = decode(requestSchema, raw)
  const answers = await run.ask(
    decode(questionPromptSchema, {
      title: 'Vibe needs your input',
      questions: questions.map((q, i) => ({
        id: String(i),
        header: q.header ?? '',
        question: q.question,
        multiple: q.multiSelect ?? false,
        custom: !q.hideOther,
        options: q.options.map((o) => ({ ...o, value: o.label })),
      })),
    }),
    run.signal,
  )
  return {
    type: 'user_input',
    result: {
      cancelled: answers === null,
      answers: answers
        ? questions.map((q, i) => ({
            question: q.question,
            answer: (answers[String(i)] ?? []).join(', '),
            isOther: (answers[String(i)] ?? []).some(
              (value) => !q.options.some((o) => o.label === value),
            ),
          }))
        : [],
    },
  }
}
