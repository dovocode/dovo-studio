import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  agentQuestionRequestSchema,
  agentTodosRequestSchema,
  decode,
  questionPromptSchema,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'

/** Both endpoints are admitted with an exact, live run credential before this handler. */
export function agentInteraction(
  s: Services,
  part: 'question' | 'todos',
  value: unknown,
  runId: string,
) {
  if (part === 'question') {
    const { taskId, command } = decode(agentQuestionRequestSchema, value)
    const prompt = decode(questionPromptSchema, { ...command, blocking: false })
    const id = `tool-question:${createHash('sha256')
      .update(JSON.stringify([taskId, runId, command.key]))
      .digest('hex')}`
    s.tasks.askQuestion(taskId, runId, prompt, id)
    return {
      id,
      status: s.questions.status(id),
      delivery: 'conversation',
      note: 'The answer will steer the active turn or arrive as a follow-up. Continue independent work, or finish your turn if you need the answer. A pending question is not an answer or approval.',
    }
  }
  const { taskId, command } = decode(agentTodosRequestSchema, value)
  const task = s.store.taskSummary(taskId)
  if (task.activeRunId !== runId)
    throw new HttpError(409, 'Checklist tools require this thread’s active agent turn')
  if (command.action === 'set' && !isDeepStrictEqual(task.nativeTodos ?? [], command.items))
    s.store.updateTask(taskId, (current) => ({
      ...current,
      nativeTodos: command.items.length ? command.items : undefined,
    }))
  return { items: s.store.taskSummary(taskId).nativeTodos ?? [] }
}
