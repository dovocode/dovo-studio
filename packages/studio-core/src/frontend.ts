import type { ComponentType } from 'react'
import type { Extension, ExtensionManifest } from '@dovo/client-runtime'

export type StudioIcon =
  | 'tasks'
  | 'issues'
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
export interface StudioView {
  navigationGroup?: 'settings' | 'hidden'
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
  browser?: import('@dovo/protocol').BrowserBridge
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
