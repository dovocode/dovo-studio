import type { TaskTurn } from '@dovo/studio-core'

export type ActivityState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted'
  | 'recorded'

/** Finished turns must never leave their last tool looking active. */
export function taskActivityState(status: string, turn?: TaskTurn['status']): ActivityState {
  const normalized = status.toLowerCase().replace(/[ _-]/g, '')
  if (['failed', 'error', 'errored'].includes(normalized)) return 'failed'
  if (['cancelled', 'canceled', 'stopped', 'declined'].includes(normalized)) return 'stopped'
  if (['interrupted', 'aborted'].includes(normalized)) return 'interrupted'
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(normalized))
    return 'completed'
  if (['running', 'started', 'inprogress', 'pending', 'queued', 'executing'].includes(normalized))
    return turn === 'cancelled'
      ? 'stopped'
      : turn === 'failed'
        ? 'failed'
        : turn === 'completed'
          ? 'interrupted'
          : 'running'
  return 'recorded'
}

/** A short visual label only; the original command is always shown in the disclosure. */
export function activityCommandLabel(value: string): string {
  let command = value.trim()
  const shell =
    /^(?:\S*\/)?(?:zsh|bash|sh|fish)\s+(?:-\S+\s+)*-[A-Za-z]*c[A-Za-z]*\s+(['"]?)([\s\S]+)$/i.exec(
      command,
    )
  if (shell) {
    command = shell[2] ?? command
    if (shell[1] && command.endsWith(shell[1])) command = command.slice(0, -1)
  }
  command = command
    .replace(/^env\s+/, '')
    .replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/, '')
  const first = /^(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(command)
  const executable = first?.[1] || first?.[2] || first?.[3]
  return executable?.split(/[\\/]/).at(-1)?.slice(0, 48) || 'command'
}

export function taskActivityOutcome(states: ActivityState[]): string {
  return (['failed', 'stopped', 'interrupted'] as const)
    .flatMap((state) => {
      const count = states.filter((item) => item === state).length
      return count ? [`${count} ${state}`] : []
    })
    .join(' · ')
}
