import type { Task } from '../workspace.js'
import { messageSourceFor } from './message-source.js'
import { Schema } from 'effect'
import { mutableStruct, maxValue } from '../shared/schema.js'
export const promptSuggestionSchema = mutableStruct({
  turnId: Schema.String,
  text: maxValue(Schema.String, 600),
})

/** Automated messages and child work do not need a human follow-up suggestion. */
export function canSuggestNextPrompt(task: Task) {
  const turn = task.turns?.at(-1)
  const user = task.messages.filter((message) => message.role === 'user').at(-1)
  const source = user && messageSourceFor(user)
  return (
    turn?.status === 'completed' &&
    task.status !== 'running' &&
    !task.queue?.length &&
    !task.delegation &&
    !task.archivedAt &&
    !!user &&
    (!source || source.kind === 'user')
  )
}
