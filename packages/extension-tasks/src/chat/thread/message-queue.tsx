import { turnSettingsLabel, type TurnSettings, type PendingMessage } from '@dovo/protocol'
import { resolveTaskAgent } from '@dovo/studio-core'
import { TurnModelControls } from '../composer/turn-model-controls'
import type { DragEvent } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { ArrowUp, ArrowDown, CornerUpRight, GripVertical, Pencil, X } from 'lucide-react'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  IconButton,
  Queue,
  QueueSectionTrigger,
  QueueList,
  QueueItem,
  QueueItemContent,
} from '@dovo/studio-ui'
export function MessageQueue({
  task,
  pending,
  embedded = false,
  onEditingChange,
}: {
  task: Task
  embedded?: boolean
  onEditingChange?: (editing: boolean) => void
  pending?: readonly PendingMessage[] | null
}) {
  const { request, connected, workspace, snapshot } = useWorkspace(),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const [editing, setEditing] = useApplicationState<{
    id: string
    text: string
    expectedText: string
    turnSettings: TurnSettings | null
    expectedTurnSettings: TurnSettings | null
  } | null>(null)
  const changeEditing = (value: typeof editing) => {
    setEditing(value)
    onEditingChange?.(!!value)
  }
  const queue = task.queue ?? []
  const agent = resolveTaskAgent(task, workspace.agents)
  const [dragging, setDragging] = useApplicationState<{ taskId: string; messageId: string } | null>(
    null,
  )
  const [dropTarget, setDropTarget] = useApplicationState<{
    messageId: string
    edge: 'before' | 'after'
  } | null>(null)
  const pendingIds = new Set(pending?.map((item) => item.message.id))
  const confirmed = queue.filter((message) => !pendingIds.has(message.id))
  const canMove = (id: string) =>
    connected && !busy && confirmed.length > 1 && confirmed.some((message) => message.id === id)
  const draggingHere = dragging?.taskId === task.id && canMove(dragging.messageId)
  const clearDrag = () => {
    setDragging(null)
    setDropTarget(null)
  }
  const edgeAt = (event: DragEvent<HTMLLIElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const queuedPending = pending?.find((item) => item.destination === 'queue')
  const act = async (
    action: string,
    messageId?: string,
    edit?: {
      text?: string
      expectedText?: string
      beforeMessageId?: string | null
      turnSettings?: TurnSettings | null
      expectedTurnSettings?: TurnSettings | null
    },
  ) => {
    setBusy(true)
    setError('')
    try {
      await request(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          runId: action === 'steer' ? task.activeRunId : undefined,
          messageId,
          ...(edit
            ? {
                text: edit.text,
                expectedText: edit.expectedText,
                ...(snapshot?.queuedTurnSettingsSupported
                  ? {
                      turnSettings: edit.turnSettings,
                      expectedTurnSettings: edit.expectedTurnSettings,
                    }
                  : {}),
                beforeMessageId: edit.beforeMessageId,
              }
            : {}),
        },
        responses.ok,
      )
      if (action === 'edit') changeEditing(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!queue.length && !editing) return null
  return (
    <div
      className={
        embedded
          ? 'text-xs'
          : 'relative mx-auto -mb-3 w-[calc(100%-24px)] max-w-[calc(var(--chat-max)-1.5rem)] text-xs'
      }
      aria-label="Queued follow-ups"
    >
      <Queue
        open={embedded || undefined}
        className={
          embedded
            ? 'rounded-none border-0 bg-transparent p-0 shadow-none'
            : 'rounded-b-none rounded-t-xl border-b-0 bg-muted/15 p-0 pb-3 shadow-none'
        }
      >
        {!embedded && (
          <QueueSectionTrigger className="min-h-7 rounded-b-none rounded-t-xl bg-transparent px-2 py-1 text-[0.6875rem] font-normal">
            <span className="shrink-0">
              {queue.length} queued ·{' '}
              {queuedPending
                ? queuedPending.state === 'failed'
                  ? 'Send failed'
                  : queuedPending.state === 'saved'
                    ? 'Saved for reconnect'
                    : 'Sending…'
                : task.queuePaused
                  ? 'Paused'
                  : 'Runs after this turn'}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              {queue[0]?.text || queue[0]?.attachments?.map((file) => file.name).join(', ')}
            </span>
          </QueueSectionTrigger>
        )}
        <QueueList
          className="mt-0"
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(
                event.relatedTarget instanceof Node ? event.relatedTarget : null,
              )
            )
              setDropTarget(null)
          }}
        >
          {queue.map((message, index) => (
            <QueueItem
              key={message.id}
              className={[
                'relative',
                draggingHere && dragging.messageId === message.id ? 'opacity-40' : '',
                draggingHere && dropTarget?.messageId === message.id
                  ? dropTarget.edge === 'before'
                    ? 'before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:border-t-2 before:border-primary'
                    : 'after:pointer-events-none after:absolute after:inset-x-2 after:bottom-0 after:border-b-2 after:border-primary'
                  : '',
              ].join(' ')}
              onDragOver={(event) => {
                if (!draggingHere) return
                if (!canMove(message.id) || dragging.messageId === message.id) {
                  setDropTarget(null)
                  return
                }
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget({ messageId: message.id, edge: edgeAt(event) })
              }}
              onDrop={(event) => {
                if (!draggingHere) return
                event.preventDefault()
                event.stopPropagation()
                const source = confirmed.findIndex((item) => item.id === dragging.messageId)
                const target = confirmed.findIndex((item) => item.id === message.id)
                const edge = edgeAt(event)
                clearDrag()
                if (target < 0 || source === target) return
                const beforeMessageId =
                  edge === 'before' ? message.id : (confirmed[target + 1]?.id ?? null)
                if (
                  beforeMessageId === dragging.messageId ||
                  beforeMessageId === (confirmed[source + 1]?.id ?? null)
                )
                  return
                void act('move', dragging.messageId, { beforeMessageId })
              }}
            >
              <IconButton
                type="button"
                label={`Drag queued message ${index + 1} to reorder`}
                className="size-5 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
                disabled={!canMove(message.id)}
                draggable={canMove(message.id)}
                onDragStart={(event) => {
                  if (!canMove(message.id)) {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('application/x-dovo-queued-message', message.id)
                  event.dataTransfer.setDragImage(
                    event.currentTarget.closest('li') ?? event.currentTarget,
                    12,
                    12,
                  )
                  setDragging({ taskId: task.id, messageId: message.id })
                }}
                onDragEnd={clearDrag}
              >
                <GripVertical size={12} />
              </IconButton>
              <QueueItemContent title={message.text}>
                {message.text || message.attachments?.map((f) => f.name).join(', ')}
                {message.text && message.attachments?.length
                  ? ` · ${message.attachments.length} files`
                  : ''}
                {message.turnSettings && (
                  <span
                    className="ml-2 text-muted-foreground"
                    title={turnSettingsLabel(message.turnSettings)}
                  >
                    {turnSettingsLabel(message.turnSettings)}
                  </span>
                )}
              </QueueItemContent>
              {pending?.some((item) => item.message.id === message.id) && (
                <span role="status" className="shrink-0 text-muted-foreground">
                  {pending?.find((item) => item.message.id === message.id)?.state === 'failed'
                    ? 'Retry from composer'
                    : 'Waiting for confirmation'}
                </span>
              )}
              <IconButton
                label={`Edit queued message ${index + 1}`}
                className="size-6"
                disabled={
                  !connected || busy || pending?.some((item) => item.message.id === message.id)
                }
                onClick={() =>
                  changeEditing({
                    id: message.id,
                    text: message.text,
                    expectedText: message.text,
                    turnSettings: message.turnSettings ?? null,
                    expectedTurnSettings: message.turnSettings ?? null,
                  })
                }
              >
                <Pencil size={12} />
              </IconButton>
              <IconButton
                label={`Steer with queued message ${index + 1}`}
                className="size-6"
                disabled={
                  !connected ||
                  busy ||
                  pending?.some((item) => item.message.id === message.id) ||
                  task.status !== 'running' ||
                  !!message.turnSettings
                }
                onClick={() => void act('steer', message.id)}
              >
                <CornerUpRight size={12} />
              </IconButton>
              <IconButton
                label={`Move queued message ${index + 1} up`}
                className="size-6"
                disabled={
                  !connected ||
                  busy ||
                  pending?.some((item) => item.message.id === message.id) ||
                  index === 0
                }
                onClick={() => void act('up', message.id)}
              >
                <ArrowUp size={12} />
              </IconButton>
              <IconButton
                label={`Move queued message ${index + 1} down`}
                className="size-6"
                disabled={
                  !connected ||
                  busy ||
                  pending?.some((item) => item.message.id === message.id) ||
                  index === queue.length - 1 ||
                  pending?.some((item) => item.message.id === queue[index + 1]?.id)
                }
                onClick={() => void act('down', message.id)}
              >
                <ArrowDown size={12} />
              </IconButton>
              <IconButton
                label={`Cancel queued message ${index + 1} and return it to the composer`}
                className="size-6"
                disabled={
                  !connected || busy || pending?.some((item) => item.message.id === message.id)
                }
                onClick={() => void act('restore', message.id)}
              >
                <X size={12} />
              </IconButton>
            </QueueItem>
          ))}
        </QueueList>
        {editing && (
          <>
            {!queue.some((message) => message.id === editing.id) && (
              <p role="status" className="text-muted-foreground">
                This message already started or was removed. Your edit is kept below.
              </p>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <textarea
                aria-label="Edit queued message"
                autoFocus
                className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
                value={editing.text}
                onChange={(event) => changeEditing({ ...editing, text: event.target.value })}
                disabled={busy}
              />
              {agent && snapshot?.queuedTurnSettingsSupported && (
                <TurnModelControls
                  inline
                  agent={agent}
                  value={editing.turnSettings}
                  onChange={(turnSettings) => setEditing({ ...editing, turnSettings })}
                  disabled={busy}
                />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={
                    !connected ||
                    busy ||
                    !queue.some((message) => message.id === editing.id) ||
                    (!editing.text.trim() &&
                      !queue.find((message) => message.id === editing.id)?.attachments?.length)
                  }
                  onClick={() => void act('edit', editing.id, editing)}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => changeEditing(null)}
                >
                  Cancel edit
                </Button>
              </div>
            </div>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[0.6875rem]"
          disabled={
            !connected ||
            busy ||
            task.archived ||
            (queue.length === 1 && pending?.some((item) => item.message.id === queue[0]?.id))
          }
          onClick={() => void act(task.queuePaused ? 'resume' : 'pause')}
        >
          {task.queuePaused ? 'Resume queue' : 'Pause queue'}
        </Button>
        {error && (
          <p role="alert" className="px-2 py-1 text-destructive">
            {error}
          </p>
        )}
      </Queue>
    </div>
  )
}
