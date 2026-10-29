import type { ReactNode } from 'react'
import { Layers } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import {
  settingsProjectChoices,
  settingsScopeSummary,
  type Repository,
  type SettingsScope,
} from '@dovo/protocol'
import { useSettingsTarget, WorkspaceScope } from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { Button } from './components/ui/button'
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
          <div className={`mx-auto ${width} flex flex-wrap items-center gap-2 text-xs`}>
            <span className="max-w-full break-words text-xs font-medium">{summary.title}</span>
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
                  <p className="font-semibold">Editing {summary.title}</p>
                  <p>{summary.description}</p>
                  <p className="text-muted-foreground">{summary.storage}</p>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            {source && !source.connected && (
              <span role="status" className="text-xs text-muted-foreground">
                Offline · edits kept here
              </span>
            )}
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
            {sources.length > 1 && (
              <>
                <span className="text-muted-foreground">on</span>
                <ChoicePicker
                  aria-label="Settings machine"
                  className="h-8 w-auto min-w-40 max-w-full bg-background/60"
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
              </>
            )}
            {sources.length === 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const environmentId = target.environmentId ? '' : sources[0].profile.id
                  const choices = settingsProjectChoices(sources, environmentId)
                  setTarget({
                    environmentId,
                    projectId: choices.some((project) => project.id === target.projectId)
                      ? target.projectId
                      : '',
                  })
                }}
              >
                {target.environmentId ? 'Edit shared defaults' : 'Edit computer overrides'}
              </Button>
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
