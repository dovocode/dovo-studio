import {
  watchMessage,
  watchMessagePreview,
  randomUUID,
  turnSettingsLabel,
  type PendingMessage,
} from '@dovo/protocol'
import { WatchMessageCard } from './watch-message'
import { useQueueEdit } from '../composer/queue-edit'
import { useRef, type DragEvent } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  Eye,
  Clock3,
  SlidersHorizontal,
  Copy,
  CornerUpRight,
  GripVertical,
  Pencil,
  Pause,
  Play,
  X,
} from 'lucide-react'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import {
  Dialog,
  DialogContent,
  DialogTitle,
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
}: {
  task: Task
  embedded?: boolean
  pending?: readonly PendingMessage[] | null
}) {
  const { request, connected } = useWorkspace(),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const [selectedId, setSelectedId] = useApplicationState<string | null>(null)
  const selected = task.queue?.find((message) => message.id === selectedId)
  const selectedWatch = selected ? watchMessage(selected) : null
  const duplicateIds = useRef(new Map<string, string>())
  const editor = useQueueEdit()
  const queue = task.queue ?? []
  const firstPaused = queue.findIndex((message) => message.paused)
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
    connected &&
    !busy &&
    !task.archived &&
    !task.archivedAt &&
    confirmed.length > 1 &&
    confirmed.some((message) => message.id === id)
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
    edit?: { beforeMessageId?: string | null },
  ) => {
    const duplicateKey = `${task.id}:${messageId}`
    const duplicateMessageId =
      action === 'duplicate' ? (duplicateIds.current.get(duplicateKey) ?? randomUUID()) : undefined
    if (duplicateMessageId) duplicateIds.current.set(duplicateKey, duplicateMessageId)
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
          duplicateMessageId,
          beforeMessageId: edit?.beforeMessageId,
        },
        responses.ok,
      )
      if (duplicateMessageId) duplicateIds.current.delete(duplicateKey)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!queue.length) return null
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
        embedded={embedded}
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
                : task.queuePaused || queue[0]?.paused
                  ? 'Paused'
                  : 'Runs after this turn'}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              {(queue[0] && watchMessagePreview(queue[0])) ||
                queue[0]?.attachments?.map((file) => file.name).join(', ')}
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
          {queue.map((message, index) => {
            const paused = !!(message.paused || task.queuePaused)
            const blockedBy = firstPaused >= 0 && firstPaused < index ? firstPaused + 1 : undefined
            const state = [
              paused ? 'Paused' : '',
              blockedBy ? `Waiting behind paused message ${blockedBy}` : '',
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <QueueItem
                key={message.id}
                className={[
                  'relative ml-2 min-w-0 gap-1 rounded-none border-l border-border/60 sm:gap-2',
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
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums"
                >
                  {index + 1}
                </span>
                <span
                  className="flex w-3 shrink-0 items-center justify-center"
                  role={state ? 'img' : undefined}
                  aria-label={state || undefined}
                  title={state || undefined}
                >
                  {paused ? (
                    <Pause size={11} className="text-status-warning" />
                  ) : blockedBy ? (
                    <Clock3 size={11} className="text-muted-foreground" />
                  ) : null}
                </span>
                {queue.length > 1 && (
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
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    onKeyDown={(event) => {
                      const source = confirmed.findIndex((item) => item.id === message.id)
                      if (!canMove(message.id)) return
                      if (event.key === 'ArrowUp' && source > 0) {
                        event.preventDefault()
                        void act('move', message.id, { beforeMessageId: confirmed[source - 1].id })
                      }
                      if (event.key === 'ArrowDown' && source < confirmed.length - 1) {
                        event.preventDefault()
                        void act('move', message.id, {
                          beforeMessageId: confirmed[source + 2]?.id ?? null,
                        })
                      }
                    }}
                    onDragEnd={clearDrag}
                  >
                    <GripVertical size={12} />
                  </IconButton>
                )}
                <QueueItemContent
                  title={
                    watchMessagePreview(message) ||
                    message.attachments?.map((file) => file.name).join(', ')
                  }
                >
                  {watchMessagePreview(message) ||
                    message.attachments?.map((f) => f.name).join(', ')}
                  {message.text && message.attachments?.length
                    ? ` · ${message.attachments.length} files`
                    : ''}
                </QueueItemContent>
                {watchMessage(message) && (
                  <IconButton
                    label={`View queued update ${index + 1}`}
                    className="size-6"
                    onClick={() => setSelectedId(message.id)}
                  >
                    <Eye size={12} />
                  </IconButton>
                )}
                {message.turnSettings && (
                  <span
                    className="flex size-3 shrink-0 items-center text-muted-foreground"
                    role="img"
                    aria-label={`Custom turn settings: ${turnSettingsLabel(message.turnSettings)}`}
                    title={turnSettingsLabel(message.turnSettings)}
                  >
                    <SlidersHorizontal size={12} />
                  </span>
                )}
                {pending?.some((item) => item.message.id === message.id) && (
                  <span
                    role="status"
                    className="max-w-[30%] shrink truncate text-muted-foreground"
                    title={
                      pending?.find((item) => item.message.id === message.id)?.state === 'failed'
                        ? 'Retry from composer'
                        : 'Waiting for confirmation'
                    }
                  >
                    {pending?.find((item) => item.message.id === message.id)?.state === 'failed'
                      ? 'Retry from composer'
                      : 'Waiting for confirmation'}
                  </span>
                )}
                <IconButton
                  label={`${message.paused || task.queuePaused ? 'Resume' : 'Pause'} queued message ${index + 1}`}
                  className={`size-6 ${message.paused || task.queuePaused ? 'text-primary' : ''}`}
                  disabled={
                    !connected ||
                    busy ||
                    task.archived ||
                    !!task.archivedAt ||
                    !!message.steering ||
                    pendingIds.has(message.id)
                  }
                  onClick={() =>
                    void act(
                      message.paused || task.queuePaused ? 'resume-message' : 'pause-message',
                      message.id,
                    )
                  }
                >
                  {message.paused || task.queuePaused ? <Play size={12} /> : <Pause size={12} />}
                </IconButton>
                <IconButton
                  label={`Edit queued message ${index + 1}`}
                  className="size-6"
                  disabled={
                    !connected ||
                    busy ||
                    task.archived ||
                    !!task.archivedAt ||
                    !!message.steering ||
                    !editor ||
                    !!editor.editingId ||
                    pending?.some((item) => item.message.id === message.id)
                  }
                  onClick={() => editor?.begin(message)}
                >
                  <Pencil size={12} />
                </IconButton>
                <IconButton
                  label={`Duplicate queued message ${index + 1}`}
                  className="size-6"
                  disabled={
                    !connected ||
                    busy ||
                    task.archived ||
                    !!task.archivedAt ||
                    !!message.steering ||
                    pendingIds.has(message.id) ||
                    queue.length >= 50
                  }
                  onClick={() => void act('duplicate', message.id)}
                >
                  <Copy size={12} />
                </IconButton>
                <IconButton
                  label={`Steer with queued message ${index + 1}`}
                  title={
                    message.turnSettings
                      ? 'Edit this message to use thread defaults before steering'
                      : undefined
                  }
                  className="size-6"
                  disabled={
                    !connected ||
                    busy ||
                    pending?.some((item) => item.message.id === message.id) ||
                    task.archived ||
                    !!task.archivedAt ||
                    !!message.steering ||
                    !task.activeRunId ||
                    !!editor?.editingId ||
                    task.status !== 'running' ||
                    !!message.turnSettings
                  }
                  onClick={() => void act('steer', message.id)}
                >
                  <CornerUpRight size={12} />
                </IconButton>
                <IconButton
                  label={`Cancel queued message ${index + 1} and return it to the composer`}
                  className="size-6"
                  disabled={
                    !connected ||
                    busy ||
                    task.archived ||
                    !!task.archivedAt ||
                    !!message.steering ||
                    !!editor?.editingId ||
                    pending?.some((item) => item.message.id === message.id)
                  }
                  onClick={() => void act('restore', message.id)}
                >
                  <X size={12} />
                </IconButton>
              </QueueItem>
            )
          })}
        </QueueList>
        {error && (
          <p role="alert" className="px-2 py-1 text-destructive">
            {error}
          </p>
        )}
      </Queue>
      <Dialog
        open={!!selectedWatch}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent>
          <DialogTitle>Queued update</DialogTitle>
          {selectedWatch && <WatchMessageCard update={selectedWatch} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
