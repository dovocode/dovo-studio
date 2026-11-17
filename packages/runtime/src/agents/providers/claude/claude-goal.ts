import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun } from '../../execution/types.js'
import { nativeWait } from '../shared/native.js'

/** Check before submitting input, so an older CLI cannot treat /goal as model text. */
export async function requireClaudeGoal(stream: Query, run: AgentRun) {
  if (!run.goal) return
  if (run.goal.action === 'pause' || run.goal.action === 'resume')
    throw new Error(
      'Claude supports /goal, /goal <objective> and /goal clear. Stop the turn to interrupt work; send a message to continue.',
    )
  if (
    !(await nativeWait(stream.supportedCommands(), run.signal, 15_000)).some(
      (command) => command.name === 'goal' && command.builtin === true,
    )
  )
    throw new Error(
      'This Claude version or policy does not support native goals. Update Claude Code on the thread computer and check its hook policy.',
    )
  run.signal.throwIfAborted()
}
