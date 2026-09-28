import type { Task } from '../../workspace.js'

/** Added to the latest plan-mode message in the agent's prompt. The agent is asked, not forced:
 * access settings still decide what it may do. */
export const PLAN_MODE_INSTRUCTION =
  'Plan mode: explore the code and reply with a clear, numbered plan for this request. Do not edit files, commit, or run commands that change anything until I approve the plan.'
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
