import { projectMachineGroups } from '@dovo/protocol'
import { TaskDefaultSettings } from '@dovo/studio-ui'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import {
  FolderGit2,
  ChevronDown,
  Plus,
  Settings2,
  Monitor,
  Server,
  Search,
  Check,
} from 'lucide-react'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  Popover,
  Input,
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
  const [menuOpen, setMenuOpen] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
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
  const project = projects.find(
    (entry) =>
      entry.key === value ||
      (allDevices && entry.gitIdentity && `git:${entry.gitIdentity}` === value),
  )
  const projectGroups = allDevices
    ? projectMachineGroups(
        projects.map((repository) => ({ repository, runtimeId: repository.source.runtimeId })),
      )
    : projects.map((repository) => ({
        key: repository.key,
        name: repository.name,
        entries: [{ repository, runtimeId: repository.source.runtimeId }],
      }))
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
      <Popover.Root
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (!open) setQuery('')
        }}
      >
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            className={
              compact ? 'size-7 shrink-0 px-0' : 'h-7 w-full justify-start gap-2 px-2 text-[11px]'
            }
            title={project?.name ?? 'Projects'}
            aria-label="Filter threads by project"
            disabled={busy || disabled}
          >
            <FolderGit2 className="size-3.5 shrink-0" />
            {!compact && (
              <>
                <span className="min-w-0 flex-1 truncate">{project?.name ?? 'All projects'}</span>
                <ChevronDown className="size-3" />
              </>
            )}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 w-80 max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            <div className="flex items-center gap-2 border-b px-2 pb-2 pt-1">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Input
                aria-label="Search projects"
                placeholder="Search projects…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="max-h-80 overflow-y-auto py-1" aria-label="Project filters">
              <Button
                variant="ghost"
                aria-pressed={!value}
                className="h-10 w-full justify-start gap-2 px-2 font-normal"
                onClick={() => {
                  onChange('')
                  setMenuOpen(false)
                }}
              >
                <FolderGit2 className="size-4 text-muted-foreground" />
                All projects
                {!value && <Check className="ml-auto size-3.5 text-muted-foreground" />}
              </Button>
              {projectGroups
                .filter((group) =>
                  group.entries.some(({ repository: repo }) =>
                    `${repo.name} ${repo.gitIdentity ?? ''} ${repo.source.name} ${repo.path}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                  ),
                )
                .map((group) => {
                  const repo = group.entries[0].repository
                  const key = allDevices && repo.gitIdentity ? `git:${repo.gitIdentity}` : repo.key
                  const selected =
                    key === value ||
                    group.entries.some(({ repository }) => repository.key === value)
                  const machines = new Set(group.entries.map(({ runtimeId }) => runtimeId)).size
                  return (
                    <div
                      key={group.key}
                      className={`flex items-center rounded-lg transition-colors hover:bg-accent/40 ${selected ? 'bg-accent/60' : ''}`}
                    >
                      <button
                        type="button"
                        aria-pressed={selected}
                        className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={repo.gitIdentity ?? repo.path}
                        onClick={() => {
                          onChange(key)
                          setMenuOpen(false)
                        }}
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
                          {group.name
                            .split(/[^a-zA-Z0-9]+/)
                            .filter(Boolean)
                            .slice(-2)
                            .map((part) => part[0])
                            .join('')
                            .toUpperCase()}
                        </span>
                        <span className="truncate">{group.name}</span>
                      </button>
                      <span
                        title={group.entries
                          .map(
                            ({ repository }) =>
                              `${repository.source.name}${repository.source.online ? '' : ' · Offline'}`,
                          )
                          .join(', ')}
                        aria-label={`${machines} ${machines === 1 ? 'machine' : 'machines'}`}
                        className="px-1 text-muted-foreground"
                      >
                        {machines > 1 ? (
                          <Server className="size-3.5" />
                        ) : (
                          <Monitor className="size-3.5" />
                        )}
                      </span>
                      {group.entries.length === 1 ? (
                        <Button
                          variant="ghost"
                          className="size-8 shrink-0 px-0 text-muted-foreground"
                          aria-label={`Settings for ${group.name}`}
                          title={`Settings for ${group.name}`}
                          disabled={busy || !repo.source.online}
                          onClick={() => {
                            setMenuOpen(false)
                            void open(repo.source.runtimeId, repo.id)
                          }}
                        >
                          <Settings2 className="size-3.5" />
                        </Button>
                      ) : (
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <Button
                              variant="ghost"
                              className="size-8 shrink-0 px-0 text-muted-foreground"
                              aria-label={`Settings for ${group.name}`}
                              title={`Settings for ${group.name}`}
                              disabled={busy}
                            >
                              <Settings2 className="size-3.5" />
                            </Button>
                          </DropdownMenu.Trigger>
                          {group.entries.length > 1 && (
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content className="z-50 max-w-80 rounded-lg border bg-popover p-1 shadow-xl">
                                <DropdownMenu.Label className="px-2 py-1 text-xs text-muted-foreground">
                                  Project settings on…
                                </DropdownMenu.Label>
                                {group.entries.map(({ repository: item }) => (
                                  <DropdownMenu.Item
                                    key={item.key}
                                    className={`${itemClass} data-[disabled]:opacity-50`}
                                    disabled={!item.source.online}
                                    onSelect={() => {
                                      setMenuOpen(false)
                                      void open(item.source.runtimeId, item.id)
                                    }}
                                  >
                                    <span className="min-w-0">
                                      <span className="block">
                                        {item.source.name}
                                        {item.source.online ? '' : ' · Offline'}
                                      </span>
                                      <span className="block truncate text-[10px] text-muted-foreground">
                                        {item.path}
                                      </span>
                                    </span>
                                  </DropdownMenu.Item>
                                ))}
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          )}
                        </DropdownMenu.Root>
                      )}
                    </div>
                  )
                })}
              {!projectGroups.some((group) =>
                group.entries.some(({ repository: repo }) =>
                  `${repo.name} ${repo.gitIdentity ?? ''} ${repo.source.name} ${repo.path}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
                ),
              ) && <p className="px-2 py-4 text-xs text-muted-foreground">No matching projects.</p>}
            </div>
            <div className="border-t pt-1">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    className="h-9 w-full justify-start gap-2 px-2 text-xs font-normal"
                  >
                    <Plus className="size-3.5" />
                    Add project
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="z-50 rounded-lg border bg-popover p-1 shadow-xl">
                    {sources.map((source) => (
                      <DropdownMenu.Item
                        key={source.runtimeId ?? 'local'}
                        className={`${itemClass} data-[disabled]:opacity-50`}
                        disabled={!source.online}
                        onSelect={() => {
                          setMenuOpen(false)
                          void open(source.runtimeId)
                        }}
                      >
                        {source.name}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
              <TaskDefaultSettings
                key={`defaults-${activeRuntimeId}:${managed.id}`}
                repository={managed}
              />
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
