import { setTimeout } from 'node:timers/promises'
import type { AgentRun } from '../../execution/types.js'
import { readClaudeThread } from './claude-thread.js'

export function isClaudeForkedSkill(event: Record<string, unknown>) {
  return (
    event.type === 'system' &&
    event.subtype === 'task_started' &&
    event.task_type === 'local_agent' &&
    event.skip_transcript !== true &&
    event.tool_use_id === undefined &&
    typeof event.task_id === 'string' &&
    /^[\w-]+$/.test(event.task_id) &&
    (typeof event.spawn_depth !== 'number' || event.spawn_depth <= 1) &&
    typeof event.description === 'string' &&
    /^\/[^\s]+$/.test(event.description.trim())
  )
}

/** A fork's SDK notification contains the command name. Its report is written to the transcript. */
export async function claudeForkedSkillResult(
  run: AgentRun,
  sessionId: string,
  taskId: string,
  signal: AbortSignal,
) {
  try {
    // The final transcript write may follow the notification.
    await setTimeout(150, undefined, { signal })
    const entries = await readClaudeThread(run.agent, taskId, sessionId, run.cwd)
    const replies = entries.filter((entry) => entry.role === 'assistant')
    const last = replies.at(-1)
    if (!last) return
    const parent = last.id.split(':')[0]
    return replies
      .filter((entry) => entry.id.split(':')[0] === parent)
      .map((entry) => entry.text)
      .join('\n')
  } catch {
    // The native thread can still be refreshed if the provider transcript arrives later.
  }
}
