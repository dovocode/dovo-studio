import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  canChangeTaskCheckout,
  updateTask,
  useWorkspace,
  useStudioHost,
  WorkspaceScope,
  type Task,
  type Repository,
} from '@dovo/studio-core'
import {
  changeTaskAutoProject,
  taskProjectGroups,
  preferredProjectEntry,
  projectDefaultServer,
} from '@dovo/protocol'
import { Button, Input, Popover, ProjectIcon } from '@dovo/studio-ui'
import { ProjectTransferDialog } from '@dovo/extension-scm/project-transfer'
import { RepositoryDialog } from '@dovo/extension-scm/repository-dialog'
import {
  Check,
  ChevronDown,
  Folder,
  LoaderCircle,
  Plus,
  MessageCircleDashed,
  ScanSearch,
  Layers,
} from 'lucide-react'
import { useRef, useState, type ComponentProps } from 'react'
import { taskSources, type TaskSource } from '../../list/task-collection'
import { moveTaskDraft } from './task-machine-selector'
import { changeTaskProject } from './task-project-selection'

export function ComposerProject({
  task,
  disabled,
  onMoving,
  onSelectRemote,
  prominent = false,
  controls = 'both',
}: {
  task: Task
  prominent?: boolean
  controls?: 'project' | 'server' | 'both'
  disabled: boolean
  onMoving?: (moving: boolean) => void
  onSelectRemote?: (
    source: TaskSource,
    repository: Repository,
    autoProject?: boolean,
    autoProjectExecution?: Task['autoProjectExecution'],
    modelSelection?: Task['modelSelection'],
    modelSelectionDifficulty?: Task['modelSelectionDifficulty'],
    sourceTask?: Task,
  ) => Promise<void>
}) {
  const search = useRef<HTMLInputElement>(null)
  const projects = useRef<HTMLDivElement>(null)
  const store = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<TaskSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sources = taskSources(store)
  const current = sources.find((source) => source.runtimeId === store.activeRuntimeId)
  const autoAvailable = store.snapshot?.autoProjectSelectionEnabled === true
  const multipleMachines = sources.length > 1
  const repository = store.workspace.repositories.find((item) => item.id === task.repositoryId)
  const editable =
    canChangeTaskCheckout(task) && !task.archivedAt && !task.pullRequest && !task.workItem
  const locked =
    disabled ||
    busy ||
    !editable ||
    !!task.archived ||
    !!task.example ||
    !!task.draftAttachments?.length ||
    (prominent && !store.connected)
  const scratchRepository = store.workspace.repositories.find((item) => item.kind === 'scratch')
  const selectedProject =
    !task.autoProject && repository?.kind !== 'scratch' ? repository : undefined
  const startLabel = selectedProject?.name ?? 'Scope'
  const projectSelected = !!task.autoProject || !!selectedProject
  const chooseScope = () => {
    if (locked || !autoAvailable || !scratchRepository || !current?.online) return
    if (!task.autoProject)
      store.setWorkspace((workspace) =>
        updateTask(workspace, task.id, (draft) =>
          changeTaskAutoProject(
            draft,
            workspace.repositories.find((item) => item.id === draft.repositoryId),
            scratchRepository,
            store.snapshot?.defaults,
            workspace.agents,
            store.snapshot?.autoProjectModelSelection ?? 'inherit',
          ),
        ),
      )
    setOpen(false)
  }
  const choose = async (source: TaskSource, target: Repository, preserveAuto = false) => {
    if (locked || !source.online || target.gitIdentityError) return
    if (
      source.runtimeId === store.activeRuntimeId &&
      target.id === task.repositoryId &&
      (preserveAuto || !task.autoProject)
    ) {
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
          updateTask(workspace, task.id, (draft) => ({
            ...changeTaskProject(
              draft,
              workspace.repositories.find((item) => item.id === draft.repositoryId),
              target,
              store.snapshot?.defaults,
              workspace.agents,
            ),
            autoProject: preserveAuto ? task.autoProject : undefined,
            autoProjectExecution: preserveAuto ? task.autoProjectExecution : undefined,
          })),
        )
      } else if (onSelectRemote)
        await onSelectRemote(
          source,
          target,
          preserveAuto ? task.autoProject : undefined,
          preserveAuto ? task.autoProjectExecution : undefined,
          task.harnessCustomized ? task.modelSelection : undefined,
          task.modelSelectionDifficulty,
          task,
        )
      else
        await moveTaskDraft(
          store,
          host,
          { ...task, autoProject: preserveAuto ? task.autoProject : undefined },
          source,
          target,
        )
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
    const selected =
      !task.autoProject &&
      group.entries.some(
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
          <MessageCircleDashed className="size-4 shrink-0" />
        ) : (
          <ProjectIcon
            repository={preferred?.repository ?? group.entries[0]?.repository}
            className="size-4 shrink-0"
          />
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
      task.autoProject || repository?.kind === 'scratch'
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
  const projectControl = (
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
      <div
        className={
          prominent
            ? 'startup-project-selector inline-flex min-w-0 max-w-full items-stretch'
            : 'contents'
        }
        data-selected={projectSelected || undefined}
      >
        {prominent && autoAvailable && (
          <button
            type="button"
            aria-label={selectedProject ? `Selected project: ${startLabel}` : 'Start in Scope'}
            aria-pressed={projectSelected}
            disabled={locked || (!selectedProject && (!autoAvailable || !scratchRepository))}
            title={
              selectedProject
                ? 'Choose a different project or Scope'
                : 'Find the right projects for your task'
            }
            onClick={() => {
              if (selectedProject) {
                setQuery('')
                setError('')
                setOpen(true)
              } else chooseScope()
            }}
            className={`inline-flex items-center justify-center gap-3 min-h-11 min-w-20 max-w-52 rounded-l-lg border border-r-0 px-3 text-sm outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${projectSelected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
          >
            {selectedProject ? (
              <ProjectIcon repository={selectedProject} className="size-4 shrink-0" />
            ) : (
              <Layers className="size-5 shrink-0 text-primary" aria-hidden="true" />
            )}
            <span className="truncate">{startLabel}</span>
          </button>
        )}
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            aria-label={prominent ? 'Choose project' : 'Task project'}
            className={
              prominent
                ? `min-h-11 min-w-11 ${autoAvailable ? 'rounded-l-none rounded-r-lg' : 'gap-2 rounded-lg'} border px-3 shadow-none ${projectSelected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`
                : 'h-6 min-w-0 gap-1.5 rounded-lg px-2 text-[0.6875rem] font-normal'
            }
          >
            {prominent && !autoAvailable && (
              <>
                {selectedProject ? (
                  <ProjectIcon repository={selectedProject} className="size-4 shrink-0" />
                ) : (
                  <Folder className="size-4 shrink-0" aria-hidden="true" />
                )}
                <span className="max-w-48 truncate">
                  {selectedProject?.name ?? 'Choose project'}
                </span>
              </>
            )}
            {!prominent && (
              <>
                {task.autoProject ? (
                  <ScanSearch className="size-3.5" />
                ) : repository?.kind === 'scratch' ? (
                  <MessageCircleDashed className="size-3.5" />
                ) : (
                  <ProjectIcon repository={repository} className="size-3.5 shrink-0" />
                )}
                <span className="max-w-32 truncate">
                  {task.autoProject
                    ? autoAvailable
                      ? 'Scope'
                      : 'Scope (disabled)'
                    : repository?.kind === 'scratch'
                      ? 'No Project'
                      : (repository?.name ?? 'Choose project')}
                </span>
              </>
            )}
            <ChevronDown className="size-3" />
          </Button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          side={prominent ? 'bottom' : 'top'}
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
                projects.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
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
            {!prominent && scratch && (
              <div className="mb-1 border-b pb-1">{projectRow(scratch)}</div>
            )}
            {autoAvailable && scratchRepository && (
              <button
                type="button"
                aria-label="Scope mode"
                aria-pressed={!!task.autoProject}
                disabled={locked || !autoAvailable || !scratchRepository}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={chooseScope}
              >
                <ScanSearch className="size-4" />
                <span className="flex-1">Scope</span>
                {task.autoProject && <Check className="size-4" />}
              </button>
            )}
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
  )
  const serverControl = controls !== 'project' &&
    (multipleMachines || prominent || controls === 'server') && (
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
            className={
              prominent
                ? 'min-h-11 min-w-0 max-w-56 gap-1.5 rounded-lg border border-border px-3 text-xs font-normal'
                : 'h-6 min-w-0 gap-1.5 rounded-lg px-2 text-[0.6875rem] font-normal'
            }
          >
            <RuntimeIcon icon={current?.snapshot?.runtimeIcon} className="size-3.5" />
            <span className="max-w-28 truncate">{current?.name ?? 'This server'}</span>
            <ChevronDown className="size-3" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={prominent ? 'bottom' : 'top'}
            align="start"
            sideOffset={8}
            aria-label="Choose a server"
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault()
            }}
            className="z-50 w-72 max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              {task.autoProject ? (
                'Select projects automatically on'
              ) : (
                <>Run {repository?.kind === 'scratch' ? 'No Project' : repository?.name} on</>
              )}
            </p>
            {sources
              .flatMap((source) => {
                const target = serverRepository(source)
                return target ? [{ source, target }] : []
              })
              .map(({ source, target }) => {
                return (
                  <button
                    key={source.runtimeId ?? 'local'}
                    type="button"
                    aria-label={source.name}
                    aria-pressed={source.runtimeId === store.activeRuntimeId}
                    disabled={locked || !source.online || !!target.gitIdentityError}
                    onClick={() => void choose(source, target, true)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:opacity-40"
                  >
                    <RuntimeIcon icon={source.snapshot?.runtimeIcon} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{source.name}</span>
                      {(!source.online || target.gitIdentityError) && (
                        <span className="block text-xs text-muted-foreground">
                          {!source.online ? 'Offline' : target.gitIdentityError}
                        </span>
                      )}
                    </span>
                    {source.runtimeId === store.activeRuntimeId && (
                      <Check className="size-4 shrink-0" />
                    )}
                  </button>
                )
              })}
            {!task.autoProject && repository && repository.kind !== 'scratch' && (
              <Button
                type="button"
                variant="ghost"
                disabled={locked || !store.connected}
                className="mt-2 w-full justify-start gap-2 border-t px-2 text-sm font-normal"
                onClick={() => {
                  setServerOpen(false)
                  setTransferring(true)
                }}
              >
                <Plus className="size-4" /> Add to another machine
              </Button>
            )}
            {feedback}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    )
  return (
    <>
      {prominent ? (
        <div
          role="group"
          aria-label="Start a thread"
          className="mt-1 flex max-w-full flex-col items-center gap-1.5"
        >
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              aria-label="Start without a project"
              aria-pressed={!task.autoProject && repository?.kind === 'scratch'}
              disabled={locked || !scratchRepository}
              onClick={() => {
                if (current && scratchRepository) void choose(current, scratchRepository)
              }}
              className={`startup-no-project inline-flex items-center justify-center gap-1.5 min-h-11 min-w-20 rounded-lg border px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${!task.autoProject && repository?.kind === 'scratch' ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
            >
              <MessageCircleDashed className="size-4" aria-hidden="true" />
              No Project
            </button>
            {projectControl}
          </div>
          {serverControl}
        </div>
      ) : (
        <>
          {controls !== 'server' && projectControl}
          {serverControl}
        </>
      )}
      {transferring && repository && (
        <ProjectTransferDialog repository={repository} onClose={() => setTransferring(false)} />
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

export type SelectRemoteProject = NonNullable<
  ComponentProps<typeof ComposerProject>['onSelectRemote']
>
