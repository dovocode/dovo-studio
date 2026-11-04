import {
  browserTabCategory,
  isPrivateBrowserProfile,
  isSnoozed,
  runtimeComputerName,
  STUDIO_TERMINAL_SCOPE,
  taskIsWorking,
  terminalStatus,
  type RuntimeOverview,
  type Task,
  type TerminalInfo,
  type Repository,
} from '@dovo/protocol'
import type { BrowserTab } from '../browser/browser-state'

export const workspaceSections = [
  { id: 'pinned', title: 'Pinned' },
  { id: 'needs-input', title: 'Needs input' },
  { id: 'active', title: 'Active' },
  { id: 'working', title: 'Working' },
  { id: 'waiting', title: 'Waiting' },
  { id: 'snoozed', title: 'Snoozed' },
  { id: 'settled', title: 'Settled' },
] as const
export type WorkspaceSection = (typeof workspaceSections)[number]['id']
type Common = {
  key: string
  title: string
  detail: string
  status: string
  section: WorkspaceSection
  pinned: boolean
  offline: boolean
}
export type WorkspaceItem = Common &
  (
    | {
        kind: 'thread'
        runtimeId: string
        task: Task
        repository?: Repository
        needsInput: boolean
      }
    | { kind: 'terminal'; runtimeId: string; terminal: TerminalInfo; repository?: Repository }
    | { kind: 'browser'; tab: BrowserTab }
  )
export const terminalHref = (runtimeId: string, terminalId: string) => ({
  pathname: '/terminal/[runtimeId]/[terminalId]' as const,
  params: { runtimeId, terminalId },
})

/** Scope, rather than the presence of a PTY, separates standalone shells from thread tools. */
export function workspaceItems(
  overviews: readonly RuntimeOverview[],
  tabs: readonly BrowserTab[],
  now: number,
): WorkspaceItem[] {
  const items: WorkspaceItem[] = []
  for (const owner of overviews) {
    const workspace = owner.snapshot?.workspace
    const computer = runtimeComputerName(owner)
    for (const task of workspace?.tasks ?? []) {
      if (task.archivedAt || task.example || task.sideThread) continue
      const repository = workspace?.repositories.find((entry) => entry.id === task.repositoryId)
      const needsInput =
        !!owner.snapshot?.approvals.some((entry) => entry.taskId === task.id) ||
        !!owner.snapshot?.questions.some((entry) => entry.taskId === task.id)
      const section: WorkspaceSection = task.archived
        ? 'settled'
        : isSnoozed(task, now)
          ? 'snoozed'
          : task.pinned
            ? 'pinned'
            : needsInput
              ? 'needs-input'
              : taskIsWorking(task)
                ? 'working'
                : task.waitingForFeedback
                  ? 'waiting'
                  : 'active'
      items.push({
        kind: 'thread',
        key: JSON.stringify(['thread', owner.profile.id, task.id]),
        runtimeId: owner.profile.id,
        task,
        repository,
        needsInput,
        title: task.title,
        detail: `${repository?.kind === 'scratch' ? 'No Project' : (repository?.name ?? 'Project')} · ${computer}`,
        status: task.archived
          ? 'Settled'
          : needsInput
            ? 'Needs input'
            : taskIsWorking(task)
              ? 'Working'
              : task.waitingForFeedback
                ? 'Waiting'
                : task.status === 'failed'
                  ? 'Failed'
                  : task.status === 'draft'
                    ? 'Draft'
                    : 'Ready',
        section,
        pinned: !!task.pinned,
        offline: !owner.connected,
      })
    }
    for (const terminal of owner.snapshot?.terminals ?? []) {
      if (terminal.taskId !== STUDIO_TERMINAL_SCOPE) continue
      const repository = workspace?.repositories.find((entry) => entry.id === terminal.repositoryId)
      const status = terminalStatus(terminal, owner.connected)
      const section: WorkspaceSection = terminal.settledAt
        ? 'settled'
        : terminal.snoozedUntil && Date.parse(terminal.snoozedUntil) > now
          ? 'snoozed'
          : terminal.pinned
            ? 'pinned'
            : status.section
      items.push({
        kind: 'terminal',
        key: JSON.stringify(['terminal', owner.profile.id, terminal.id]),
        runtimeId: owner.profile.id,
        terminal,
        repository,
        title: terminal.title,
        detail: `${repository?.name ?? 'Home folder'}${terminal.checkoutBranch ? ` · ${terminal.checkoutBranch}` : ''} · ${computer}`,
        status: status.label,
        section,
        pinned: !!terminal.pinned,
        offline: !owner.connected,
      })
    }
  }
  for (const tab of tabs) {
    if (!tab.url || tab.previewOf || isPrivateBrowserProfile(tab.profileId)) continue
    const owner =
      tab.kind === 'remote'
        ? overviews.find((entry) => entry.profile.id === tab.runtimeId)
        : undefined
    const category = browserTabCategory(tab, now)
    items.push({
      kind: 'browser',
      key: JSON.stringify(['browser', tab.id]),
      tab,
      title: tab.title || tab.url,
      detail: `${new URL(tab.url).host} · ${tab.kind === 'remote' ? (owner ? runtimeComputerName(owner) : 'Unpaired computer') : 'This device'}`,
      status: category === 'settled' ? 'Settled' : category === 'snoozed' ? 'Snoozed' : 'Page',
      section: category === 'active' && tab.pinned ? 'pinned' : category,
      pinned: !!tab.pinned,
      offline: tab.kind === 'remote' && !owner?.connected,
    })
  }
  // Keep the pinned page tiles first, then threads and shells. Other sections stay mixed.
  return items.sort(
    (a, b) =>
      Number(b.section === 'pinned' && b.kind === 'browser') -
      Number(a.section === 'pinned' && a.kind === 'browser'),
  )
}
