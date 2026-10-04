import type { ReactNode } from 'react'
import { ChevronRight, FolderGit2, Globe2, Layers, Monitor } from 'lucide-react'
import {
  settingsProjectChoices,
  settingsScopeLabels,
  settingsScopeDescriptions,
  settingsScopes,
  settingsTargetAtScope,
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
  const icons = {
    global: Globe2,
    environment: Monitor,
    project: FolderGit2,
    'environment-project': Layers,
  }
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title={title} description={description} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-3xl'} space-y-6`}>
          <div className="overflow-hidden rounded-xl border bg-card/40">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <p className="flex items-center gap-2 text-xs font-medium">
                <Layers className="size-3.5 text-muted-foreground" />
                Settings scope
              </p>
              <span className="text-xs text-muted-foreground">
                Later levels override earlier ones
              </span>
            </div>
            <ol
              aria-label="Settings inheritance"
              className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4"
            >
              {settingsScopes.map((level, index) => {
                const Icon = icons[level]
                const next = settingsTargetAtScope(sources, target, level, source?.profile.id)
                const active = scope === level
                return (
                  <li key={level} className="relative min-w-0">
                    <button
                      type="button"
                      aria-label={`Edit ${settingsScopeLabels[level]} settings`}
                      aria-pressed={active}
                      disabled={!next}
                      onClick={() => next && setTarget(next)}
                      title={
                        !next
                          ? level === 'environment'
                            ? 'Connect a computer first'
                            : 'Add a project on a connected computer first'
                          : settingsScopeDescriptions[level]
                      }
                      className={`flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${active ? 'border-primary/40 bg-primary/8' : 'border-transparent hover:border-border hover:bg-muted/70'}`}
                    >
                      <span
                        className={`flex items-center gap-2 text-xs font-medium ${active ? 'text-primary' : 'text-foreground'}`}
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span className="min-w-0">{settingsScopeLabels[level]}</span>
                        <span className="ml-auto text-[10px] opacity-60">{index + 1}</span>
                      </span>
                      <span className="hidden text-[11px] leading-relaxed text-muted-foreground sm:block">
                        {settingsScopeDescriptions[level]}
                      </span>
                    </button>
                    {index < 3 && (
                      <ChevronRight
                        aria-hidden="true"
                        className="absolute -right-2.5 top-5 z-10 hidden size-3 text-muted-foreground/50 lg:block"
                      />
                    )}
                  </li>
                )
              })}
            </ol>
            <div className="grid gap-3 border-t px-4 py-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">Project</p>
                <ChoicePicker
                  aria-label="Settings project"
                  className="h-9 bg-background/60"
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
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">Computer</p>
                <ChoicePicker
                  aria-label="Settings computer"
                  className="h-9 bg-background/60"
                  value={target.environmentId}
                  onValueChange={(environmentId) => setTarget({ ...target, environmentId })}
                >
                  <option value="">All computers · shared</option>
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 text-xs">
              <p>
                <span className="font-medium">Editing {settingsScopeLabels[scope]} defaults</span>
                <span className="ml-2 text-muted-foreground">
                  {target.environmentId
                    ? `${source?.name ?? 'Selected computer'}${repository ? ` · ${repository.name}` : ''}`
                    : repository
                      ? `${repository.name} · shared across computers`
                      : 'Shared across your connected computers'}
                </span>
              </p>
              <details className="group text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  How inheritance works
                </summary>
                <p className="mt-2 max-w-xl leading-relaxed">
                  Settings flow from Global → Computer → Project → Project on computer. A value set
                  at a later level wins. Choose “Inherit” or reset an override to use the earlier
                  value. Shared defaults sync to paired computers. Sync changes the shared layer;
                  your other overrides stay saved.
                </p>
              </details>
            </div>
          </div>
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
        </div>
      </div>
    </section>
  )
}
