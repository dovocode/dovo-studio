import type { ComponentType } from 'react'
import type { Extension, ExtensionManifest } from '@dovo/client-runtime'

export type StudioIcon =
  | 'tasks'
  | 'artifacts'
  | 'issues'
  | 'jira'
  | 'scm'
  | 'pulls'
  | 'pipelines'
  | 'agents'
  | 'jobs'
  | 'runtime'
export interface StudioNavigation {
  viewId: string
  entityId?: string
}
export interface StudioViewProps {
  entityId?: string
}
/** Settings sidebar headings, grouped the way Codex and T3 Code organize theirs. */
export type SettingsSection = 'app' | 'agents' | 'coding' | 'computers' | 'archived'
export interface StudioView {
  navigationGroup?: 'settings' | 'hidden'
  /** Heading a settings page is listed under. */
  settingsSection?: SettingsSection
  /** Extra words settings search matches, e.g. the controls a page contains. */
  keywords?: string
  id: string
  title: string
  icon: StudioIcon
  order: number
  load: () => Promise<{ default: ComponentType<StudioViewProps> }>
}
export interface StudioCommand {
  id: string
  title: string
  run: () => void
}
export interface StudioHostApi {
  appInfo?: { version: string; channel: 'stable' | 'nightly' | 'dev' }
  updates?: import('@dovo/protocol').DesktopUpdateBridge
  taskLauncher?: import('@dovo/protocol').TaskLauncherBridge
  browser?: import('@dovo/protocol').BrowserBridge
  /** Ask where a link should open; true requests the thread sidebar browser. */
  chooseLink?: (url: string) => Promise<boolean>
  pickDirectory?: (runtimeAddress: string) => Promise<string | null>
  navigate: (target: StudioNavigation) => void
  registerCommand: (command: StudioCommand) => () => void
}
export interface StudioExtension {
  manifest: ExtensionManifest
  views: readonly StudioView[]
  createRuntime: (api: StudioHostApi) => Extension
}
export function defineStudioExtension(
  manifest: ExtensionManifest,
  views: readonly StudioView[],
): StudioExtension {
  const contributionManifest: ExtensionManifest = {
    ...manifest,
    activationEvents: [
      ...new Set([
        ...(manifest.activationEvents ?? []),
        ...views.map((view) => `onView:${view.id}` as const),
      ]),
    ],
    contributes: {
      ...manifest.contributes,
      views: {
        ...manifest.contributes?.views,
        workbench: views.map((view) => ({ id: view.id, name: view.title })),
      },
      commands: [
        ...(manifest.contributes?.commands ?? []),
        ...views
          .filter((view) => view.navigationGroup !== 'hidden')
          .map((view) => ({
            command: `${manifest.id}.open.${view.id}`,
            title: `Open ${view.title}`,
          })),
      ],
    },
  }
  return {
    manifest: contributionManifest,
    views,
    createRuntime: (api) => ({
      manifest: contributionManifest,
      activate(context) {
        for (const view of views) {
          if (view.navigationGroup === 'hidden') continue
          const command = {
            id: `${manifest.id}.open.${view.id}`,
            title: `Open ${view.title}`,
            run: () => api.navigate({ viewId: view.id }),
          }
          const unregister = api.registerCommand(command)
          context.subscriptions.push({ dispose: unregister })
          context.commands.registerCommand(command.id, command.run)
        }
      },
    }),
  }
}
