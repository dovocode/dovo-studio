import { z } from 'zod'
import { questionPromptSchema } from '@dovo/protocol'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun } from '../types.js'
const request = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      header: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string() })),
      multiSelect: z.boolean().optional(),
    }),
  ),
})
export async function claudeQuestions(
  input: Record<string, unknown>,
  run: AgentRun,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<CanUseTool>>> {
  const parsed = request.parse(input)
  const prompt = questionPromptSchema.parse({
    title: 'Agent needs your input',
    questions: parsed.questions.map((q, i) => ({
      id: String(i),
      header: q.header,
      question: q.question,
      options: q.options.map((o) => ({ ...o, value: o.label })),
      multiple: q.multiSelect,
    })),
  })
  const answers = await run.ask(prompt, signal)
  return answers
    ? {
        behavior: 'allow',
        updatedInput: {
          ...input,
          answers: Object.fromEntries(
            parsed.questions.map((q, i) => [q.question, (answers[String(i)] ?? []).join(', ')]),
          ),
        },
      }
    : { behavior: 'deny', message: 'User declined to answer in Dovo Studio' }
}
