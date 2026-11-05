import type { ReactNode } from 'react'
import { Layers } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import {
  settingsProjectChoices,
  settingsScopeSummary,
  type Repository,
  type SettingsScope,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { useSettingsTarget, useStudioHost, WorkspaceScope } from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { Button } from './components/ui/button'
import { SettingsPage, SettingsStorageInfo } from './settings-layout'
import { ProjectOrganizationSettings } from './project-organization'

/** Scoped settings share a persistent project and computer target within the scrollport. */
export function SettingsScopePage({
  title,
  description,
  children,
  wide = false,
  saveInfo,
  supportsEditing,
  offlineRecovery = false,
  localChildren,
}: {
  localChildren?: ReactNode
  title: string
  wide?: boolean
  saveInfo?: string | ((snapshot?: RuntimeSnapshot | null) => string | undefined)
  supportsEditing?: (snapshot?: RuntimeSnapshot | null) => boolean
  offlineRecovery?: boolean
  description: string
  children: (selection: { scope: SettingsScope; repository?: Repository }) => ReactNode
}) {
  const host = useStudioHost()
  const { target, setTarget, sources, source, scope, repository } = useSettingsTarget()
  const editable = source?.connected === true && (supportsEditing?.(source.snapshot) ?? true)
  const saveHint = editable
    ? typeof saveInfo === 'function'
      ? saveInfo(source.snapshot)
      : saveInfo
    : undefined
  const projects = settingsProjectChoices(sources, target.environmentId)
  const summary = settingsScopeSummary(scope, { project: repository?.name, computer: source?.name })
  const projectName = target.projectId
    ? (repository?.name ??
      settingsProjectChoices(sources, '').find((project) => project.id === target.projectId)
        ?.name ??
      'unavailable project')
    : 'all projects'
  const computerName = target.environmentId
    ? (sources.find((entry) => entry.profile.id === target.environmentId)?.name ??
      'unavailable computer')
    : 'all computers'
  const scopeLabel = target.projectId
    ? target.environmentId
      ? 'Project overrides'
      : 'Project defaults'
    : target.environmentId
      ? 'Computer overrides'
      : 'Shared defaults'
  return (
    <SettingsPage
      title={title}
      description={description}
      wide={wide}
      toolbar={
        <div
          className="studio-settings-target"
          data-override={scope !== 'global' || undefined}
          aria-label="Settings target"
        >
          <div className="mb-3 flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1">
            <SettingsStorageInfo>
              <span className="studio-settings-target-context">
                {editable ? 'Editing' : 'Viewing'} {projectName} on {computerName}
              </span>
              {saveHint && (
                <>
                  {' '}
                  · <span>{saveHint}</span>
                </>
              )}
            </SettingsStorageInfo>
            {source && !source.connected && (
              <span role="status" className="text-[0.8125rem] leading-normal text-foreground/80">
                {source.name} is offline. Reconnect to edit or save.
              </span>
            )}
            {offlineRecovery && source && !source.connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => host.navigate({ viewId: 'runtime' })}
              >
                Open Devices & runtime
              </Button>
            )}
          </div>
          <div className="studio-settings-target-inner flex flex-wrap items-end gap-x-4 gap-y-3 text-xs">
            <div className="studio-settings-target-field min-w-0 max-w-full">
              <span className="studio-settings-target-label">Scope</span>
              <div className="studio-settings-target-summary flex min-h-9 items-center gap-1">
                <span className="break-words font-medium">{scopeLabel}</span>
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 shrink-0 p-0"
                      aria-label="Settings inheritance details"
                      title={summary.title}
                    >
                      <Layers className="size-4" aria-hidden="true" />
                    </Button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      align="start"
                      sideOffset={8}
                      className="studio-menu-surface z-50 w-72 max-w-[calc(100vw-24px)] space-y-2 rounded-lg border bg-popover p-3 text-xs text-popover-foreground"
                    >
                      <p className="font-semibold">
                        {editable ? 'Editing' : 'Viewing'} {summary.title}
                      </p>
                      <p>{summary.description}</p>
                      <p className="text-muted-foreground">{summary.storage}</p>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>
            </div>
            <label className="studio-settings-target-field min-w-0 max-w-full">
              <span className="studio-settings-target-label">Project</span>
              <ChoicePicker
                aria-label="Settings project"
                className="h-9 w-auto min-w-40 max-w-full bg-background/60"
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
                    {project.archived ? ' · Archived' : ''}
                  </option>
                ))}
              </ChoicePicker>
            </label>
            {sources.length > 0 && (
              <label className="studio-settings-target-field min-w-0 max-w-full">
                <span className="studio-settings-target-label">Computer</span>
                <ChoicePicker
                  aria-label="Settings computer"
                  className="h-9 w-auto min-w-40 max-w-full bg-background/60"
                  value={target.environmentId}
                  onValueChange={(environmentId) => setTarget({ ...target, environmentId })}
                >
                  <option value="">All computers</option>
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
              </label>
            )}
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
          {repository && <ProjectOrganizationSettings repository={repository} compact />}
          {children({ scope, repository })}
        </WorkspaceScope>
      )}
      {localChildren}
    </SettingsPage>
  )
}
