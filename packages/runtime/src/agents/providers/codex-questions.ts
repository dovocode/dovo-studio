import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, minValue, decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import { questionPromptSchema } from '@dovo/protocol'
import type { AgentRun } from '../types.js'
const request = mutableStruct({
  isBlocking: Schema.optional(Schema.Boolean),
  questions: mutableArray(
    mutableStruct({
      id: Schema.String,
      header: Schema.String,
      question: Schema.String,
      isOther: Schema.optional(Schema.Boolean),
      isSecret: Schema.optional(Schema.Boolean),
      options: Schema.optional(
        Schema.NullOr(
          mutableArray(
            mutableStruct({
              label: Schema.String,
              description: Schema.String,
            }),
          ),
        ),
      ),
    }),
  ),
})
export async function codexQuestions(value: unknown, run: AgentRun, signal?: AbortSignal) {
  const input = decode(request, value)
  const prompt = decode(questionPromptSchema, {
    title: 'Agent needs your input',
    blocking: input.isBlocking ?? true,
    questions: input.questions.map((q, i) => ({
      id: String(i),
      header: q.header,
      question: q.question,
      options: q.options?.map((o) => ({
        ...o,
        value: o.label,
      })),
      custom: !q.options?.length || q.isOther !== false,
      secret: q.isSecret,
    })),
  })
  const answers = await run.ask(prompt, signal)
  return {
    answers: answers
      ? Object.fromEntries(
          input.questions.map((q, i) => [
            q.id,
            {
              answers: answers[String(i)],
            },
          ]),
        )
      : {},
  }
}

// Astra emits request_user_input_async as an agentMessage carrying structured questions.
const asyncQuestions = mutableStruct({
  type: Schema.Literal('agentMessage'),
  id: Schema.String,
  questions: minValue(
    mutableArray(
      mutableStruct({
        title: Schema.String,
        options: Schema.optional(Schema.NullOr(mutableArray(Schema.String))),
      }),
    ),
    1,
  ),
})
export function codexAsyncQuestions(value: unknown) {
  const parsed = decodeResult(asyncQuestions, value)
  if (!parsed.success) return
  return {
    id: parsed.data.id,
    prompt: decode(questionPromptSchema, {
      title: 'Agent has a question',
      blocking: false,
      questions: parsed.data.questions.map((q, index) => ({
        id: String(index),
        header: '',
        question: q.title,
        options: q.options?.map((label) => ({
          value: label,
          label,
        })),
        custom: true,
      })),
    }),
  }
}
