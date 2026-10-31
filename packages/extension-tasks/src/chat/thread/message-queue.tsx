import {
  watchMessage,
  watchMessagePreview,
  messageSourceFor,
  randomUUID,
  turnSettingsLabel,
  type PendingMessage,
} from '@dovo/protocol'
import { WatchMessageCard } from './watch-message'
import { MessageSource } from './message-source'
import { useQueueEdit } from '../composer/queue-edit'
import { useEffect, useRef, type DragEvent } from 'react'
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
  ArrowUp,
  ArrowDown,
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
const rowActionClass =
  'opacity-0 transition-opacity group-hover/queue-row:opacity-100 group-focus-within/queue-row:opacity-100 [@media(hover:none)]:opacity-100'
export function MessageQueue({
  task,
  pending,
  embedded = false,
}: {
  task: Task
  embedded?: boolean
  pending?: readonly PendingMessage[] | null
}) {
  const { request, connected, workspace, snapshot } = useWorkspace(),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const [selectedId, setSelectedId] = useApplicationState<string | null>(null)
  const selected = task.queue?.find((message) => message.id === selectedId)
  const selectedWatch = selected ? watchMessage(selected) : null
  const actionLock = useRef(false)
  const awaitingOrder = useRef<{
    order: string
    ids: string[]
    action: string
    acknowledged: boolean
    expectedOrder?: string
    duplicateMessageId?: string
    recovered?: boolean
  } | null>(null)
  const [overlay, setOverlay] = useApplicationState<{
    order: string
    fingerprint: string
    ids: string[]
  } | null>(null)
  const [highlightedId, setHighlightedId] = useApplicationState<string | null>(null)
  const [confirmationReleased, setConfirmationReleased] = useApplicationState(false)
  const [acknowledged, setAcknowledged] = useApplicationState(false)
  const highlightedRow = useRef<HTMLLIElement | null>(null)
  const pendingHighlight = useRef<string | null>(null)
  const editor = useQueueEdit()
  const queue = task.queue ?? []
  const authoritativeQueue = workspace.tasks.find((item) => item.id === task.id)?.queue ?? []
  const pausedHead = authoritativeQueue[0]?.paused ? authoritativeQueue[0] : undefined
  const [dragging, setDragging] = useApplicationState<{ taskId: string; messageId: string } | null>(
    null,
  )
  const [dropTarget, setDropTarget] = useApplicationState<{
    messageId: string
    edge: 'before' | 'after'
  } | null>(null)
  const pendingIds = new Set(pending?.map((item) => item.message.id))
  const confirmed = queue.filter((message) => !pendingIds.has(message.id))
  const order = JSON.stringify(authoritativeQueue.map((message) => message.id))
  const fingerprint = JSON.stringify(
    authoritativeQueue.map((message) => [message.id, !!message.steering, !!message.paused]),
  )
  const showOverlay =
    overlay &&
    overlay.order === order &&
    overlay.fingerprint === fingerprint &&
    JSON.stringify(queue.map((message) => message.id)) === order
  const displayQueue = showOverlay
    ? overlay.ids.flatMap((id) => queue.filter((message) => message.id === id))
    : queue
  const firstPaused = displayQueue.findIndex((message) => message.paused)
  const currentOrder = useRef(order)
  currentOrder.current = order
  const currentIds = useRef(authoritativeQueue.map((message) => message.id))
  currentIds.current = authoritativeQueue.map((message) => message.id)
  const finishHandoff = () => {
    const waiting = awaitingOrder.current
    if (!waiting || !waiting.acknowledged) return
    if (
      !waiting.recovered &&
      waiting.expectedOrder !== undefined &&
      waiting.expectedOrder !== currentOrder.current &&
      waiting.order === currentOrder.current
    )
      return
    if (waiting.action === 'duplicate') {
      const added = currentIds.current.filter((id) => !waiting.ids.includes(id))
      const duplicate = waiting.duplicateMessageId
      if (duplicate && currentIds.current.includes(duplicate)) setHighlightedId(duplicate)
      else if (duplicate) pendingHighlight.current = duplicate
      else if (added.length === 1) setHighlightedId(added[0])
    }
    awaitingOrder.current = null
    setAcknowledged(false)
    setConfirmationReleased(false)
    setOverlay(null)
    if (!confirmationReleased) {
      actionLock.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (overlay && (overlay.order !== order || overlay.fingerprint !== fingerprint))
      setOverlay(null)
    finishHandoff()
    if (pendingHighlight.current && currentIds.current.includes(pendingHighlight.current)) {
      setHighlightedId(pendingHighlight.current)
      pendingHighlight.current = null
    }
  }, [order, fingerprint])
  useEffect(() => {
    if (!highlightedId || !highlightedRow.current) return
    highlightedRow.current.scrollIntoView({ block: 'nearest' })
    const timeout = window.setTimeout(() => setHighlightedId(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [highlightedId, order, setHighlightedId])
  const canMove = (id: string) =>
    connected &&
    !busy &&
    !confirmationReleased &&
    JSON.stringify(queue.map((message) => message.id)) === order &&
    !queue.some((message) => message.steering || pendingIds.has(message.id)) &&
    !task.archived &&
    !task.archivedAt &&
    confirmed.length > 1 &&
    confirmed.some((message) => message.id === id && !message.steering)
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
  const startBlocked = !!queuedPending && (!!pausedHead || !!task.queuePaused)
  const act = async (
    action: string,
    messageId?: string,
    edit?: { beforeMessageId?: string | null },
  ) => {
    if (
      actionLock.current ||
      (confirmationReleased && (action === 'move' || action === 'duplicate'))
    )
      return
    if (
      action === 'move' &&
      (!messageId ||
        !canMove(messageId) ||
        (edit?.beforeMessageId && !canMove(edit.beforeMessageId)))
    )
      return
    actionLock.current = true
    const waitsForOrder = action === 'move' || action === 'duplicate'
    if (action === 'move' && messageId) {
      const ids = confirmed.map((message) => message.id).filter((id) => id !== messageId)
      const target = edit?.beforeMessageId ? ids.indexOf(edit.beforeMessageId) : ids.length
      if (target < 0) {
        actionLock.current = false
        return
      }
      ids.splice(target, 0, messageId)
      if (JSON.stringify(ids) === order) {
        actionLock.current = false
        return
      }
      setOverlay({ order, fingerprint, ids })
    }
    if (waitsForOrder)
      awaitingOrder.current = { order, ids: currentIds.current, action, acknowledged: false }
    const duplicateMessageId = action === 'duplicate' ? randomUUID() : undefined
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          runId: action === 'steer' ? task.activeRunId : undefined,
          messageId,
          duplicateMessageId,
          beforeMessageId: edit?.beforeMessageId,
          ...(action === 'move' && snapshot?.promptQueueStagingSupported === true
            ? { expectedMessageIds: authoritativeQueue.map((message) => message.id) }
            : {}),
        },
        responses.queueAction,
      )
      if (waitsForOrder && awaitingOrder.current) {
        awaitingOrder.current.acknowledged = true
        awaitingOrder.current.expectedOrder = result.queueMessageIds
          ? JSON.stringify(result.queueMessageIds)
          : undefined
        awaitingOrder.current.duplicateMessageId = result.duplicateMessageId
        awaitingOrder.current.recovered = result.recovered
        setAcknowledged(true)
        finishHandoff()
      }
    } catch (e) {
      if (waitsForOrder) {
        awaitingOrder.current = null
        setAcknowledged(false)
        setOverlay(null)
      }
      setError(String(e))
    } finally {
      if (!awaitingOrder.current || confirmationReleased) {
        actionLock.current = false
        setBusy(false)
      }
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
      <div className="flex items-center justify-end gap-2 px-2 py-1">
        {awaitingOrder.current && (
          <span role="status">
            {confirmationReleased
              ? 'Queue update not yet confirmed; reordering is unavailable.'
              : 'Waiting for confirmation…'}
          </span>
        )}
        {highlightedId && <span role="status">Message duplicated</span>}
        {busy && acknowledged && (
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-accent"
            onClick={() => {
              setOverlay(null)
              setConfirmationReleased(true)
              actionLock.current = false
              setBusy(false)
            }}
          >
            Stop waiting
          </button>
        )}
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40"
          disabled={
            !connected ||
            busy ||
            !!task.archived ||
            !!task.archivedAt ||
            !!pausedHead?.steering ||
            startBlocked
          }
          title={
            startBlocked
              ? 'Wait for queued prompts to be confirmed before running the queue.'
              : undefined
          }
          onClick={() =>
            void act(
              pausedHead ? 'resume-message' : task.queuePaused ? 'resume' : 'pause',
              pausedHead?.id,
            )
          }
        >
          {pausedHead ? 'Resume first prompt' : task.queuePaused ? 'Run queue' : 'Pause queue'}
        </button>
      </div>
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
          {displayQueue.map((message, index) => {
            const source = messageSourceFor(message)
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
                ref={message.id === highlightedId ? highlightedRow : undefined}
                aria-label={`Queued message ${index + 1} of ${queue.length}, ${message.steering ? 'being delivered' : 'not sent'}`}
                className={[
                  'group/queue-row relative min-h-11 min-w-0 gap-2 rounded-none px-3 py-1.5 focus-within:bg-muted [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/40',
                  message.id === highlightedId
                    ? 'bg-primary/15 ring-1 ring-inset ring-primary'
                    : '',
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
                  if (target < 0 || source === target || !canMove(message.id)) return
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
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums"
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
                    className={`size-5 cursor-grab text-muted-foreground/60 active:cursor-grabbing ${rowActionClass}`}
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
                      if (
                        event.key === 'ArrowUp' &&
                        source > 0 &&
                        canMove(confirmed[source - 1].id)
                      ) {
                        event.preventDefault()
                        void act('move', message.id, { beforeMessageId: confirmed[source - 1].id })
                      }
                      if (
                        event.key === 'ArrowDown' &&
                        source < confirmed.length - 1 &&
                        canMove(confirmed[source + 1].id)
                      ) {
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
                {queue.length > 1 && (
                  <div className="flex shrink-0">
                    <IconButton
                      label={`Move queued message ${index + 1} earlier`}
                      className="size-6"
                      disabled={
                        !canMove(message.id) ||
                        confirmed.findIndex((item) => item.id === message.id) <= 0 ||
                        !canMove(
                          confirmed[confirmed.findIndex((item) => item.id === message.id) - 1]?.id,
                        )
                      }
                      onClick={() => {
                        const source = confirmed.findIndex((item) => item.id === message.id)
                        void act('move', message.id, { beforeMessageId: confirmed[source - 1].id })
                      }}
                    >
                      <ArrowUp size={12} />
                    </IconButton>
                    <IconButton
                      label={`Move queued message ${index + 1} later`}
                      className="size-6"
                      disabled={
                        !canMove(message.id) ||
                        confirmed.findIndex((item) => item.id === message.id) >=
                          confirmed.length - 1 ||
                        !canMove(
                          confirmed[confirmed.findIndex((item) => item.id === message.id) + 1]?.id,
                        )
                      }
                      onClick={() => {
                        const source = confirmed.findIndex((item) => item.id === message.id)
                        void act('move', message.id, {
                          beforeMessageId: confirmed[source + 2]?.id ?? null,
                        })
                      }}
                    >
                      <ArrowDown size={12} />
                    </IconButton>
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                  {source && source.kind !== 'user' && (
                    <div className="min-w-0 [&>*]:font-medium [&>*]:text-foreground">
                      <MessageSource source={source} />
                    </div>
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
                </div>
                {message.plan && (
                  <span
                    className="shrink-0 rounded bg-primary/15 px-1 text-[0.625rem] font-medium text-primary"
                    title="Runs read-only and replies with a plan"
                  >
                    Plan
                  </span>
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
                <div
                  data-queue-actions
                  className={`pointer-events-none absolute right-11 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-md bg-muted p-1 group-hover/queue-row:pointer-events-auto group-focus-within/queue-row:pointer-events-auto [@media(hover:none)]:pointer-events-auto ${rowActionClass}`}
                >
                  {watchMessage(message) && (
                    <IconButton
                      label={`View queued update ${index + 1}`}
                      className="size-6"
                      onClick={() => setSelectedId(message.id)}
                    >
                      <Eye size={12} />
                    </IconButton>
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
                      confirmationReleased ||
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
                </div>
                <IconButton
                  label={`Steer with queued message ${index + 1}`}
                  title={
                    message.plan
                      ? 'Plan-mode messages run as their own read-only turn'
                      : message.turnSettings
                        ? 'Edit this message to use thread defaults before steering'
                        : undefined
                  }
                  className="size-6 shrink-0"
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
                    !!message.turnSettings ||
                    !!message.plan
                  }
                  onClick={() => void act('steer', message.id)}
                >
                  <CornerUpRight size={12} />
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
