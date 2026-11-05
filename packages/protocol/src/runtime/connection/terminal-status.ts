import type { TerminalInfo } from './runtime.js'

export type TerminalStatusTone = 'muted' | 'working' | 'warning' | 'success' | 'error'

/** Explicit tool activity takes precedence over the PTY's foreground command. */
export function terminalStatus(
  session: TerminalInfo,
  connected: boolean,
): {
  label: string
  tone: TerminalStatusTone
  section: 'active' | 'working' | 'needs-input'
  detail?: string
} {
  const detail = session.activity?.message ?? session.integrationError
  if (!connected) return { label: 'Offline', tone: 'muted', section: 'active', detail }
  if (session.dormant && !session.exited)
    return {
      label: session.recoveryError ? 'Recovery needs attention' : 'Sleeping',
      tone: session.recoveryError ? 'warning' : 'muted',
      section: 'active',
      detail: session.recoveryError,
    }
  if (session.exited)
    return {
      label: session.exitCode == null ? 'Exited' : `Exited ${session.exitCode}`,
      tone: session.exitCode ? 'error' : 'muted',
      section: 'active',
      detail,
    }
  switch (session.activity?.state) {
    case 'working':
      return {
        label:
          session.activity.progress == null ? 'Working' : `Working ${session.activity.progress}%`,
        tone: 'working',
        section: 'working',
        detail,
      }
    case 'blocked':
      return { label: 'Needs input', tone: 'warning', section: 'needs-input', detail }
    case 'done':
      return { label: 'Done', tone: 'success', section: 'active', detail }
    case 'error':
      return { label: 'Failed', tone: 'error', section: 'active', detail }
    case 'idle':
      return { label: 'Idle', tone: 'muted', section: 'active', detail }
    default:
      if (session.foregroundProcess)
        return session.foregroundProcess.idle
          ? { label: 'Idle', tone: 'muted', section: 'active', detail }
          : {
              label: 'Running',
              tone: 'working',
              section: 'working',
              detail: detail ?? session.foregroundProcess.name,
            }
      return { label: 'Live session', tone: 'muted', section: 'active', detail }
  }
}
