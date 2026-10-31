import { taskSnoozeOptions } from '@dovo/protocol'
import { ProjectTransferDialog } from '@dovo/extension-scm/project-transfer'
import { ProjectSettings } from '@dovo/extension-scm/projects'
import { Schema } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  randomUUID,
  templateFromTask,
  runtimePreferencesSchema,
  mutableStruct,
} from '@dovo/protocol'
import { conversationPageSchema, taskTranscript, type ConversationPage } from '@dovo/protocol'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  generatedTitleSchema,
  hasUnviewedTaskCompletion,
  isSnoozed,
  latestCompletedTaskTurn,
  responses,
  readAppPreferences,
  useStudioHost,
  WorkspaceScope,
  type Task,
} from '@dovo/studio-core'
import {
  Button,
  Checkbox,
  ContextMenu,
  DropdownMenu,
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
import type { TaskOwner } from '../list/task-collection'
import {
  taskActionClient,
  taskRowValues,
  useTaskActionStore,
  type TaskRowChanges,
} from '../list/task-row-actions'
const menuClass =
  'studio-menu-surface z-50 max-h-[min(80dvh,var(--radix-dropdown-menu-content-available-height,80dvh))] min-w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground'
const itemClass =
  'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none transition-colors data-[highlighted]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground'
const separatorClass = 'my-1 h-px bg-border/70'
export function TaskContextMenu({
  task,
  owner: source,
  selected,
  busy,
  children,
  onOpen,
  onCreate,
  onFilter,
  onSplit,
  onTemplate,
  onDeselect,
  onProjectDeleted,
  onError,
  onActiveChange,
  selectionMenu,
  toolsMenu,
  dropdown = false,
}: {
  dropdown?: boolean
  selectionMenu?: ReactNode
  /** Tool shortcuts supplied by the thread header, shown in the first menu. */
  toolsMenu?: ReactNode
  task: Task
  owner: TaskOwner
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
  onProjectDeleted?: () => void
  onError: (message: string) => void
  /** Reports an open menu, dialog or action, so a windowed list keeps this row mounted. */
  onActiveChange?: (active: boolean) => void
}) {
  const Menu = dropdown ? DropdownMenu : ContextMenu
  const host = useStudioHost()
  const store = useTaskActionStore()
  const client = taskActionClient(store, source)
  const { repository, branch } = taskRowValues(task, source.repositories)
  const [pending, setPending] = useApplicationState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useApplicationState('')
  const [dialog, setDialog] = useApplicationState<
    'rename' | 'delete' | 'template' | 'project' | 'transfer' | 'archive-period' | null
  >(null)
  const supportsWorktreeOverride = source.worktreeDeletionOverrideSupported
  const [removeWorktrees, setRemoveWorktrees] = useApplicationState(false)
  const [archiveDays, setArchiveDays] = useApplicationState('7')
  const [templateName, setTemplateName] = useApplicationState(task.title)
  const templates = repository?.templates ?? []
  const local = source.runtimeId === store.activeRuntimeId
  const [title, setTitle] = useApplicationState(task.title)
  const blocked = busy || pending
  const [menuOpen, setMenuOpen] = useState(false)
  const active = menuOpen || dialog !== null || pending
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])
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

  const trigger = dropdown ? (
    <Menu.Trigger asChild>{children}</Menu.Trigger>
  ) : (
    <Menu.Trigger asChild>
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
    </Menu.Trigger>
  )
  if (selectionMenu)
    return (
      <Menu.Root onOpenChange={setMenuOpen}>
        {trigger}
        <Menu.Portal>
          <Menu.Content className={menuClass} collisionPadding={8}>
            {selectionMenu}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    )
  return (
    <>
      <Menu.Root onOpenChange={setMenuOpen}>
        {trigger}
        <Menu.Portal>
          <Menu.Content
            className={menuClass}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              if (dialog) event.preventDefault()
            }}
          >
            <Menu.Label className="max-w-64 truncate px-2.5 py-1.5 text-[0.625rem] text-muted-foreground">
              {repository?.kind === 'scratch' ? 'No Project' : (repository?.name ?? 'No Project')} ·{' '}
              {source.name}
            </Menu.Label>
            {toolsMenu}
            <Menu.Label className="px-2.5 py-1.5 text-[0.625rem] font-medium text-muted-foreground">
              Thread
            </Menu.Label>
            <Menu.Item
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
            </Menu.Item>
            <Menu.Item
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
            </Menu.Item>
            <Menu.Item
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
            </Menu.Item>
            <Menu.Item
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
            </Menu.Item>
            {!task.archived && (
              <Menu.Sub>
                <Menu.SubTrigger className={itemClass} disabled={!canEdit}>
                  <AlarmClock />
                  Snooze
                  <ChevronRight className="ml-auto" />
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent className={menuClass} collisionPadding={8}>
                    {taskSnoozeOptions.map(({ hours, label }) => (
                      <Menu.Item
                        key={hours}
                        className={itemClass}
                        onSelect={() =>
                          void run(() =>
                            patch({
                              snoozedUntil: new Date(Date.now() + hours * 3600000).toISOString(),
                            }),
                          )
                        }
                      >
                        {label}
                      </Menu.Item>
                    ))}
                    {isSnoozed(task, Date.now()) && (
                      <Menu.Item
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
                      </Menu.Item>
                    )}
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            )}
            {(!selected || (host.popOutThread && source.runtimeId && local) || onSplit) && (
              <>
                <Menu.Separator className={separatorClass} />
                <Menu.Label className="px-2.5 py-1.5 text-[0.625rem] font-medium text-muted-foreground">
                  Open
                </Menu.Label>
                {!selected && (
                  <Menu.Item
                    className={itemClass}
                    disabled={
                      blocked || (!source.online && source.runtimeId !== store.activeRuntimeId)
                    }
                    onSelect={onOpen}
                  >
                    <ArrowUpRight />
                    Open
                  </Menu.Item>
                )}
                {host.popOutThread && source.runtimeId && local && (
                  <Menu.Item
                    className={itemClass}
                    disabled={blocked}
                    onSelect={() =>
                      void run(async () => {
                        if (host.popOutThread && source.runtimeId)
                          await host.popOutThread({
                            runtimeId: source.runtimeId,
                            taskId: task.id,
                            title: task.title,
                          })
                      })
                    }
                  >
                    Pop out thread
                  </Menu.Item>
                )}
                {onSplit && (
                  <Menu.Item
                    className={itemClass}
                    disabled={blocked || selected || source.runtimeId !== store.activeRuntimeId}
                    onSelect={onSplit}
                  >
                    <Columns2 />
                    Open side by side
                  </Menu.Item>
                )}
              </>
            )}
            <Menu.Separator className={separatorClass} />
            {repository && repository.kind !== 'scratch' && (
              <Menu.Item
                className={itemClass}
                disabled={!canEdit}
                onSelect={() => setDialog('transfer')}
              >
                <Copy /> {task.execution === 'worktree' ? 'Copy worktree' : 'Copy project checkout'}{' '}
                to another machine…
              </Menu.Item>
            )}
            <Menu.Sub>
              <Menu.SubTrigger className={itemClass}>
                <Plus /> New thread <ChevronRight className="ml-auto" />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent className={menuClass} collisionPadding={8}>
                  {task.checkoutBranch && task.execution === 'worktree' && (
                    <Menu.Item
                      className={itemClass}
                      disabled={!canEdit || task.status === 'running'}
                      onSelect={() =>
                        void run(async () => {
                          const result = await client.request(
                            '/api/tasks/worktree-thread',
                            { id: task.id, mode: 'reuse' },
                            mutableStruct({ id: Schema.String }),
                          )
                          host.navigate({ viewId: 'tasks', entityId: result.id })
                        })
                      }
                    >
                      <Plus /> New thread on {branch}
                    </Menu.Item>
                  )}
                  <Menu.Item
                    className={itemClass}
                    disabled={!canEdit || !repository}
                    onSelect={onCreate}
                  >
                    <Plus />
                    New thread in this project
                  </Menu.Item>
                  {onTemplate && !!templates.length && (
                    <Menu.Sub>
                      <Menu.SubTrigger className={itemClass} disabled={!canEdit || !repository}>
                        <LayoutTemplate />
                        New thread from template
                        <ChevronRight className="ml-auto" />
                      </Menu.SubTrigger>
                      <Menu.Portal>
                        <Menu.SubContent className={menuClass} collisionPadding={8}>
                          {templates.map((template) => (
                            <Menu.Item
                              key={template.id}
                              className={itemClass}
                              onSelect={() => onTemplate(template.id)}
                            >
                              {template.name}
                            </Menu.Item>
                          ))}
                        </Menu.SubContent>
                      </Menu.Portal>
                    </Menu.Sub>
                  )}
                  <Menu.Item
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
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.SubTrigger className={itemClass}>
                <Filter /> Project <ChevronRight className="ml-auto" />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent className={menuClass} collisionPadding={8}>
                  <Menu.Item
                    className={itemClass}
                    disabled={!canEdit || !repository || !local}
                    onSelect={() => setDialog('project')}
                  >
                    <Filter /> Project settings
                  </Menu.Item>
                  <Menu.Item
                    className={itemClass}
                    disabled={blocked || !repository}
                    onSelect={onFilter}
                  >
                    <Filter />
                    Filter by project
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.SubTrigger className={itemClass} disabled={blocked}>
                <Copy />
                Copy
                <ChevronRight className="ml-auto" />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent className={menuClass} collisionPadding={8}>
                  <Menu.Item
                    className={itemClass}
                    disabled={
                      blocked || (!source.online && (!task.messages.length || !!task.historyBefore))
                    }
                    onSelect={() => void run(copyConversation)}
                  >
                    Conversation as Markdown
                  </Menu.Item>
                  {(
                    [
                      ['Title', task.title],
                      ['Branch', branch],
                      ['Project path', repository?.path ?? ''],
                      ['Thread ID', task.id],
                    ] as const
                  ).map(([label, text]) => (
                    <Menu.Item
                      key={label}
                      className={itemClass}
                      disabled={!text}
                      onSelect={() => void run(() => navigator.clipboard.writeText(text))}
                    >
                      {label}
                    </Menu.Item>
                  ))}
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.SubTrigger className={itemClass}>
                <Sparkles /> Advanced <ChevronRight className="ml-auto" />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent className={menuClass} collisionPadding={8}>
                  {task.sessionId && !task.archived && (
                    <Menu.Item
                      className={itemClass}
                      disabled={!canEdit || task.status === 'running' || !!task.queue?.length}
                      onSelect={() =>
                        void run(async () => {
                          await client.request('/api/tasks/compact', { id: task.id }, responses.ok)
                        })
                      }
                    >
                      Compact agent context
                    </Menu.Item>
                  )}
                  <Menu.Item
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
                  </Menu.Item>
                  <Menu.Sub>
                    <Menu.SubTrigger
                      className={itemClass}
                      disabled={!canEdit || !source.threadBehaviorSupported}
                    >
                      <Check /> Auto-settle behavior <ChevronRight className="ml-auto" />
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent className={menuClass} collisionPadding={8}>
                        <Menu.Item
                          className={itemClass}
                          onSelect={() => void run(() => patch({ settleBehavior: undefined }))}
                        >
                          {!task.settleBehavior && <Check />} Inherit project settings
                        </Menu.Item>
                        <Menu.Item
                          className={itemClass}
                          onSelect={() =>
                            void run(() =>
                              patch({
                                settleBehavior: {
                                  settleMerged: false,
                                  settleClosed: false,
                                  settleInactive: false,
                                },
                              }),
                            )
                          }
                        >
                          {task.settleBehavior?.settleMerged === false &&
                            task.settleBehavior?.settleClosed === false &&
                            task.settleBehavior?.settleInactive === false && <Check />}{' '}
                          Never auto-settle
                        </Menu.Item>
                        {(
                          [
                            ['settleMerged', 'When PR merges'],
                            ['settleClosed', 'When PR closes'],
                            ['settleInactive', 'After 3 inactive days'],
                          ] as const
                        ).map(([field, label]) => (
                          <Menu.Item
                            key={field}
                            className={itemClass}
                            onSelect={() =>
                              void run(() =>
                                patch({
                                  settleBehavior: {
                                    settleMerged: false,
                                    settleClosed: false,
                                    settleInactive: false,
                                    ...task.settleBehavior,
                                    [field]: !task.settleBehavior?.[field],
                                    ...(field === 'settleInactive' ? { inactiveDays: 3 } : {}),
                                  },
                                }),
                              )
                            }
                          >
                            {task.settleBehavior?.[field] && <Check />} {label}
                          </Menu.Item>
                        ))}
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>
                  <Menu.Sub>
                    <Menu.SubTrigger
                      className={itemClass}
                      disabled={!canEdit || !source.threadBehaviorSupported}
                    >
                      <Archive /> Auto-archive after settled <ChevronRight className="ml-auto" />
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent className={menuClass} collisionPadding={8}>
                        <Menu.Item
                          className={itemClass}
                          onSelect={() =>
                            void run(() => patch({ archiveAfterSettledDays: undefined }))
                          }
                        >
                          {task.archiveAfterSettledDays === undefined && <Check />} Inherit project
                          settings
                        </Menu.Item>
                        {[0, 1, 3, 7, 14, 30].map((days) => (
                          <Menu.Item
                            key={days}
                            className={itemClass}
                            onSelect={() =>
                              void run(() => patch({ archiveAfterSettledDays: days }))
                            }
                          >
                            {task.archiveAfterSettledDays === days && <Check />}{' '}
                            {days
                              ? `After ${days} ${days === 1 ? 'day' : 'days'} in Settled`
                              : 'Never automatically archive'}
                          </Menu.Item>
                        ))}
                        <Menu.Item
                          className={itemClass}
                          onSelect={() => {
                            setArchiveDays(String(task.archiveAfterSettledDays || 7))
                            setDialog('archive-period')
                          }}
                        >
                          Custom period…
                        </Menu.Item>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
            <Menu.Separator className={separatorClass} />
            <Menu.Item
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
            </Menu.Item>
            <Menu.Item
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
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {pending && !dialog && (
        <p role="status" className="px-2.5 pb-2 text-[0.6875rem] text-muted-foreground">
          Updating task…
        </p>
      )}
      <Dialog
        open={dialog === 'archive-period'}
        onOpenChange={(open) => !open && !pending && setDialog(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle>Auto-archive after Settled</DialogTitle>
          <DialogDescription>
            Archive this thread after it has remained settled for this many days. Reopening resets
            the clock. Pending work and pinned threads are protected.
          </DialogDescription>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const days = Number(archiveDays)
              if (!Number.isInteger(days) || days < 1 || days > 365) return
              void run(async () => {
                await patch({ archiveAfterSettledDays: days })
                setDialog(null)
              })
            }}
          >
            <Input
              type="number"
              min={1}
              max={365}
              required
              aria-label="Days in Settled"
              value={archiveDays}
              onChange={(event) => setArchiveDays(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {dialog === 'transfer' &&
        repository &&
        (local || client.profile) &&
        (local ? (
          <ProjectTransferDialog
            repository={repository}
            sourceTask={task}
            onClose={() => setDialog(null)}
          />
        ) : client.profile ? (
          <WorkspaceScope profile={client.profile}>
            <ProjectTransferDialog
              repository={repository}
              sourceTask={task}
              onClose={() => setDialog(null)}
            />
          </WorkspaceScope>
        ) : null)}
      <Dialog open={dialog === 'project'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>{repository?.name} settings</DialogTitle>
          <DialogDescription>{repository?.path}</DialogDescription>
          {repository && (
            <ProjectSettings
              repository={repository}
              onNavigate={() => setDialog(null)}
              onDeleted={(refreshError) => {
                if (refreshError)
                  onError(
                    `Project deleted, but the project list could not refresh: ${refreshError}`,
                  )
                setDialog(null)
                onDeselect()
                onProjectDeleted?.()
                host.navigate({ viewId: 'tasks' })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
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
