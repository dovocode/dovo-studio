import { STUDIO_TERMINAL_SCOPE, type RuntimeSnapshot, type TerminalInfo } from './runtime.js'

export function terminalRecoveryDescription(
  snapshot?: Pick<
    RuntimeSnapshot,
    'terminalRecoverySupported' | 'terminalLiveRecoverySupported'
  > | null,
) {
  if (!snapshot?.terminalRecoverySupported)
    return 'Update this computer to enable persistent terminal recovery.'
  return snapshot.terminalLiveRecoverySupported
    ? 'Keep the shell and its running commands alive when the Dovo runtime restarts. After a computer restart, reopen the shell and resume supported tools.'
    : 'Reopen the shell and resume supported tools after a restart. Other running commands stop when the Dovo runtime restarts.'
}

export type TerminalStatusTone = 'muted' | 'working' | 'warning' | 'success' | 'error'

type TerminalStatus = {
  label: string
  tone: TerminalStatusTone
  section: 'active' | 'working' | 'needs-input'
  detail?: string
  childAttention?: string
  childDetails?: string[]
}

export function terminalParentChoices(
  snapshot?: Pick<RuntimeSnapshot, 'terminalChildrenSupported' | 'terminals'> | null,
) {
  if (!snapshot?.terminalChildrenSupported) return []
  return snapshot.terminals.filter(
    (item) => item.taskId === STUDIO_TERMINAL_SCOPE && !item.exited && !item.dormant,
  )
}

/** Only the owning computer's explicitly linked PTYs belong here. OSC IDs are local to one PTY. */
export function terminalFamilyLinks(
  session: TerminalInfo,
  terminals: readonly TerminalInfo[],
  connected: boolean,
) {
  if (session.taskId !== STUDIO_TERMINAL_SCOPE) return []
  return terminals
    .filter(
      (item) =>
        item.taskId === STUDIO_TERMINAL_SCOPE &&
        (item.id === session.parentTerminalId || item.parentTerminalId === session.id),
    )
    .map((item) => {
      if (item.id === session.parentTerminalId)
        return { id: item.id, label: `Parent: ${item.title}` }
      const status = rootStatus(item, connected)
      const notice = session.childNotices?.find((entry) => entry.terminalId === item.id)
      const label =
        connected &&
        notice?.state === 'done' &&
        (item.activity?.state === 'idle' || item.activity?.state === 'done')
          ? 'Done'
          : status.label
      return {
        id: item.id,
        label:
          connected &&
          item.activity &&
          !item.exited &&
          !item.dormant &&
          (item.activity.state === 'blocked' || item.activity.state === 'error')
            ? `Child: ${childReason(item.title, item.activity)}`
            : `Child: ${item.title} · ${label}`,
      }
    })
}

export function terminalStatus(
  session: TerminalInfo,
  connected: boolean,
  terminals: readonly TerminalInfo[] = [],
): TerminalStatus {
  const status = rootStatus(session, connected)
  if (!connected || session.dormant || session.exited) return status
  const alerts = (session.childActivities ?? []).filter(
    ({ activity }) => activity.state === 'blocked',
  )
  const childDetails = alerts.map(({ id, activity }) => {
    const identity = activity.title ? `${activity.title} (${id})` : id
    return childReason(identity, activity)
  })
  const programs = terminals.filter(
    (item) =>
      item.taskId === STUDIO_TERMINAL_SCOPE &&
      item.parentTerminalId === session.id &&
      !item.dormant &&
      !item.exited &&
      (item.activity?.state === 'blocked' || item.activity?.state === 'error'),
  )
  const programDetails = programs.map((item) => childReason(item.title, item.activity!))
  const total = childDetails.length + programs.length
  if (!total) return status
  const childAttention =
    total === 1
      ? (childDetails[0] ?? programDetails[0])
      : programs.length
        ? `${total} children need attention`
        : `${total} child agents need input`
  return {
    ...status,
    section: 'needs-input',
    childAttention,
    childDetails: childDetails.length ? childDetails : undefined,
  }
}

function childReason(identity: string, activity: NonNullable<TerminalInfo['activity']>) {
  const reason = {
    permission: 'needs permission',
    question: 'has a question',
    auth: 'needs authentication',
  }
  const summary = `${identity} ${activity.state === 'error' ? 'failed' : activity.kind ? reason[activity.kind] : 'needs input'}`
  return activity.message ? `${summary} · ${activity.message}` : summary
}

/** Explicit tool activity takes precedence over the PTY's foreground command. */
function rootStatus(session: TerminalInfo, connected: boolean): TerminalStatus {
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
    case 'idle':
    case 'done': {
      const done =
        session.turn !== undefined && session.seenTurn !== undefined
          ? session.turn > session.seenTurn
          : session.activity.state === 'done'
      return done
        ? { label: 'Done', tone: 'success', section: 'active', detail }
        : { label: 'Idle', tone: 'muted', section: 'active', detail }
    }
    case 'error':
      return { label: 'Failed', tone: 'error', section: 'needs-input', detail }
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
