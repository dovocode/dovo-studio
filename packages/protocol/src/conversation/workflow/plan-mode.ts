import type { Task } from '../../workspace.js'
import { supportsAccess } from '../../auth/access.js'
import { selectPermissionPreset, type PermissionPolicy } from '../../auth/permission-policy.js'

/** Added to a plan-mode turn's prompt. The runtime also runs that turn read-only. */
export const PLAN_MODE_INSTRUCTION =
  'Plan mode: this turn is read-only. Explore the code and reply with a clear, numbered plan for the latest request. Do not edit files, commit, or run commands that change anything; the user approves the plan before implementation.'
export const IMPLEMENT_PLAN_PROMPT = 'The plan looks good. Implement it now.'

/** Plan mode relies on the provider's own read-only boundary, never on the prompt alone. */
export function planModeIssue(agent: Pick<PermissionPolicy, 'provider'> | undefined) {
  return agent && supportsAccess(agent.provider, 'read-only')
    ? undefined
    : 'This harness has no read-only mode, so it cannot plan without changing files.'
}

/** One plan turn narrows the thread's policy; the saved thread permissions stay unchanged. */
export function planModeAgent<T extends PermissionPolicy>(agent: T): T {
  return selectPermissionPreset(agent, 'read-only')
}

/** Review comments, file shares and delegated results do not answer or end a plan request. */
function latestPrompt(messages: Task['messages']) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (
      message.role === 'user' &&
      !message.diffComment &&
      !message.file &&
      !message.subagentResultId
    )
      return index
  }
  return -1
}

/** The newest prompt asked for a plan, so the turn answering it must stay read-only. */
export function planModeRequested(messages: Task['messages']) {
  return !!messages[latestPrompt(messages)]?.plan
}

/** The agent answered a plan-mode request and is waiting for approval. */
export function planAwaitingApproval(task: Pick<Task, 'messages' | 'status' | 'queue'>): boolean {
  if (task.status === 'running' || task.queue?.length) return false
  const messages = task.messages
  const lastUser = latestPrompt(messages)
  if (lastUser < 0 || !messages[lastUser].plan) return false
  return messages
    .slice(lastUser + 1)
    .some((message) => message.role === 'assistant' && !!message.text.trim())
}
