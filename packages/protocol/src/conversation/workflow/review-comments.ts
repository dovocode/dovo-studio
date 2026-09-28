import type { ChatMessage, Task } from '../../workspace.js'

/** Review comments (line comments and file feedback) the agent has not received yet. They
 * reach the agent with the next message; until then they can still be removed. */
export function pendingReviewComments(
  task: Pick<Task, 'messages' | 'consumedMessageIds' | 'runAttempt'>,
): ChatMessage[] {
  const consumed = new Set([
    ...(task.consumedMessageIds ?? []),
    ...(task.runAttempt?.inputMessageIds ?? []),
  ])
  return task.messages.filter(
    (message) =>
      message.role === 'user' &&
      (!!message.diffComment || !!message.file) &&
      !consumed.has(message.id),
  )
}

/** The follow-up that asks the agent to act on a batch of review comments. */
export function reviewCommentsPrompt(count: number) {
  return count === 1
    ? 'Please address my review comment above.'
    : `Please address my ${count} review comments above.`
}
