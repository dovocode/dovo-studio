import {
  canChangeTaskCheckout,
  updateTask,
  useWorkspace,
  useStudioHost,
  WorkspaceScope,
  type Task,
  type Repository,
} from '@dovo/studio-core'
import { taskProjectGroups, preferredProjectEntry, projectDefaultServer } from '@dovo/protocol'
import { Button, Input, Popover } from '@dovo/studio-ui'
import { RepositoryDialog } from '@dovo/extension-scm/repository-dialog'
import {
  Check,
  ChevronDown,
  Folder,
  Monitor,
  LoaderCircle,
  Plus,
  MessageCircle,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { taskSources, type TaskSource } from '../../list/task-collection'
import { moveTaskDraft } from './task-machine-selector'
import { changeTaskProject } from './task-project-selection'

export function ComposerProject({
  task,
  disabled,
  onMoving,
  onSelectRemote,
}: {
  task: Task
  disabled: boolean
  onMoving?: (moving: boolean) => void
  onSelectRemote?: (source: TaskSource, repository: Repository) => Promise<void>
}) {
  const search = useRef<HTMLInputElement>(null)
  const projects = useRef<HTMLDivElement>(null)
  const store = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<TaskSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sources = taskSources(store)
  const current = sources.find((source) => source.runtimeId === store.activeRuntimeId)
  const multipleMachines = sources.length > 1
  const repository = store.workspace.repositories.find((item) => item.id === task.repositoryId)
  const editable =
    canChangeTaskCheckout(task) && !task.archivedAt && !task.pullRequest && !task.workItem
  const locked = disabled || busy || !editable || !!task.draftAttachments?.length
  const choose = async (source: TaskSource, target: Repository) => {
    if (locked || !source.online || target.gitIdentityError) return
    if (source.runtimeId === store.activeRuntimeId && target.id === task.repositoryId) {
      setOpen(false)
      setServerOpen(false)
      return
    }
    setBusy(true)
    onMoving?.(true)
    setError('')
    try {
      if (source.runtimeId === store.activeRuntimeId) {
        store.setWorkspace((workspace) =>
          updateTask(workspace, task.id, (draft) =>
            changeTaskProject(
              draft,
              workspace.repositories.find((item) => item.id === draft.repositoryId),
              target,
              store.snapshot?.defaults,
              workspace.agents,
            ),
          ),
        )
      } else if (onSelectRemote) await onSelectRemote(source, target)
      else await moveTaskDraft(store, host, task, source, target)
      setOpen(false)
      setServerOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      onMoving?.(false)
    }
  }
  const groups = taskProjectGroups(
    sources.flatMap((source) =>
      source.workspace.repositories.map((repository) => ({
        repository,
        source,
        runtimeId: source.runtimeId,
        online: source.online,
        defaults: source.snapshot?.defaults,
      })),
    ),
  )
  const normalizedQuery = query.trim().toLowerCase()
  const matches = groups.filter(
    (group) =>
      group.key !== 'scratch' &&
      group.entries.some(({ repository, source }) =>
        `${group.name} ${repository.name} ${repository.path} ${repository.gitIdentity ?? ''} ${source.name}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
  )
  const scratch = groups.find((group) => group.key === 'scratch')
  const projectRow = (group: (typeof groups)[number]) => {
    const preferred = preferredProjectEntry(group.entries, store.activeRuntimeId)
    const defaultId = projectDefaultServer(group.entries)
    const defaultSource = sources.find((item) => item.runtimeId === defaultId)
    const selected = group.entries.some(
      ({ repository, runtimeId }) =>
        runtimeId === store.activeRuntimeId && repository.id === task.repositoryId,
    )
    const serverCount = new Set(group.entries.map((entry) => entry.runtimeId)).size
    return (
      <button
        type="button"
        key={group.key}
        aria-label={group.name}
        title={
          preferred?.repository.path ??
          group.entries.find((entry) => entry.repository.gitIdentityError)?.repository
            .gitIdentityError ??
          'No online copy of this project.'
        }
        aria-pressed={selected}
        disabled={locked || !preferred}
        onClick={() => {
          if (preferred) void choose(preferred.source, preferred.repository)
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-40"
      >
        {group.key === 'scratch' ? (
          <MessageCircle className="size-4 shrink-0" />
        ) : (
          <Folder className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{group.name}</span>
          {multipleMachines && (
            <span className="block truncate text-[0.6875rem] text-muted-foreground">
              {serverCount > 1 ? `${serverCount} servers` : group.entries[0]?.source.name}
              {defaultSource ? ` · Default: ${defaultSource.name}` : ''}
              {!preferred ? ' · Unavailable' : ''}
            </span>
          )}
        </span>
        {selected && <Check className="size-4 shrink-0" />}
      </button>
    )
  }
  const serverRepository = (source: TaskSource) =>
    source.workspace.repositories.find((item) =>
      repository?.kind === 'scratch'
        ? item.kind === 'scratch'
        : repository?.gitIdentity
          ? item.gitIdentity === repository.gitIdentity
          : source.runtimeId === store.activeRuntimeId && item.id === task.repositoryId,
    )
  const feedback = (
    <>
      {busy && (
        <p role="status" className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> Selecting project…
        </p>
      )}
      {error && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
  const addingProfile = store.runtimeRegistry.profiles.find(
    (profile) => profile.id === adding?.runtimeId,
  )
  const dialog = adding && (
    <RepositoryDialog
      projectLabels
      onAdded={(target) => {
        void choose(adding, target)
      }}
      onClose={() => setAdding(null)}
    />
  )
  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          if (busy) return
          setOpen(value)
          if (value) {
            setQuery('')
            setError('')
          }
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            aria-label="Task project"
            className="h-7 min-w-0 gap-1.5 rounded-lg px-2 text-[0.6875rem] font-normal"
          >
            {repository?.kind === 'scratch' ? (
              <MessageCircle className="size-3.5" />
            ) : (
              <Folder className="size-3.5" />
            )}
            <span className="max-w-32 truncate">
              {repository?.kind === 'scratch'
                ? 'No project'
                : (repository?.name ?? 'Choose project')}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            aria-label="Choose a project"
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              search.current?.focus()
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault()
            }}
            className="z-50 w-72 max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            <Input
              ref={search}
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              disabled={locked}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  projects.current
                    ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
                    ?.focus()
                }
              }}
              className="mb-2"
            />
            <div
              ref={projects}
              role="group"
              aria-label="Projects"
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                )
                const index = buttons.findIndex((button) => button === event.target)
                if (index < 0) return
                event.preventDefault()
                if (event.key === 'ArrowUp' && index === 0) {
                  search.current?.focus()
                  return
                }
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1)) % buttons.length
                buttons[next]?.focus()
              }}
            >
              {scratch && <div className="mb-1 border-b pb-1">{projectRow(scratch)}</div>}
              <div className="max-h-64 overflow-y-auto">
                {matches.map(projectRow)}
                {!matches.length && (
                  <p role="status" className="p-2 text-xs text-muted-foreground">
                    {query.trim() ? 'No matching projects.' : 'No projects yet.'}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2 border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                disabled={locked || !current?.online}
                onClick={() => {
                  if (!current) return
                  setOpen(false)
                  setAdding(current)
                }}
                className="w-full justify-start gap-2 px-2 text-sm font-normal"
              >
                <Plus className="size-4" />
                {multipleMachines
                  ? `Add project on ${current?.name ?? 'this server'}`
                  : 'Add project'}
              </Button>
            </div>
            {feedback}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {multipleMachines && (
        <Popover.Root
          open={serverOpen}
          onOpenChange={(value) => {
            if (busy) return
            setServerOpen(value)
            if (value) {
              setOpen(false)
              setError('')
            }
          }}
        >
          <Popover.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={locked}
              aria-label="Task server"
              className="h-7 min-w-0 gap-1.5 rounded-lg px-2 text-[0.6875rem] font-normal"
            >
              <Monitor className="size-3.5" />
              <span className="max-w-28 truncate">{current?.name ?? 'This server'}</span>
              <ChevronDown className="size-3" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="start"
              sideOffset={8}
              aria-label="Choose a server"
              onEscapeKeyDown={(event) => {
                if (busy) event.preventDefault()
              }}
              className="z-50 w-72 max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
            >
              <p className="px-2 pb-2 text-xs text-muted-foreground">
                Run {repository?.kind === 'scratch' ? 'without a project' : repository?.name} on
              </p>
              {sources.map((source) => {
                const target = serverRepository(source)
                return (
                  <button
                    key={source.runtimeId ?? 'local'}
                    type="button"
                    aria-label={source.name}
                    aria-pressed={source.runtimeId === store.activeRuntimeId}
                    disabled={locked || !source.online || !target || !!target.gitIdentityError}
                    onClick={() => {
                      if (target) void choose(source, target)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:opacity-40"
                  >
                    <Monitor className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{source.name}</span>
                      {(!source.online || !target || target.gitIdentityError) && (
                        <span className="block text-xs text-muted-foreground">
                          {!source.online
                            ? 'Offline'
                            : !target
                              ? 'Project not added on this server'
                              : target.gitIdentityError}
                        </span>
                      )}
                    </span>
                    {source.runtimeId === store.activeRuntimeId && (
                      <Check className="size-4 shrink-0" />
                    )}
                  </button>
                )
              })}
              {feedback}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {adding &&
        (adding.runtimeId === store.activeRuntimeId ? (
          dialog
        ) : addingProfile ? (
          <WorkspaceScope profile={addingProfile}>{dialog}</WorkspaceScope>
        ) : null)}
      {error && !open && !serverOpen && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
