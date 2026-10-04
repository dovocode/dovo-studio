import { useAppPreferences, projectActivity } from '@dovo/studio-core'
import { projectMachineGroups } from '@dovo/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@dovo/studio-ui'
import { ChevronRight, Folder, Monitor } from 'lucide-react'
import { useMemo } from 'react'
import { taskCollectionKey, type TaskSource } from '../list/task-collection'

type ProjectSelectionDialogProps = {
  noProject: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: TaskSource[]
  busy: boolean
  error: string
  projectQuery: string
  onProjectQueryChange: (query: string) => void
  suggestedProject: string
  onSelect: (projectKey: string) => void
}

export function ProjectSelectionDialog({
  open,
  noProject,
  onOpenChange,
  sources,
  busy,
  error,
  projectQuery,
  onProjectQueryChange,
  suggestedProject,
  onSelect,
}: ProjectSelectionDialogProps) {
  const preferences = useAppPreferences()
  const projectGroups = useMemo(
    () =>
      open
        ? projectMachineGroups(
            sources.flatMap((source) =>
              source.workspace.repositories
                .filter((repository) =>
                  noProject ? repository.kind === 'scratch' : repository.kind !== 'scratch',
                )
                .map((repository) => ({
                  repository,
                  runtimeId: source.runtimeId,
                  source,
                })),
            ),
            preferences.projectGrouping,
          ).sort((a, b) => {
            const activity = (group: typeof a) =>
              Math.max(
                0,
                ...group.entries.map((entry) =>
                  projectActivity(
                    entry.source.workspace.tasks,
                    entry.repository.id,
                    preferences.projectOrder,
                  ),
                ),
              )
            return (
              (preferences.projectOrder === 'name' ? 0 : activity(b) - activity(a)) ||
              a.name.localeCompare(b.name)
            )
          })
        : [],
    [sources, open, noProject, preferences.projectGrouping, preferences.projectOrder],
  )
  const normalizedProjectQuery = projectQuery.trim().toLowerCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{noProject ? 'New task without a project' : 'New task'}</DialogTitle>
        <DialogDescription>
          {noProject
            ? 'Choose the machine where this task should run.'
            : 'Choose a project. Nothing runs until you send your first message.'}
        </DialogDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {!noProject && (
          <Input
            aria-label="Search projects and devices"
            placeholder="Search projects or devices…"
            value={projectQuery}
            onChange={(event) => onProjectQueryChange(event.target.value)}
          />
        )}
        {noProject &&
          sources.flatMap((source) =>
            source.workspace.repositories
              .filter((repository) => repository.kind === 'scratch')
              .map((repository) => (
                <Button
                  key={source.runtimeId ?? 'local'}
                  variant="outline"
                  disabled={busy || !source.online}
                  className="justify-start gap-2"
                  onClick={() => onSelect(taskCollectionKey(source.runtimeId, repository.id))}
                >
                  <Monitor className="size-4" /> {source.name}
                  {source.online ? '' : ' · Offline'}
                </Button>
              )),
          )}
        <div className="max-h-[55dvh] space-y-3 overflow-y-auto">
          {!noProject &&
            projectGroups.map((group) => {
              const matches = group.entries.filter(({ repository, source }) =>
                `${repository.gitIdentity ?? ''} ${repository.name} ${repository.path} ${source.name}`
                  .toLowerCase()
                  .includes(normalizedProjectQuery),
              )
              if (!matches.length) return null
              const preferred =
                matches.find(
                  ({ source, repository }) =>
                    taskCollectionKey(source.runtimeId, repository.id) === suggestedProject &&
                    source.online &&
                    !repository.gitIdentityError,
                ) ??
                matches.find(
                  ({ source, repository }) => source.online && !repository.gitIdentityError,
                )
              const choice = preferred ?? matches[0]
              if (choice) {
                const { source, repository } = choice
                const deviceCount = new Set(group.entries.map((entry) => entry.runtimeId)).size
                const onlineCount = new Set(
                  group.entries
                    .filter((entry) => entry.source.online)
                    .map((entry) => entry.runtimeId),
                ).size
                return (
                  <Button
                    key={group.key}
                    variant="outline"
                    disabled={busy || !source.online || !!repository.gitIdentityError}
                    className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-3 text-left"
                    onClick={() => onSelect(taskCollectionKey(source.runtimeId, repository.id))}
                  >
                    <Folder className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{group.name}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                        <Monitor className="size-3" />
                        {deviceCount > 1
                          ? `${deviceCount} devices · ${onlineCount} online${normalizedProjectQuery && matches.length === 1 ? ` · ${source.name}` : ''}`
                          : `${source.name}${repository.branch ? ` · ${repository.branch}` : ''}`}
                      </span>
                      {!!repository.gitIdentityError && (
                        <span className="block text-xs text-destructive">
                          {repository.gitIdentityError}
                        </span>
                      )}
                    </span>
                    {source.online ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <span className="text-xs">Offline</span>
                    )}
                  </Button>
                )
              }
              return null
            })}
          {!noProject &&
            projectQuery &&
            !sources.some((source) =>
              source.workspace.repositories.some((repository) =>
                `${repository.gitIdentity ?? ''} ${repository.name} ${repository.path} ${source.name}`
                  .toLowerCase()
                  .includes(normalizedProjectQuery),
              ),
            ) && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No matching projects or devices.
              </p>
            )}
          {!noProject &&
            !sources.some((source) =>
              source.workspace.repositories.some((repository) => repository.kind !== 'scratch'),
            ) && (
              <p className="py-4 text-sm text-muted-foreground">
                Add a project from the Projects menu to start a task.
              </p>
            )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
