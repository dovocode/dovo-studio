import {
  canChangeTaskCheckout,
  resolveTaskDefaults,
  updateTask,
  useWorkspace,
  useStudioHost,
  WorkspaceScope,
  type Task,
  type Repository,
} from '@dovo/studio-core'
import { Button, Input, DropdownMenu } from '@dovo/studio-ui'
import { RepositoryDialog } from '@dovo/extension-scm/repository-dialog'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Monitor,
  Plus,
  MessageCircle,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { taskSources, type TaskSource } from '../../list/task-collection'
import { moveTaskDraft } from './task-machine-selector'

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
  const menu = useRef<HTMLDivElement>(null)
  const store = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  const [machine, setMachine] = useState<string | null | undefined>(store.activeRuntimeId)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<TaskSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sources = taskSources(store)
  const current = sources.find((source) => source.runtimeId === store.activeRuntimeId)
  const repository = store.workspace.repositories.find((item) => item.id === task.repositoryId)
  const editable =
    canChangeTaskCheckout(task) && !task.archivedAt && !task.pullRequest && !task.workItem
  const locked = disabled || busy || !editable || !!task.draftAttachments?.length
  const choose = async (source: TaskSource, target: Repository) => {
    if (locked || !source.online || target.gitIdentityError) return
    if (source.runtimeId === store.activeRuntimeId && target.id === task.repositoryId) {
      setOpen(false)
      return
    }
    setBusy(true)
    onMoving?.(true)
    setError('')
    try {
      if (source.runtimeId === store.activeRuntimeId) {
        store.setWorkspace((workspace) =>
          updateTask(workspace, task.id, (draft) => ({
            ...draft,
            ...resolveTaskDefaults(store.snapshot?.defaults, target),
            repositoryId: target.id,
            agentId: '',
            agentOverrides: undefined,
            existingWorktreePath: undefined,
            worktreeBaseBranch: undefined,
          })),
        )
      } else if (onSelectRemote) await onSelectRemote(source, target)
      else await moveTaskDraft(store, host, task, source, target)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      onMoving?.(false)
    }
  }
  const matchesSearch = (item: Repository) =>
    `${item.kind === 'scratch' ? 'No project' : item.name} ${item.path}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
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
      <DropdownMenu.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (value) {
            setMachine(store.activeRuntimeId)
            setQuery('')
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <Button
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
                : (repository?.name ?? 'Choose folder')}
            </span>
            <Monitor className="size-3.5" />
            <span className="max-w-28 truncate">{current?.name ?? 'This machine'}</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            ref={menu}
            side="top"
            align="start"
            sideOffset={8}
            className="z-50 min-w-56 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            {sources.map((source) => (
              <DropdownMenu.Sub
                key={source.runtimeId ?? 'local'}
                open={machine === source.runtimeId}
                onOpenChange={(value) => {
                  if (value) {
                    setMachine(source.runtimeId)
                    setQuery('')
                  } else
                    setMachine((current) => (current === source.runtimeId ? undefined : current))
                }}
              >
                <DropdownMenu.SubTrigger
                  disabled={!source.online || locked}
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[state=open]:bg-accent data-[disabled]:opacity-40"
                >
                  <Monitor className="size-3.5" />
                  <span className="flex-1">
                    {source.name}
                    {source.online ? '' : ' · Offline'}
                  </span>
                  {source.runtimeId === store.activeRuntimeId && <Check className="size-3.5" />}
                  <ChevronRight className="size-3.5" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    onFocusOutside={(event) => {
                      if (event.target === menu.current) event.preventDefault()
                    }}
                    sideOffset={8}
                    className="z-50 w-72 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
                  >
                    <Input
                      autoFocus
                      aria-label="Search folders"
                      placeholder="Search folders"
                      value={machine === source.runtimeId ? query : ''}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          const first = event.currentTarget.nextElementSibling?.querySelector(
                            '[role="menuitem"]:not([data-disabled])',
                          )
                          if (first instanceof HTMLElement) first.focus()
                        }
                        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
                      }}
                      className="mb-2"
                    />
                    <div className="max-h-64 overflow-y-auto">
                      {source.workspace.repositories.filter(matchesSearch).map((item) => (
                        <DropdownMenu.Item
                          key={item.id}
                          disabled={!!item.gitIdentityError || locked || !source.online}
                          title={item.gitIdentityError || item.path}
                          onSelect={() => {
                            void choose(source, item)
                          }}
                          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-40"
                        >
                          {item.kind === 'scratch' ? (
                            <MessageCircle className="size-4" />
                          ) : (
                            <Folder className="size-4" />
                          )}
                          <span className="flex-1 truncate">
                            {item.kind === 'scratch' ? 'No project' : item.name}
                          </span>
                          {source.runtimeId === store.activeRuntimeId &&
                            item.id === task.repositoryId && <Check className="size-4" />}
                        </DropdownMenu.Item>
                      ))}
                      {!source.workspace.repositories.some(matchesSearch) && (
                        <p className="p-2 text-xs text-muted-foreground">No matching folders.</p>
                      )}
                    </div>
                    <DropdownMenu.Separator className="my-2 border-t" />
                    <DropdownMenu.Item
                      disabled={locked || !source.online}
                      onSelect={() => setAdding(source)}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none focus:bg-accent"
                    >
                      <Plus className="size-4" />
                      Add project
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {adding &&
        (adding.runtimeId === store.activeRuntimeId ? (
          dialog
        ) : addingProfile ? (
          <WorkspaceScope profile={addingProfile}>{dialog}</WorkspaceScope>
        ) : null)}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
