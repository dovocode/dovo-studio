import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import { questionPromptSchema, type QuestionOutcomes } from '@dovo/protocol'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun } from '../../execution/types.js'
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
  supportsUnanswered = false,
): Promise<Awaited<ReturnType<CanUseTool>>> {
  const parsed = decode(request, input)
  const prompt = decode(questionPromptSchema, {
    title: 'Agent needs your input',
    ...(supportsUnanswered ? { unanswered: true } : {}),
    questions: parsed.questions.map((q, i) => ({
      id: String(i),
      header: q.header,
      question: q.question,
      options: q.options.map((o) => ({
        ...o,
        value: o.label,
      })),
      multiple: q.multiSelect,
      required: !supportsUnanswered,
    })),
  })
  let outcomes: QuestionOutcomes = {}
  const answers = await run.ask(prompt, signal, undefined, (value) => {
    outcomes = value
  })
  signal.throwIfAborted()
  const annotations = supportsUnanswered
    ? Object.fromEntries(
        parsed.questions.flatMap((q, i) =>
          answers?.[String(i)]?.length
            ? []
            : [
                [
                  q.question,
                  { unanswered: outcomes[String(i)] ?? (answers ? 'skipped' : 'dismissed') },
                ],
              ],
        ),
      )
    : undefined
  return answers || supportsUnanswered
    ? {
        behavior: 'allow',
        updatedInput: {
          ...input,
          ...(annotations && Object.keys(annotations).length ? { annotations } : {}),
          answers: Object.fromEntries(
            parsed.questions.map((q, i) => [q.question, (answers?.[String(i)] ?? []).join(', ')]),
          ),
        },
      }
    : {
        behavior: 'deny',
        message: 'User declined to answer in Dovo Studio',
      }
}
