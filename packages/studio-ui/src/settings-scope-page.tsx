import type { ReactNode } from 'react'
import {
  settingsProjectChoices,
  settingsScopeLabels,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { useSettingsTarget, WorkspaceScope } from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { PageHeader } from './page-header'

/** Retained across scoped settings pages; app-only preferences have no target header. */
export function SettingsScopePage({
  title,
  description,
  children,
  wide = false,
}: {
  title: string
  wide?: boolean
  description: string
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
}) {
  const { target, setTarget, sources, source, scope, repository } = useSettingsTarget()
  const projects = settingsProjectChoices(sources, target.environmentId)
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} description={description} />
      <div className="border-b px-4 py-3">
        <div
          className={`mx-auto flex ${wide ? 'max-w-6xl' : 'max-w-3xl'} flex-wrap items-center gap-2 text-xs text-muted-foreground`}
        >
          <span>Applying settings for</span>
          <ChoicePicker
            aria-label="Settings project"
            className="h-8 max-w-72 rounded-md px-2"
            value={target.projectId}
            onValueChange={(projectId) => setTarget({ ...target, projectId })}
          >
            <option value="">All projects</option>
            {target.projectId && !projects.some((project) => project.id === target.projectId) && (
              <option value={target.projectId}>Project unavailable on this environment</option>
            )}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </ChoicePicker>
          <span>on</span>
          <ChoicePicker
            aria-label="Settings environment"
            className="h-8 max-w-72 rounded-md px-2"
            value={target.environmentId}
            onValueChange={(environmentId) => setTarget({ ...target, environmentId })}
          >
            <option value="">Shared across environments</option>
            {target.environmentId &&
              !sources.some((entry) => entry.profile.id === target.environmentId) && (
                <option value={target.environmentId}>Environment unavailable</option>
              )}
            {sources.map((entry) => (
              <option key={entry.profile.id} value={entry.profile.id}>
                {entry.name}
                {entry.connected ? '' : ' · Offline'}
              </option>
            ))}
          </ChoicePicker>
          <span className="ml-auto">{settingsScopeLabels[scope]}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-3xl'} space-y-4`}>
          {!source ? (
            <p role="status" className="text-sm text-muted-foreground">
              {sources.length
                ? 'This project is not available on the selected environment. Choose another target.'
                : 'Connect a computer to configure defaults and project tools.'}
            </p>
          ) : (
            <WorkspaceScope
              key={`${source.scope}:${scope}:${repository?.id ?? ''}`}
              profile={source.profile}
            >
              <p className="text-xs text-muted-foreground">
                {target.environmentId
                  ? `Overrides on ${source.name}.`
                  : 'Shared settings sync to your connected computers.'}{' '}
                Unset values inherit earlier levels.
              </p>
              {!source.connected && (
                <p role="status" className="text-xs text-muted-foreground">
                  {source.name} is offline. Reconnect to make changes.
                </p>
              )}
              {children({ scope, repository })}
            </WorkspaceScope>
          )}
        </div>
      </div>
    </section>
  )
}
