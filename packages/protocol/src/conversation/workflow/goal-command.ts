/** Native goal commands are user input, never commands extracted from quoted history. */
export type GoalCommand =
  | { action: 'get' | 'clear' | 'pause' | 'resume' }
  | { action: 'set'; objective: string }

export function goalCommand(text: string): GoalCommand | undefined {
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return undefined
  const argument = (match[1] ?? '').trim()
  if (!argument) return { action: 'get' }
  if (argument === 'clear' || argument === 'pause' || argument === 'resume')
    return { action: argument }
  if (argument === 'edit') throw new Error('Use /goal edit <objective> to change the goal.')
  const objective = argument.replace(/^edit\s+/, '').trim()
  if (objective.length > 4000) throw new Error('Goal objectives must be at most 4,000 characters.')
  return { action: 'set', objective }
}

export function goalCommandText(command: GoalCommand) {
  return command.action === 'set'
    ? `/goal ${command.objective}`
    : command.action === 'get'
      ? '/goal'
      : `/goal ${command.action}`
}
