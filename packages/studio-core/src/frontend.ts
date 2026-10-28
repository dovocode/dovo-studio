import type { ComponentType } from 'react'
import type { Extension, ExtensionManifest } from '@dovo/client-runtime'

export type StudioIcon =
  | 'tasks'
  | 'browser'
  | 'artifacts'
  | 'issues'
  | 'jira'
  | 'scm'
  | 'pulls'
  | 'pipelines'
  | 'agents'
  | 'jobs'
  | 'runtime'
export interface StudioThreadReference {
  runtimeId: string | null
  runtimeIdentity?: string
  threadId: string
  title: string
  /** Read-only provider agent inside this owning Studio thread. */
  nativeAgentKey?: string
}
export interface StudioNavigation {
  viewId: string
  entityId?: string
  pullTarget?: StudioPullTarget
  nativeAgentKey?: string
  threadParent?: StudioThreadReference
  threadConnection?: StudioThreadReference & { parent?: StudioThreadReference }
}
/** The entity's origin survives transport handoff and shell history. */
export interface StudioPullTarget {
  runtimeId: string
  repositoryId?: string
  number: number
  url?: string
  tab?: 'overview' | 'changes' | 'checks'
  fragment?: string
  connectionId?: string
}
export interface StudioViewProps {
  nativeAgentKey?: string
  threadParent?: StudioThreadReference
  threadConnection?: StudioThreadReference & { parent?: StudioThreadReference }
  entityId?: string
  pullTarget?: StudioPullTarget
  /** Changes for explicit navigation, including reopening the same destination. */
  navigationKey?: number
}
/** Settings sidebar headings, grouped the way Codex and T3 Code organize theirs. */
export type SettingsSection = 'app' | 'agents' | 'coding' | 'computers' | 'archived'
export type SettingsStorage = 'device' | 'computer' | 'inherited'
export interface StudioView {
  navigationGroup?: 'settings' | 'hidden'
  /** Searchable control labels; used without loading a settings page. */
  settingsFields?: readonly string[]
  /** Requirements for controls that only appear in some targets or editors. */
  settingsFieldRequirements?: Readonly<Record<string, string>>
  /** Heading a settings page is listed under. */
  settingsSection?: SettingsSection
  /** Where a settings page stores values: this device, one computer, or the inherited
   * Global → Computer → Project → Project on computer levels. */
  settingsScope?: SettingsStorage
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
  /** Deliberate search terms; title matches stay ahead of alias-only results. */
  readonly aliases?: readonly string[]
  run: () => void
}
export interface StudioHostApi {
  accountStorage?: import('@dovo/protocol').AccountStorage
  appInfo?: { version: string; channel: 'stable' | 'nightly' | 'dev' }
  updates?: import('@dovo/protocol').DesktopUpdateBridge
  popOutThread?: import('@dovo/protocol').ThreadWindowBridge
  threadWindow?: boolean
  taskLauncher?: import('@dovo/protocol').TaskLauncherBridge
  browserWindowId?: string
  openBrowserWindow?: () => Promise<void>
  defaultBrowser?: import('@dovo/protocol').DefaultBrowserBridge
  browser?: import('@dovo/protocol').BrowserBridge
  browserFrames?: import('@dovo/protocol').BrowserFrameBridge
  onBrowserContextAction?: (
    listener: (action: import('@dovo/protocol').BrowserContextAction) => void,
  ) => () => void
  browserExtensions?: import('@dovo/protocol').BrowserExtensionBridge
  /** Opens a recognized forge PR in native details; false leaves normal link handling. */
  openPullLink?: (url: string, origin?: { runtimeId?: string; repositoryId?: string }) => boolean
  /** A handoff is valid only while its initiating view and navigation are still current. */
  taskNavigationGuard?: () => () => boolean
  openLink?: (url: string, options?: import('./links').LinkOptions) => void
  getLinkActions?: (
    url: string,
    options?: import('./links').LinkOptions,
  ) => import('./links').LinkAction[]
  openBrowserLink?: (url: string) => Promise<void>
  openPipelineLink?: (
    url: string,
    origin?: { runtimeId?: string; repositoryId?: string },
  ) => boolean
  openExternalLink?: (url: string) => Promise<void>
  repositoryOpener?: import('@dovo/protocol').RepositoryOpenerBridge
  pickDirectory?: (runtimeAddress: string) => Promise<string | null>
  openThread?: (target: StudioThreadReference & { parent?: StudioThreadReference }) => void
  goBack?: () => boolean
  navigate: (target: StudioNavigation, options?: { replace?: boolean }) => void
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
            ...(view.navigationGroup === 'settings' && view.keywords
              ? { aliases: [view.keywords] }
              : {}),
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

export { useTaskWaiting } from './use-task-waiting'
