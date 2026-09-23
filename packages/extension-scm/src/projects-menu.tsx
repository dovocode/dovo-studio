import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { FolderGit2, ChevronDown, Plus, Settings2 } from 'lucide-react'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
} from '@dovo/studio-ui'
import { RepositoryDialog } from './repository-dialog'
import { RepositoryCheckouts } from './repository-checkouts'
import { ProjectForgeBinding } from './forge-repository'
export function ProjectsMenu({
  value,
  onChange,
  allDevices = false,
  compact = false,
  disabled = false,
}: {
  value: string
  onChange: (id: string) => void
  allDevices?: boolean
  compact?: boolean
  disabled?: boolean
}) {
  const { workspace, connection, activeRuntimeId, runtimes, connected, switchRuntime } =
    useWorkspace()
  const [adding, setAdding] = useApplicationState<{
    runtimeId: string | null
  } | null>(null)
  const [managing, setManaging] = useApplicationState<{
    runtimeId: string | null
    id: string
  } | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    if (adding && adding.runtimeId !== activeRuntimeId) setAdding(null)
    if (managing && managing.runtimeId !== activeRuntimeId) setManaging(null)
  }, [activeRuntimeId, adding, managing])
  const sources = [
    {
      runtimeId: activeRuntimeId,
      name:
        runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile.name ??
        'This computer',
      repositories: workspace.repositories,
      online: connected || !activeRuntimeId,
    },
    ...(allDevices
      ? runtimes
          .filter((entry) => entry.profile.id !== activeRuntimeId)
          .map((entry) => ({
            runtimeId: entry.profile.id,
            name: entry.profile.name,
            repositories: entry.snapshot?.workspace.repositories ?? [],
            online: entry.connected,
          }))
      : []),
  ]
  const projects = sources
    .flatMap((source) =>
      source.repositories.map((repository) => ({
        ...repository,
        source,
        key: allDevices ? JSON.stringify([source.runtimeId, repository.id]) : repository.id,
      })),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.source.name.localeCompare(b.source.name))
  const project = projects.find((entry) => entry.key === value)
  const managed =
    managing?.runtimeId === activeRuntimeId
      ? workspace.repositories.find((r) => r.id === managing.id)
      : undefined
  const open = async (runtimeId: string | null, repositoryId?: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (runtimeId && runtimeId !== activeRuntimeId) await switchRuntime(runtimeId)
      if (repositoryId)
        setManaging({
          runtimeId,
          id: repositoryId,
        })
      else
        setAdding({
          runtimeId,
        })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const itemClass =
    'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent data-[state=checked]:bg-accent data-[state=checked]:font-medium'
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            className={
              compact ? 'size-7 shrink-0 px-0' : 'h-7 w-full justify-start gap-2 px-2 text-[11px]'
            }
            title={project?.name ?? 'Projects'}
            aria-label="Projects"
            disabled={busy || disabled}
          >
            <FolderGit2 className="size-3.5 shrink-0" />
            {!compact && (
              <>
                <span className="min-w-0 flex-1 truncate">{project?.name ?? 'Projects'}</span>
                <ChevronDown className="size-3" />
              </>
            )}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 max-h-96 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-[10px] text-muted-foreground">
              Projects
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              <DropdownMenu.RadioItem value="" className={itemClass}>
                All projects
              </DropdownMenu.RadioItem>
              {projects.map((repo) => (
                <DropdownMenu.RadioItem
                  key={repo.key}
                  value={repo.key}
                  className={itemClass}
                  title={repo.path}
                >
                  <FolderGit2 className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{repo.name}</span>
                    {allDevices && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {repo.source.name}
                        {!repo.source.online ? ' · Offline' : ''}
                      </span>
                    )}
                  </span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {allDevices && sources.length > 1 ? (
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={itemClass}>
                  <Plus className="size-3.5" />
                  Add project
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                    <DropdownMenu.Label className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      Add to computer
                    </DropdownMenu.Label>
                    {sources.map((source) => (
                      <DropdownMenu.Item
                        key={source.runtimeId ?? 'local'}
                        className={`${itemClass} data-[disabled]:opacity-50`}
                        disabled={!source.online}
                        onSelect={() => void open(source.runtimeId)}
                      >
                        {source.name}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            ) : (
              <DropdownMenu.Item className={itemClass} onSelect={() => void open(activeRuntimeId)}>
                <Plus className="size-3.5" />
                Add project
              </DropdownMenu.Item>
            )}
            {project && (
              <DropdownMenu.Item
                className={`${itemClass} data-[disabled]:opacity-50`}
                disabled={!project.source.online && project.source.runtimeId !== activeRuntimeId}
                onSelect={() => void open(project.source.runtimeId, project.id)}
              >
                <Settings2 className="size-3.5" />
                Project settings
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {adding?.runtimeId === activeRuntimeId && adding && (
        <RepositoryDialog key={activeRuntimeId} projectLabels onClose={() => setAdding(null)} />
      )}
      <Dialog
        open={!!managed}
        onOpenChange={(open) => {
          if (!open) setManaging(null)
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{managed?.name}</DialogTitle>
            <DialogDescription className="break-all">{managed?.path}</DialogDescription>
          </DialogHeader>
          {managed && (
            <>
              <RepositoryCheckouts key={`${activeRuntimeId}:${managed.id}`} repo={managed} />
              <ProjectForgeBinding
                key={`forge-${connection?.address}-${managed.id}`}
                repo={managed}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
