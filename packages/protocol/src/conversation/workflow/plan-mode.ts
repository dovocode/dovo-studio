import type { Task } from '../../workspace.js'

export const IMPLEMENT_PLAN_PROMPT = 'The plan looks good. Implement it now.'

/** The agent answered a plan-mode request and is waiting for approval. */
export function planAwaitingApproval(task: Pick<Task, 'messages' | 'status' | 'queue'>): boolean {
  if (task.status === 'running' || task.queue?.length) return false
  const messages = task.messages
  let lastUser = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user' && !message.diffComment && !message.file) {
      lastUser = index
      break
    }
  }
  if (lastUser < 0 || !messages[lastUser].plan) return false
  return messages
    .slice(lastUser + 1)
    .some((message) => message.role === 'assistant' && !!message.text.trim())
}
