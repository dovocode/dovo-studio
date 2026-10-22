import type { ReactNode } from 'react'
import { Layers } from 'lucide-react'
import {
  settingsProjectChoices,
  settingsScopeSummary,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { useSettingsTarget, WorkspaceScope } from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { SettingsPage } from './settings-layout'

/** Retained across scoped settings pages; app-only preferences have no target header. The
 * target bar stays visible above the scrolling page. */
export function SettingsScopePage({
  title,
  description,
  children,
  wide = false,
  localChildren,
}: {
  localChildren?: ReactNode
  title: string
  wide?: boolean
  description: string
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
}) {
  const { target, setTarget, sources, source, scope, repository } = useSettingsTarget()
  const projects = settingsProjectChoices(sources, target.environmentId)
  const width = wide ? 'max-w-6xl' : 'max-w-3xl'
  const summary = settingsScopeSummary(scope, { project: repository?.name, computer: source?.name })
  return (
    <SettingsPage
      title={title}
      description={description}
      wide={wide}
      toolbar={
        <div
          className="shrink-0 border-b bg-card/40 px-4 py-3 sm:px-6"
          aria-label="Settings target"
        >
          <div className={`mx-auto ${width} space-y-2.5`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                  Editing {summary.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {summary.description}
                </p>
              </div>
              <span className="max-w-full rounded-md border bg-background/60 px-2 py-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {summary.storage}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
              <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">Edit defaults for</span>
              <ChoicePicker
                aria-label="Settings project"
                className="h-8 w-auto min-w-40 max-w-full bg-background/60"
                value={target.projectId}
                onValueChange={(projectId) => setTarget({ ...target, projectId })}
              >
                <option value="">All projects</option>
                {target.projectId &&
                  !projects.some((project) => project.id === target.projectId) && (
                    <option value={target.projectId}>Project unavailable on this computer</option>
                  )}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </ChoicePicker>
              <span className="text-muted-foreground">on</span>
              <ChoicePicker
                aria-label="Settings machine"
                className="h-8 w-auto min-w-40 max-w-full bg-background/60"
                value={target.environmentId}
                onValueChange={(environmentId) => setTarget({ ...target, environmentId })}
              >
                <option value="">All machines</option>
                {target.environmentId &&
                  !sources.some((entry) => entry.profile.id === target.environmentId) && (
                    <option value={target.environmentId}>Computer unavailable</option>
                  )}
                {sources.map((entry) => (
                  <option key={entry.profile.id} value={entry.profile.id}>
                    {entry.name}
                    {entry.connected ? '' : ' · Offline'}
                  </option>
                ))}
              </ChoicePicker>
            </div>
          </div>
        </div>
      }
    >
      {!source ? (
        <p role="status" className="text-sm text-muted-foreground">
          {sources.length
            ? 'This project is not available on the selected computer. Choose another target.'
            : 'Connect a computer to configure defaults and project tools.'}
        </p>
      ) : (
        <WorkspaceScope
          key={`${source.scope}:${scope}:${repository?.id ?? ''}`}
          profile={source.profile}
        >
          {!source.connected && (
            <p role="status" className="text-xs text-muted-foreground">
              {source.name} is offline. Reconnect to make changes.
            </p>
          )}
          {children({ scope, repository })}
        </WorkspaceScope>
      )}
      {localChildren}
    </SettingsPage>
  )
}
