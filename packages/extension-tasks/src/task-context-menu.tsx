import { useApplicationState } from '@dovo/studio-core/state'
import { useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  generatedTitleSchema,
  hasUnviewedTaskCompletion,
  isSnoozed,
  latestCompletedTaskTurn,
  responses,
  useWorkspace,
  WorkspaceScope,
} from '@dovo/studio-core'
import {
  Button,
  ContextMenu,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Input,
} from '@dovo/studio-ui'
import {
  Archive,
  Trash2,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Filter,
  Mail,
  MailOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Sparkles,
  Undo2,
} from 'lucide-react'
import type { TaskEntry } from './task-collection'
import { TaskSettings } from './task-settings'
import { taskActionClient, taskRowValues, type TaskRowChanges } from './task-row-actions'
const menuClass =
  'z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl'
const itemClass =
  'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none transition-colors data-[highlighted]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground'
const separatorClass = 'my-1 h-px bg-border/70'
export function TaskContextMenu({
  entry,
  selected,
  busy,
  children,
  onOpen,
  onCreate,
  onFilter,
  onDeselect,
  onError,
}: {
  entry: TaskEntry
  selected: boolean
  busy: boolean
  children: ReactNode
  onOpen: () => void
  onCreate: () => void
  onFilter: () => void
  onDeselect: () => void
  onError: (message: string) => void
}) {
  const store = useWorkspace()
  const { task, source } = entry
  const client = taskActionClient(store, source)
  const { repository, branch, titlePrompt } = taskRowValues(task, source)
  const [pending, setPending] = useApplicationState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useApplicationState('')
  const [dialog, setDialog] = useApplicationState<'rename' | 'settings' | 'delete' | null>(null)
  const [title, setTitle] = useApplicationState(task.title)
  const blocked = busy || pending
  const canEdit = source.online && !blocked
  const turn = latestCompletedTaskTurn(task)
  const unread = hasUnviewedTaskCompletion(task)
  const run = async (action: () => Promise<void>) => {
    if (pendingRef.current || busy) return
    pendingRef.current = true
    setPending(true)
    setError('')
    onError('')
    try {
      await action()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      onError(message)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const patch = (updates: TaskRowChanges) => client.patch(task, updates)

  const settings = dialog === 'settings' && (
    <TaskSettings
      task={task}
      open
      onOpenChange={(open) => {
        if (!open) setDialog(null)
      }}
      onSave={async (changes) => {
        onError('')
        try {
          await patch(changes)
        } catch (failure) {
          onError(failure instanceof Error ? failure.message : String(failure))
          throw failure
        }
      }}
    />
  )
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            tabIndex={!source.online ? 0 : undefined}
            onKeyDown={(event) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              event.currentTarget.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  clientX: rect.left + 20,
                  clientY: rect.top + 20,
                }),
              )
            }}
          >
            {children}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className={menuClass}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              if (dialog) event.preventDefault()
            }}
          >
            <ContextMenu.Label className="max-w-64 truncate px-2.5 py-1.5 text-[10px] text-muted-foreground">
              {repository?.name ?? 'No project'} · {source.name}
            </ContextMenu.Label>
            <ContextMenu.Item
              className={itemClass}
              disabled={blocked || (!source.online && source.runtimeId !== store.activeRuntimeId)}
              onSelect={onOpen}
            >
              <ArrowUpRight />
              Open
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || !repository}
              onSelect={onCreate}
            >
              <Plus />
              New task in this project
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit}
              onSelect={() =>
                void run(() =>
                  patch({
                    pinned: !task.pinned,
                  }),
                )
              }
            >
              {task.pinned ? <PinOff /> : <Pin />}
              {task.pinned ? 'Unpin' : 'Pin'}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || !!task.archivedAt || task.status === 'running'}
              onSelect={() =>
                void run(() =>
                  patch({
                    archived: !task.archived,
                    snoozedUntil: null,
                  }),
                )
              }
            >
              {task.archived ? <Undo2 /> : <Check />}
              {task.archived ? 'Reopen' : 'Settle'}
            </ContextMenu.Item>
            {!task.archived && (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={itemClass} disabled={!canEdit}>
                  <Clock />
                  Snooze
                  <ChevronRight className="ml-auto" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={menuClass} collisionPadding={8}>
                    {[
                      [1, 'For 1 hour'],
                      [4, 'For 4 hours'],
                      [24, 'Until tomorrow'],
                    ].map(([hours, label]) => (
                      <ContextMenu.Item
                        key={hours}
                        className={itemClass}
                        onSelect={() =>
                          void run(() =>
                            patch({
                              snoozedUntil: new Date(
                                Date.now() + Number(hours) * 3600000,
                              ).toISOString(),
                            }),
                          )
                        }
                      >
                        {label}
                      </ContextMenu.Item>
                    ))}
                    {isSnoozed(task, Date.now()) && (
                      <ContextMenu.Item
                        className={itemClass}
                        onSelect={() =>
                          void run(() =>
                            patch({
                              snoozedUntil: null,
                            }),
                          )
                        }
                      >
                        Unsnooze
                      </ContextMenu.Item>
                    )}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            )}
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit}
              onSelect={() => {
                setError('')
                setTitle(task.title)
                setDialog('rename')
              }}
            >
              <Pencil />
              Rename…
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || !titlePrompt || task.status === 'running'}
              onSelect={() =>
                void run(async () => {
                  const generated = await client.request(
                    '/api/tasks/title',
                    {
                      text: titlePrompt,
                    },
                    generatedTitleSchema,
                  )
                  await patch({
                    title: generated.title,
                  })
                })
              }
            >
              <Sparkles />
              Regenerate title
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || !turn || task.archived}
              onSelect={() =>
                void run(async () => {
                  if (!turn) return
                  if (!unread && selected) flushSync(onDeselect)
                  await client.request(
                    '/api/tasks/viewed',
                    {
                      id: task.id,
                      turnId: turn.id,
                      viewed: unread,
                      expectedRevision: task.viewedRevision ?? 0,
                    },
                    responses.ok,
                  )
                  await client.refresh()
                })
              }
            >
              {unread ? <MailOpen /> : <Mail />}
              {unread ? 'Mark as read' : 'Mark as unread'}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={blocked || !repository}
              onSelect={onFilter}
            >
              <Filter />
              Filter by project
            </ContextMenu.Item>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={itemClass} disabled={blocked}>
                <Copy />
                Copy
                <ChevronRight className="ml-auto" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={menuClass} collisionPadding={8}>
                  {(
                    [
                      ['Title', task.title],
                      ['Branch', branch],
                      ['Project path', repository?.path ?? ''],
                      ['Task ID', task.id],
                    ] as const
                  ).map(([label, text]) => (
                    <ContextMenu.Item
                      key={label}
                      className={itemClass}
                      disabled={!text}
                      onSelect={() => void run(() => navigator.clipboard.writeText(text))}
                    >
                      {label}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || task.status === 'running'}
              onSelect={() => {
                setError('')
                setDialog('settings')
              }}
            >
              <Settings2 />
              Task settings…
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || task.status === 'running'}
              onSelect={() =>
                void run(async () => {
                  await client.request(
                    '/api/tasks/lifecycle',
                    {
                      id: task.id,
                      action: task.archivedAt ? 'restore' : 'archive',
                    },
                    responses.ok,
                  )
                  if (selected && !task.archivedAt) onDeselect()
                  await client.refresh()
                })
              }
            >
              <Archive />
              {task.archivedAt ? 'Restore thread' : 'Archive thread'}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={`${itemClass} text-destructive`}
              disabled={!canEdit || task.status === 'running'}
              onSelect={() => {
                setError('')
                setDialog('delete')
              }}
            >
              <Trash2 />
              Delete thread…
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {pending && !dialog && (
        <p role="status" className="px-2.5 pb-2 text-[11px] text-muted-foreground">
          Updating task…
        </p>
      )}
      <Dialog
        open={dialog === 'rename'}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Rename task</DialogTitle>
          <DialogDescription>
            {repository?.name ?? 'Task'} · {source.name}
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim())
                void run(async () => {
                  await patch({
                    title: title.trim(),
                  })
                  setDialog(null)
                })
            }}
          >
            <FormField label="Title">
              <Input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={pending}
              />
            </FormField>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canEdit || !title.trim()}>
                {pending ? 'Saving…' : 'Save title'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'delete'}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Delete thread?</DialogTitle>
          <DialogDescription>
            “{task.title}” and its conversation will be permanently deleted. Project files and
            worktrees stay on disk.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canEdit}
              onClick={() =>
                void run(async () => {
                  await client.request(
                    '/api/tasks/lifecycle',
                    {
                      id: task.id,
                      action: 'delete',
                    },
                    responses.ok,
                  )
                  setDialog(null)
                  if (selected) onDeselect()
                  await client.refresh()
                })
              }
            >
              {pending ? 'Deleting…' : 'Delete thread'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {settings &&
        (client.profile ? (
          <WorkspaceScope profile={client.profile}>{settings}</WorkspaceScope>
        ) : (
          settings
        ))}
    </>
  )
}
