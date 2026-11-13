import {
  isPrivateBrowserProfile,
  runtimeComputerName,
  STUDIO_TERMINAL_SCOPE,
  latestTaskTurn,
  type Repository,
  type RuntimeOverview,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import type { BrowserTab } from '../browser/shared-browser-tabs'
import type { WorkspaceTab, WorkspaceTabAvailability } from './workspace-tabs'

export type WorkspaceIdentityComputer = Pick<RuntimeOverview, 'profile' | 'connected'> & {
  snapshot:
    | (Pick<RuntimeSnapshot, 'runtimeHost' | 'terminals'> & {
        workspace: Pick<RuntimeSnapshot['workspace'], 'tasks' | 'repositories'>
      })
    | null
}
export type WorkspaceIdentitySources = {
  computers: readonly WorkspaceIdentityComputer[]
  /** Undefined means browser hydration has not finished; it does not mean all pages closed. */
  browserTabs: readonly BrowserTab[] | undefined
}
export type WorkspaceIdentity = {
  kindLabel: 'Thread' | 'Bot' | 'Page' | 'Terminal'
  title: string
  detail: string
  /** Absence is unknown; missing is reserved for positively identified ineligible thread shells. */
  availability: WorkspaceTabAvailability
  offline: boolean
  computer: string
  project?: string
  /** Original repository reference, including its project icon metadata. */
  repository?: Repository
  avatarLabel: string
  branch?: string
  /** Latest available real activity/lifecycle timestamp; absent when the runtime has none. */
  activityAt?: string
  status: string
  shell?: string
  directory?: string
  checkoutBranch?: string
  host?: string
  private?: boolean
}
/** For global tab reconciliation only: stale/offline snapshots never prove a ref ineligible. */
export function standaloneTerminalTabAvailability(
  tab: WorkspaceTab,
  computers: readonly WorkspaceIdentityComputer[],
): WorkspaceTabAvailability {
  if (tab.kind !== 'terminal') return 'unknown'
  const owner = computers.find((item) => item.profile.id === tab.runtimeId)
  if (!owner?.connected || !owner.snapshot) return 'unknown'
  const session = owner.snapshot.terminals.find((item) => item.id === tab.id)
  if (!session) return 'unknown'
  return session.taskId === STUDIO_TERMINAL_SCOPE ? 'present' : 'missing'
}
const threadStatuses = {
  draft: 'Draft',
  running: 'Running',
  review: 'Review',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const
const shellNames: Readonly<Record<string, string>> = {
  default: 'Default shell',
  bash: 'Bash',
  zsh: 'Zsh',
  fish: 'Fish',
  sh: 'POSIX shell',
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'Command Prompt',
  nu: 'Nushell',
}
function latestTimestamp(...values: (string | number | undefined)[]) {
  const times = values.flatMap((value) => {
    const time = typeof value === 'string' ? Date.parse(value) : value
    return time !== undefined && Number.isFinite(new Date(time).getTime()) ? [time] : []
  })
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined
}
function identified(
  identity: Omit<WorkspaceIdentity, 'detail' | 'avatarLabel'>,
): WorkspaceIdentity {
  return {
    ...identity,
    avatarLabel: identity.project || identity.host || identity.title,
    detail: [
      identity.kindLabel,
      identity.shell,
      identity.project,
      identity.branch,
      identity.host,
      identity.private ? 'Private' : undefined,
      identity.computer,
      identity.directory,
      identity.status,
      identity.offline && identity.status !== 'Offline' ? 'Offline' : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/** A display projection of current snapshots. It never persists resources or changes lifecycle. */
export function workspaceIdentity(
  tab: WorkspaceTab,
  sources: WorkspaceIdentitySources,
): WorkspaceIdentity {
  if (tab.kind === 'browser') {
    const page = sources.browserTabs?.find((item) => item.id === tab.id)
    const owner = page?.runtimeId
      ? sources.computers.find((item) => item.profile.id === page.runtimeId)
      : undefined
    const computer = owner
      ? runtimeComputerName(owner)
      : page?.runtimeId
        ? 'Unavailable computer'
        : 'Local browser'
    let host: string | undefined
    if (page?.url) {
      try {
        host = new URL(page.url).host || undefined
      } catch {
        /* No valid address yet. */
      }
    }
    return identified({
      kindLabel: 'Page',
      title:
        page?.title ||
        host ||
        page?.url ||
        (page || tab.id === 'new' ? 'New page' : 'Page unavailable'),
      availability: page
        ? page.runtimeId && !owner
          ? 'unknown'
          : 'present'
        : sources.browserTabs === undefined
          ? 'unknown'
          : tab.id === 'new'
            ? 'present'
            : 'unknown',
      computer,
      offline: !!owner && !owner.connected,
      host,
      private: !!page && isPrivateBrowserProfile(page.profileId),
      activityAt: latestTimestamp(page?.visitedAt, page?.lastActiveAt, page?.settledAt),
      status: page
        ? page.url
          ? 'Open'
          : 'New page'
        : tab.id === 'new'
          ? 'New page'
          : sources.browserTabs === undefined
            ? 'Loading'
            : 'Page unavailable',
    })
  }

  const owner = sources.computers.find((item) => item.profile.id === tab.runtimeId)
  const computer = owner ? runtimeComputerName(owner) : 'Unavailable computer'
  const snapshot = owner?.snapshot
  const kindLabel = tab.kind === 'thread' ? 'Thread' : 'Terminal'
  const fallback = {
    kindLabel,
    computer,
    offline: !!owner && !owner.connected,
    title: tab.kind === 'thread' ? (tab.id ? 'Thread' : 'New thread') : 'Terminal session',
    availability: 'unknown',
    status: owner ? (owner.connected ? 'Loading' : 'Offline') : 'Computer unavailable',
  } satisfies Omit<WorkspaceIdentity, 'detail' | 'avatarLabel'>
  if (!owner || !snapshot) return identified(fallback)
  const projectName = (repositoryId: string | undefined) => {
    const repository = snapshot.workspace.repositories.find((item) => item.id === repositoryId)
    return repository?.kind === 'scratch'
      ? 'No Project'
      : repository?.sharedName ||
          repository?.name ||
          (repositoryId ? 'Project unavailable' : 'No Project')
  }

  if (tab.kind === 'thread') {
    if (!tab.id) return identified({ ...fallback, availability: 'present', status: 'New thread' })
    const task = snapshot.workspace.tasks.find((item) => item.id === tab.id)
    // Overview snapshots can omit paginated settled threads. Absence isn't proof of deletion.
    if (!task) return identified({ ...fallback, status: 'Thread unavailable' })
    const repository = snapshot.workspace.repositories.find((item) => item.id === task.repositoryId)
    const latest = latestTaskTurn(task)
    return identified({
      ...fallback,
      availability: 'present',
      title: task.title || 'Untitled thread',
      kindLabel: task.bot ? 'Bot' : 'Thread',
      project: task.bot ? undefined : projectName(task.repositoryId),
      repository: task.bot ? undefined : repository,
      branch: task.bot
        ? undefined
        : (task.checkoutBranch ??
          (task.execution === 'worktree' ? latest?.branch : repository?.branch)),
      activityAt: latestTimestamp(
        task.createdAt,
        task.updatedAt,
        task.lastPromptAt,
        latest?.startedAt,
        latest?.finishedAt,
      ),
      status: task.archivedAt
        ? 'Archived'
        : task.archived
          ? 'Settled'
          : threadStatuses[task.status],
    })
  }
  const session = snapshot.terminals.find((item) => item.id === tab.id)
  // A create response can precede the refreshed terminal snapshot. Keep its tab while resolving.
  if (!session) return identified({ ...fallback, status: 'Session unavailable' })
  if (session.taskId !== STUDIO_TERMINAL_SCOPE)
    return identified({
      ...fallback,
      availability: standaloneTerminalTabAvailability(tab, sources.computers),
      status: 'Not a standalone terminal',
    })
  const repository = snapshot.workspace.repositories.find(
    (item) => item.id === session.repositoryId,
  )
  return identified({
    ...fallback,
    availability: 'present',
    title: session.title || 'Terminal session',
    project: session.repositoryId ? projectName(session.repositoryId) : 'Home folder',
    repository,
    branch:
      session.checkoutBranch ?? (session.execution === 'worktree' ? undefined : repository?.branch),
    activityAt: latestTimestamp(session.settledAt),
    shell: session.shellId ? (shellNames[session.shellId] ?? session.shellId) : 'Shell',
    directory: session.directory,
    checkoutBranch: session.checkoutBranch,
    status: session.exited
      ? session.exitCode === undefined
        ? 'Exited'
        : `Exited (${session.exitCode})`
      : 'Running',
  })
}
