import { z } from 'zod'
import { questionPromptSchema } from '@dovo/protocol'
import type { AgentRun } from '../types.js'
const request = z.object({
  isBlocking: z.boolean().optional(),
  questions: z.array(
    z.object({
      id: z.string(),
      header: z.string(),
      question: z.string(),
      isOther: z.boolean().optional(),
      isSecret: z.boolean().optional(),
      options: z.array(z.object({ label: z.string(), description: z.string() })).nullish(),
    }),
  ),
})
export async function codexQuestions(value: unknown, run: AgentRun, signal?: AbortSignal) {
  const input = request.parse(value)
  const prompt = questionPromptSchema.parse({
    title: 'Agent needs your input',
    blocking: input.isBlocking ?? true,
    questions: input.questions.map((q, i) => ({
      id: String(i),
      header: q.header,
      question: q.question,
      options: q.options?.map((o) => ({ ...o, value: o.label })),
      custom: !q.options?.length || q.isOther !== false,
      secret: q.isSecret,
    })),
  })
  const answers = await run.ask(prompt, signal)
  return {
    answers: answers
      ? Object.fromEntries(input.questions.map((q, i) => [q.id, { answers: answers[String(i)] }]))
      : {},
  }
}

// Astra emits request_user_input_async as an agentMessage carrying structured questions.
const asyncQuestions = z.object({
  type: z.literal('agentMessage'),
  id: z.string(),
  questions: z
    .array(z.object({ title: z.string(), options: z.array(z.string()).nullish() }))
    .min(1),
})
export function codexAsyncQuestions(value: unknown) {
  const parsed = asyncQuestions.safeParse(value)
  if (!parsed.success) return
  return {
    id: parsed.data.id,
    prompt: questionPromptSchema.parse({
      title: 'Agent has a question',
      blocking: false,
      questions: parsed.data.questions.map((q, index) => ({
        id: String(index),
        header: '',
        question: q.title,
        options: q.options?.map((label) => ({ value: label, label })),
        custom: true,
      })),
    }),
  }
}
