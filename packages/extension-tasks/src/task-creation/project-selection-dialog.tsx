import { projectMachineGroups } from '@dovo/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  cn,
} from '@dovo/studio-ui'
import { ChevronRight, Folder, Monitor } from 'lucide-react'
import { useMemo } from 'react'
import { taskCollectionKey, type TaskSource } from '../task-collection'

type ProjectSelectionDialogProps = {
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
  onOpenChange,
  sources,
  busy,
  error,
  projectQuery,
  onProjectQueryChange,
  suggestedProject,
  onSelect,
}: ProjectSelectionDialogProps) {
  const projectGroups = useMemo(
    () =>
      open
        ? projectMachineGroups(
            sources.flatMap((source) =>
              source.workspace.repositories.map((repository) => ({
                repository,
                runtimeId: source.runtimeId,
                source,
              })),
            ),
          )
        : [],
    [sources, open],
  )
  const normalizedProjectQuery = projectQuery.trim().toLowerCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>New task</DialogTitle>
        <DialogDescription>
          Choose a project, then a device if it’s available on more than one. Nothing runs until you
          send your first message.
        </DialogDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Input
          aria-label="Search projects and devices"
          placeholder="Search projects or devices…"
          value={projectQuery}
          onChange={(event) => onProjectQueryChange(event.target.value)}
        />
        <div className="max-h-[55dvh] space-y-3 overflow-y-auto">
          {projectGroups.map((group) => {
            const matches = group.entries.filter(({ repository, source }) =>
              `${repository.gitIdentity ?? ''} ${repository.name} ${repository.path} ${source.name}`
                .toLowerCase()
                .includes(normalizedProjectQuery),
            )
            if (!matches.length) return null
            if (group.entries.length === 1) {
              const { source, repository } = group.entries[0]
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
                      {source.name} · {repository.branch}
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
            return (
              <details
                key={`${group.key}:${!!projectQuery}`}
                open={normalizedProjectQuery ? true : undefined}
                className="group rounded-lg border border-border/50"
                aria-label={group.name}
              >
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                  <Folder className="size-3.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{group.name}</span>
                    <span className="block truncate text-[0.625rem]">
                      {group.identity ?? 'Local repository'}
                    </span>
                  </span>
                  <span className="ml-auto">
                    {
                      new Set(
                        group.entries
                          .filter(({ source }) => source.online)
                          .map((entry) => entry.runtimeId),
                      ).size
                    }
                    /{new Set(group.entries.map((entry) => entry.runtimeId)).size} online
                  </span>
                  <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                </summary>
                {matches.map(({ repository, source }) => {
                  const key = taskCollectionKey(source.runtimeId, repository.id)
                  return (
                    <Button
                      key={key}
                      variant="ghost"
                      disabled={busy || !source.online || !!repository.gitIdentityError}
                      className={cn(
                        'h-auto w-full justify-start gap-2 px-3 py-2 text-left',
                        key === suggestedProject && 'bg-muted/50',
                      )}
                      onClick={() => onSelect(key)}
                    >
                      <Monitor className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {source.name}
                          {!source.online ? ' · Offline' : ''}
                        </span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {repository.gitIdentityError ??
                            `${repository.path} · ${repository.branch}`}
                        </span>
                      </span>
                    </Button>
                  )
                })}
              </details>
            )
          })}
          {projectQuery &&
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
          {!sources.some((source) => source.workspace.repositories.length) && (
            <p className="py-4 text-sm text-muted-foreground">
              Add a project from the Projects menu to start a task.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
