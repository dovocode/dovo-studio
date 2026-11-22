import type { StudioCommand, StudioView } from '@dovo/studio-core'
import { workspaceModeVisible } from './activity-bar'

/** Preferences and runtime capabilities that decide which sections the sidebar shows. */
export type NavigationAvailability = {
  botsOverviewEnabled: boolean
  browserWorkspaceEnabled: boolean
  unifiedWorkspaceEnabled: boolean
  unifiedWorkspaceHideNormalModes: boolean
  artifactsEnabled: boolean
  dashboardsEnabled?: boolean
  studioExtensionsEnabled?: boolean
  showIssues: boolean
  showJira: boolean
}

/** One rule for the sidebar and the command palette. */
export function navigationViewVisible(
  view: Pick<StudioView, 'id' | 'navigationGroup'>,
  availability: NavigationAvailability,
) {
  if (view.navigationGroup === 'hidden') return false
  if (!workspaceModeVisible(view.id, availability)) return false
  if (view.id === 'bots') return availability.botsOverviewEnabled
  if (view.id === 'workspace') return availability.unifiedWorkspaceEnabled
  if (view.id === 'browser') return availability.browserWorkspaceEnabled
  if (view.id === 'artifacts') return availability.artifactsEnabled
  if (view.id === 'studio-extensions') return availability.studioExtensionsEnabled === true
  if (view.id === 'dashboards') return availability.dashboardsEnabled === true
  if (view.id === 'issues') return availability.showIssues
  if (view.id === 'jira') return availability.showJira
  return true
}

/**
 * Palette entries in display order. Sections use the sidebar's availability and `openSection`, the
 * same action as a sidebar click. Thread actions stay available in every view: `openThreadCommand`
 * opens Threads and runs the command it registers. A command a mounted view registers replaces
 * the entry with the same ID.
 */
export function paletteCommands({
  views,
  availability,
  openSection,
  threadCommands,
  openThreadCommand,
  extra,
  registered,
}: {
  views: readonly (StudioView & { extensionId: string })[]
  availability: NavigationAvailability
  openSection: (viewId: string) => void
  threadCommands: readonly Omit<StudioCommand, 'run'>[]
  openThreadCommand: (id: string) => void
  extra: readonly StudioCommand[]
  registered: Iterable<StudioCommand>
}): StudioCommand[] {
  const visible = views.filter((view) => navigationViewVisible(view, availability))
  const sections = visible.map((view) => ({
    id: `${view.extensionId}.open.${view.id}`,
    title:
      view.navigationGroup === 'settings' ? `Open ${view.title} settings` : `Open ${view.title}`,
    ...(view.navigationGroup === 'settings' && view.keywords ? { aliases: [view.keywords] } : {}),
    run: () => openSection(view.id),
  }))
  const threads = visible.some((view) => view.id === 'tasks')
    ? threadCommands.map((command) => ({ ...command, run: () => openThreadCommand(command.id) }))
    : []
  return [
    ...new Map(
      [...sections, ...threads, ...extra, ...registered].map((command) => [command.id, command]),
    ).values(),
  ]
}
