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

export const settingsScopeIcons = {
  global: Globe2,
  environment: Monitor,
  project: FolderGit2,
  'environment-project': Layers,
} as const

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
  const detail = target.environmentId
    ? `${source?.name ?? 'Selected computer'}${repository ? ` · ${repository.name}` : ''}`
    : repository
      ? `${repository.name} · shared across computers`
      : 'Shared across your connected computers'
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title={title} description={description} />
      <div className="shrink-0 border-b bg-card/40" aria-label="Settings target">
        <div className={`mx-auto ${width} space-y-2.5 px-4 py-3 sm:px-6`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">Apply to</span>
            <ChoicePicker
              aria-label="Settings project"
              className="h-8 w-auto min-w-40 max-w-full bg-background/60"
              value={target.projectId}
              onValueChange={(projectId) => setTarget({ ...target, projectId })}
            >
              <option value="">All projects</option>
              {target.projectId && !projects.some((project) => project.id === target.projectId) && (
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
              aria-label="Settings computer"
              className="h-8 w-auto min-w-40 max-w-full bg-background/60"
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
            <span className="min-w-0 text-muted-foreground sm:ml-auto">
              <span className="font-medium text-foreground">
                Editing {settingsScopeLabels[scope]}
              </span>
              {' · '}
              {detail}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ol aria-label="Settings inheritance" className="flex flex-wrap items-center gap-1">
              {settingsScopes.map((level, index) => {
                const Icon = settingsScopeIcons[level]
                const next = settingsTargetAtScope(sources, target, level, source?.profile.id)
                const active = scope === level
                const passed = settingsScopes.indexOf(scope) > index
                return (
                  <li key={level} className="flex items-center gap-1">
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
                          : `${settingsScopeDescriptions[level]}${passed ? ' · inherited by the level you are editing' : ''}`
                      }
                      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
                        active
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : passed
                            ? 'border-transparent text-foreground hover:border-border hover:bg-muted/70'
                            : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground'
                      }`}
                    >
                      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">{settingsScopeLabels[level]}</span>
                    </button>
                    {index < settingsScopes.length - 1 && (
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3 shrink-0 text-muted-foreground/50"
                      />
                    )}
                  </li>
                )
              })}
            </ol>
            <details className="group text-[11px] text-muted-foreground sm:ml-auto">
              <summary className="cursor-pointer hover:text-foreground">
                How inheritance works
              </summary>
              <p className="mt-2 max-w-xl leading-relaxed">
                Global defaults apply everywhere. Computer and project settings override them;
                Project on computer is the most specific level. Each control shows its source.
                Choose “Inherit” or reset an override to use the earlier value. Global and project
                defaults sync to paired computers; computer overrides stay on their computer.
              </p>
            </details>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className={`mx-auto ${width} space-y-6`}>
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
