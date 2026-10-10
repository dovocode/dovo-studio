import { useApplicationState } from '@dovo/studio-core/state'
import { randomUUID, templateFromTask, runtimePreferencesSchema } from '@dovo/protocol'
import { conversationPageSchema, taskTranscript, type ConversationPage } from '@dovo/protocol'
import { useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  generatedTitleSchema,
  hasUnviewedTaskCompletion,
  isSnoozed,
  latestCompletedTaskTurn,
  responses,
  useWorkspace,
  readAppPreferences,
} from '@dovo/studio-core'
import {
  Button,
  Checkbox,
  ContextMenu,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Input,
} from '@dovo/studio-ui'
import {
  LayoutTemplate,
  Columns2,
  Archive,
  Trash2,
  ArrowUpRight,
  Check,
  ChevronRight,
  AlarmClock,
  Copy,
  Filter,
  Mail,
  MailOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Sparkles,
  Undo2,
} from 'lucide-react'
import type { TaskEntry } from '../list/task-collection'
import { taskActionClient, taskRowValues, type TaskRowChanges } from '../list/task-row-actions'
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
  onSplit,
  onTemplate,
  onDeselect,
  onError,
  selectionMenu,
}: {
  selectionMenu?: ReactNode
  entry: TaskEntry
  selected: boolean
  busy: boolean
  children: ReactNode
  onOpen: () => void
  onCreate: () => void
  onFilter: () => void
  /** Opens the task next to the current one (tasks on the connected computer only). */
  onSplit?: () => void
  /** Starts a new task in this task's project from one of its templates. */
  onTemplate?: (templateId: string) => void
  onDeselect: () => void
  onError: (message: string) => void
}) {
  const store = useWorkspace()
  const { task, source } = entry
  const client = taskActionClient(store, source)
  const { repository, branch } = taskRowValues(task, source)
  const [pending, setPending] = useApplicationState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useApplicationState('')
  const [dialog, setDialog] = useApplicationState<'rename' | 'delete' | 'template' | null>(null)
  const supportsWorktreeOverride = source.snapshot?.worktreeDeletionOverrideSupported === true
  const [removeWorktrees, setRemoveWorktrees] = useApplicationState(false)
  const [templateName, setTemplateName] = useApplicationState(task.title)
  const templates = repository?.templates ?? []
  const local = source.runtimeId === store.activeRuntimeId
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
  const copyConversation = async () => {
    if (!source.online || (!task.historyBefore && task.messages.length)) {
      await navigator.clipboard.writeText(taskTranscript(task))
      return
    }
    const pages: ConversationPage[] = []
    let before: string | undefined
    do {
      const page = await client.request(
        '/api/tasks/history',
        { id: task.id, before },
        conversationPageSchema,
      )
      pages.unshift(page)
      before = page.before
    } while (before)
    await navigator.clipboard.writeText(
      taskTranscript({ title: task.title, messages: pages.flatMap((page) => page.messages) }),
    )
  }
  const patch = (updates: TaskRowChanges) => client.patch(task, updates)

  const trigger = (
    <ContextMenu.Trigger asChild>
      <div
        className="min-w-0 flex-1"
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
  )
  if (selectionMenu)
    return (
      <ContextMenu.Root>
        {trigger}
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuClass} collisionPadding={8}>
            {selectionMenu}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    )
  return (
    <>
      <ContextMenu.Root>
        {trigger}
        <ContextMenu.Portal>
          <ContextMenu.Content
            className={menuClass}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              if (dialog) event.preventDefault()
            }}
          >
            <ContextMenu.Label className="max-w-64 truncate px-2.5 py-1.5 text-[0.625rem] text-muted-foreground">
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
            {onSplit && (
              <ContextMenu.Item
                className={itemClass}
                disabled={blocked || selected || source.runtimeId !== store.activeRuntimeId}
                onSelect={onSplit}
              >
                <Columns2 />
                Open side by side
              </ContextMenu.Item>
            )}
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || !repository}
              onSelect={onCreate}
            >
              <Plus />
              New task in this project
            </ContextMenu.Item>
            {onTemplate && !!templates.length && (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={itemClass} disabled={!canEdit || !repository}>
                  <LayoutTemplate />
                  New task from template
                  <ChevronRight className="ml-auto" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={menuClass} collisionPadding={8}>
                    {templates.map((template) => (
                      <ContextMenu.Item
                        key={template.id}
                        className={itemClass}
                        onSelect={() => onTemplate(template.id)}
                      >
                        {template.name}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            )}
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit || !repository || !local}
              onSelect={() => {
                setTemplateName(task.title)
                setError('')
                setDialog('template')
              }}
            >
              <LayoutTemplate />
              Save as template…
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              className={itemClass}
              disabled={!canEdit}
              onSelect={() => {
                if (
                  task.pinned &&
                  readAppPreferences().confirmUnpin &&
                  !window.confirm(`Unpin “${task.title}”?`)
                )
                  return
                void run(() => patch({ pinned: !task.pinned }))
              }}
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
                  <AlarmClock />
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
              disabled={!canEdit || task.status === 'running'}
              onSelect={() =>
                void run(async () => {
                  const generated = await client.request(
                    '/api/tasks/title',
                    {
                      taskId: task.id,
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
                  <ContextMenu.Item
                    className={itemClass}
                    disabled={
                      blocked || (!source.online && (!task.messages.length || !!task.historyBefore))
                    }
                    onSelect={() => void run(copyConversation)}
                  >
                    Conversation as Markdown
                  </ContextMenu.Item>
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
                // Settings → General → Confirm before archiving.
                if (
                  !task.archivedAt &&
                  readAppPreferences().confirmArchive &&
                  !window.confirm(
                    `Archive “${task.title}”? You can restore it from Settings → Archived tasks.`,
                  )
                )
                  return
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
              }}
            >
              <Archive />
              {task.archivedAt ? 'Restore thread' : 'Archive thread'}
            </ContextMenu.Item>
            <ContextMenu.Item
              className={`${itemClass} text-destructive`}
              disabled={!canEdit || task.status === 'running'}
              onSelect={() => {
                setError('')
                if (readAppPreferences().confirmDelete)
                  void run(async () => {
                    const preferences = await client.request(
                      '/api/runtime/preferences/read',
                      {},
                      runtimePreferencesSchema,
                    )
                    setRemoveWorktrees(preferences.removeWorktreesOnThreadDelete)
                    setDialog('delete')
                  })
                else
                  void run(async () => {
                    await client.request(
                      '/api/tasks/lifecycle',
                      { id: task.id, action: 'delete' },
                      responses.ok,
                    )
                    if (selected) onDeselect()
                    await client.refresh()
                  })
              }}
            >
              <Trash2 />
              Delete thread…
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {pending && !dialog && (
        <p role="status" className="px-2.5 pb-2 text-[0.6875rem] text-muted-foreground">
          Updating task…
        </p>
      )}
      <Dialog
        open={dialog === 'template'}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            New tasks in {repository?.name ?? 'this project'} can start from this task’s first
            request, agent, checkout choice and setup command. The conversation is not included.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              const name = templateName.trim()
              if (!name || !repository) return
              void run(async () => {
                if (templates.some((item) => item.name.toLowerCase() === name.toLowerCase()))
                  throw new Error('A template with this name already exists.')
                store.setWorkspace((workspace) => ({
                  ...workspace,
                  repositories: workspace.repositories.map((item) =>
                    item.id === repository.id
                      ? {
                          ...item,
                          templates: [
                            ...(item.templates ?? []),
                            templateFromTask(task, name, randomUUID()),
                          ],
                        }
                      : item,
                  ),
                }))
                setDialog(null)
              })
            }}
          >
            <FormField label="Template name">
              <Input
                autoFocus
                value={templateName}
                maxLength={80}
                onChange={(event) => setTemplateName(event.target.value)}
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
              <Button
                type="submit"
                disabled={!canEdit || !templateName.trim() || templates.length >= 30}
              >
                Save template
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
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
            “{task.title}” and its conversation will be permanently deleted.
          </DialogDescription>
          {supportsWorktreeOverride && (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={removeWorktrees}
                disabled={pending}
                onCheckedChange={(checked) => setRemoveWorktrees(checked === true)}
              />
              <span>
                Remove worktrees when this is their last thread
                <span className="mt-1 block text-xs text-muted-foreground">
                  Only clean Dovo-created checkouts are removed. Branches, uncommitted changes and
                  worktrees linked to other threads are kept. Ignored local files in removed
                  checkouts are deleted.
                </span>
              </span>
            </label>
          )}
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
                      ...(supportsWorktreeOverride ? { removeWorktrees } : {}),
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
    </>
  )
}
