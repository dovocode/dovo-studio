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
          Choose a project. You can switch devices before sending your first message.
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
                        : `${source.name} · ${repository.branch}`}
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
