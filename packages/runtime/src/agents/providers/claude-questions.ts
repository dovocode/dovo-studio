import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import { questionPromptSchema } from '@dovo/protocol'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun } from '../types.js'
const request = mutableStruct({
  questions: mutableArray(
    mutableStruct({
      question: Schema.String,
      header: Schema.String,
      options: mutableArray(
        mutableStruct({
          label: Schema.String,
          description: Schema.String,
        }),
      ),
      multiSelect: Schema.optional(Schema.Boolean),
    }),
  ),
})
export async function claudeQuestions(
  input: Record<string, unknown>,
  run: AgentRun,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<CanUseTool>>> {
  const parsed = decode(request, input)
  const prompt = decode(questionPromptSchema, {
    title: 'Agent needs your input',
    questions: parsed.questions.map((q, i) => ({
      id: String(i),
      header: q.header,
      question: q.question,
      options: q.options.map((o) => ({
        ...o,
        value: o.label,
      })),
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
    : {
        behavior: 'deny',
        message: 'User declined to answer in Dovo Studio',
      }
}
