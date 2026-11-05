import {
  prepareSideThread,
  finishSideThread,
  useSideThreadSource,
} from '@dovo/studio-core/side-thread-creation'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CornerDownLeft,
  ExternalLink,
  GitBranchPlus,
  PanelRight,
  Trash2,
  MessagesSquare,
  X,
} from 'lucide-react'
import {
  randomUUID,
  sideThreadAttention,
  sideThreadAttentionTarget,
  type SideThreadAttention,
} from '@dovo/protocol'
import { formatDateTime, responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, IconButton, cn } from '@dovo/studio-ui'
import {
  bringBackIssue,
  sideThreadOf,
  sideThreadHandoffResponse,
  sideThreadResponse,
  type SideThreadHandoff,
  sideThreadsOf,
  sideThreadProvenance,
  unusedSideDraft,
  type SideThreadLink,
} from '../../detail/side-threads'
import { ReviewSideThreadChangesButton } from '../../detail/side-thread-changes'

const statusLabels: Record<Task['status'], string> = {
  draft: 'Draft',
  running: 'Working',
  review: 'Ready',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
}

/** Creates a draft agent side chat. A retry after an uncertain response reuses the same child id. */
export function useCreateSideThread(parentId: string) {
  const { request, connected, activeRuntimeId } = useWorkspace()
  const scope = JSON.stringify([activeRuntimeId, parentId])
  const current = useSideThreadSource(scope)
  const attempt = useRef<{ key: string; childId: string } | null>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async (objective?: string) => {
    if (pending.current || !connected) return undefined
    const key = JSON.stringify([parentId, objective ?? ''])
    if (attempt.current?.key !== key) attempt.current = { key, childId: randomUUID() }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const childId = prepareSideThread(scope, attempt.current.childId, objective ?? '')
      const result = await request(
        '/api/tasks/side-thread/create',
        {
          id: parentId,
          childId,
          ...(objective ? { objective } : {}),
        },
        sideThreadResponse,
      )
      finishSideThread(scope, childId)
      attempt.current = null
      return current() ? result.id : undefined
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { create, busy, error, setError }
}

/**
 * Returns a finished side chat's exact handoff for the parent's local draft. Nothing runs
 * automatically; the caller appends it once through the parent composer.
 */
export function useBringBack(scope: string) {
  const { request, connected, activeRuntimeId } = useWorkspace()
  const current = useSideThreadSource(JSON.stringify([activeRuntimeId, scope]))
  const pending = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const bringBack = async (child: Task, parent: Task | undefined) => {
    const issue = bringBackIssue(child, parent)
    if (pending.current || !connected || issue) {
      if (issue) setError({ id: child.id, message: issue })
      return undefined
    }
    pending.current = true
    setBusy(child.id)
    setError(null)
    try {
      const result = await request(
        '/api/tasks/side-thread/bring-back',
        { id: child.id, expectedDraft: parent?.draft ?? '' },
        sideThreadHandoffResponse,
      )
      return current() ? result : undefined
    } catch (cause) {
      setError({ id: child.id, message: cause instanceof Error ? cause.message : String(cause) })
      return undefined
    } finally {
      pending.current = false
      setBusy('')
    }
  }
  return { bringBack, busy, error, connected }
}

export function BringBackButton({
  child,
  parent,
  onDone,
  className,
}: {
  child: Task
  parent: Task | undefined
  onDone?: (handoff: SideThreadHandoff) => void
  className?: string
}) {
  const { bringBack, busy, error, connected } = useBringBack(JSON.stringify([child.id, parent?.id]))
  const reason = useId()
  // A lost connection only pauses the action; the same receipt is retried once reconnected.
  const issue = connected ? bringBackIssue(child, parent) : 'Reconnect to bring back results.'
  // Unavailable stays focusable, so keyboard and screen reader users can reach the reason.
  const unavailable = !!issue || !!busy
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[0.6875rem] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        aria-disabled={unavailable || undefined}
        aria-describedby={issue ? reason : undefined}
        title={
          issue ||
          `Add this side chat’s results to the ${parent ? `“${parent.title}”` : 'parent'} draft for review`
        }
        aria-label={`Bring back results from ${child.title}`}
        onClick={() => {
          if (busy) return
          void bringBack(child, parent).then((handoff) => {
            if (handoff) onDone?.(handoff)
          })
        }}
      >
        <CornerDownLeft className="size-3" />
        {busy ? 'Bringing back…' : 'Bring back'}
      </Button>
      {issue && (
        <span id={reason} className="sr-only">
          {issue}
        </span>
      )}
      {error?.id === child.id && (
        <span role="alert" className="min-w-0 truncate text-[0.6875rem] text-destructive">
          {error.message}
        </span>
      )}
    </span>
  )
}

/**
 * Most side chats start from a full snapshot, explained once in the empty side chat list. Only a
 * committed-only or separate-directory start gets a short note, with its details on request.
 */
export function SideThreadProvenance({
  link,
  className,
}: {
  link: Pick<SideThreadLink, 'source' | 'contextMessageCount'>
  className?: string
}) {
  const { files, context, note, partial } = sideThreadProvenance(link)
  if (!note) return null
  return (
    <details
      data-side-chat-source={link.source}
      className={cn(
        'min-w-0 text-[0.6875rem] leading-relaxed',
        partial ? 'text-status-warning' : 'text-muted-foreground',
        className,
      )}
    >
      <summary className="cursor-pointer select-none">{note}</summary>
      <p className="mt-1">
        {files} {context}
      </p>
    </details>
  )
}

const attentionLabels: Record<SideThreadAttention, string> = {
  approval: 'Needs approval',
  input: 'Needs input',
}
const attentionActions: Record<SideThreadAttention, string> = {
  approval: 'Open approval',
  input: 'Answer',
}

/** Pending requests against the current workspace, including unsaved local thread changes. */
export function useSideThreadAttention() {
  const { workspace, snapshot } = useWorkspace()
  const approvals = snapshot?.approvals
  const questions = snapshot?.questions
  return useMemo(
    () => ({ workspace, approvals: approvals ?? [], questions: questions ?? [] }),
    [workspace, approvals, questions],
  )
}

export function SideThreadAttentionBadge({ kind }: { kind: SideThreadAttention }) {
  return (
    <span
      data-side-chat-attention={kind}
      className="shrink-0 rounded bg-status-warning/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-status-warning"
    >
      {attentionLabels[kind]}
    </span>
  )
}

/**
 * Brings a side chat's approval or question into view through its normal controls. The side
 * chat may still be loading its conversation, so this waits briefly for them to render.
 */
export function focusSideThreadAttention(childId: string, kind: SideThreadAttention) {
  const selector = `[data-human-input="${kind === 'approval' ? 'approval' : 'question'}"][data-human-input-task="${CSS.escape(childId)}"]`
  const deadline = Date.now() + 3000
  const attempt = () => {
    const controls = document.querySelector<HTMLElement>(selector)
    if (!controls) {
      if (Date.now() < deadline) requestAnimationFrame(attempt)
      return
    }
    controls.scrollIntoView({ block: 'nearest' })
    const first = controls.querySelector<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex="0"]',
    )
    ;(first ?? controls).focus({ preventScroll: true })
  }
  requestAnimationFrame(attempt)
}

/** A parent shows when any of its side chats, or their delegated agents, waits for someone. */
export function SideThreadAttentionBanner({
  task,
  onAttend,
}: {
  task: Task
  onAttend: (childId: string, kind: SideThreadAttention) => void
}) {
  const attention = useSideThreadAttention()
  const target = sideThreadAttentionTarget(attention, task.id)
  if (!target) return null
  const child = attention.workspace.tasks.find((item) => item.id === target.id)
  return (
    <div
      role="status"
      data-side-chat-attention-banner={target.kind}
      className="flex shrink-0 items-center gap-2 border-b bg-status-warning/10 px-4 py-1.5 text-xs"
    >
      <GitBranchPlus aria-hidden className="size-3.5 shrink-0 text-status-warning" />
      <span className="min-w-0 flex-1 truncate">
        Side chat <span className="font-medium">{child?.title ?? 'Untitled'}</span>{' '}
        {target.kind === 'approval' ? 'is waiting for approval.' : 'is waiting for your answer.'}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[0.6875rem]"
        onClick={() => onAttend(target.id, target.kind)}
      >
        {attentionActions[target.kind]}
      </Button>
    </div>
  )
}

/**
 * Discards a prepared side chat that never ran. It only happens on an explicit, confirmed click;
 * the runtime refuses once the side chat has started.
 */
export function DiscardSideDraft({
  child,
  onDiscarded,
}: {
  child: Task
  onDiscarded?: (childId: string) => void
}) {
  const { request, connected, activeRuntimeId } = useWorkspace()
  const current = useSideThreadSource(JSON.stringify([activeRuntimeId, child.id]))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!unusedSideDraft(child)) return null
  const discard = async () => {
    if (busy || !connected) return
    setBusy(true)
    setError('')
    try {
      await request('/api/tasks/side-thread/discard', { id: child.id }, responses.ok)
      if (current()) onDiscarded?.(child.id)
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {confirming ? (
        <>
          <span className="text-[0.6875rem] text-muted-foreground">Discard this unused draft?</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[0.6875rem] text-destructive"
            disabled={!connected || busy}
            onClick={() => void discard()}
          >
            {busy ? 'Discarding…' : 'Discard'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[0.6875rem]"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
        </>
      ) : (
        <IconButton
          label={`Discard unused draft ${child.title}`}
          className="size-6"
          disabled={!connected}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
      {error && (
        <span role="alert" className="min-w-0 truncate text-[0.6875rem] text-destructive">
          {error}
        </span>
      )}
    </span>
  )
}

/** Banner for a side chat opened on its own, with a way back to the thread it came from. */
export function SideThreadBar({
  task,
  link,
  onReturn,
  onBroughtBack,
  onDiscarded,
}: {
  task: Task
  link: SideThreadLink
  onReturn: (parentId: string) => void
  onBroughtBack: (handoff: SideThreadHandoff) => void
  onDiscarded: (childId: string) => void
}) {
  const { workspace } = useWorkspace()
  const parent = workspace.tasks.find((item) => item.id === link.parentTaskId)
  return (
    <div
      role="region"
      aria-label="Side chat"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-sidebar/60 px-4 py-1.5 text-xs"
    >
      <GitBranchPlus aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Side chat of{' '}
        <span className="font-medium text-foreground">
          {parent?.title ?? 'an unavailable thread'}
        </span>
      </span>
      <SideThreadProvenance link={link} />
      <DiscardSideDraft child={task} onDiscarded={onDiscarded} />
      {!unusedSideDraft(task) && (
        <>
          <ReviewSideThreadChangesButton task={task} />
          <BringBackButton child={task} parent={parent} onDone={onBroughtBack} />
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[0.6875rem]"
        disabled={!parent}
        onClick={() => onReturn(link.parentTaskId)}
      >
        Return to parent
      </Button>
    </div>
  )
}

/**
 * Agent side chats are ordinary threads with their own checkout, model and approvals.
 * Read-only questions share the panel without creating an agent checkout.
 */
export function SideThreadsPanel({
  task,
  openId,
  onOpen,
  onOpenThread,
  onAttend,
  onBroughtBack,
  onDiscarded,
  readOnlyQuestions,
  onClose,
}: {
  task: Task
  /** The side chat currently shown beside this one. */
  openId?: string
  onOpen: (childId: string) => void
  onOpenThread: (childId: string) => void
  onAttend: (childId: string, kind: SideThreadAttention) => void
  onBroughtBack: (handoff: SideThreadHandoff, child: Task) => void
  onDiscarded: (childId: string) => void
  readOnlyQuestions: ReactNode
  onClose?: () => void
}) {
  const { workspace, connected } = useWorkspace()
  const attention = useSideThreadAttention()
  const children = sideThreadsOf(workspace.tasks, task.id)
  const { create, busy, error } = useCreateSideThread(task.id)
  const questionCount = task.sideChats?.length ?? 0
  const [view, setView] = useState<'threads' | 'read-only'>('threads')
  // Side chats do not start their own side chats; bring results back to the parent instead.
  const nested = !!sideThreadOf(task)
  const repository = workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const eligible = !!repository && (!repository.kind || repository.kind === 'scratch')
  const readOnly = !!task.archivedAt || nested || !eligible
  return (
    <section aria-label="Agent side chats" className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'studio-thread-tools-header relative flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2',
          onClose && 'pr-12',
        )}
      >
        <MessagesSquare size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-16 flex-1 truncate text-xs font-medium">Side chats</h2>
        {view === 'threads' && (children.length > 0 || nested) && (
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || readOnly || busy}
            onClick={() =>
              void create().then((id) => {
                if (id) onOpen(id)
              })
            }
          >
            <GitBranchPlus className="size-3.5" />
            {busy ? 'Creating…' : 'New side chat'}
          </Button>
        )}
        {onClose && (
          <IconButton
            label="Close side chats"
            className="absolute right-3 top-2 size-7"
            onClick={onClose}
          >
            <X size={14} />
          </IconButton>
        )}
      </div>
      {!eligible && view === 'threads' && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Agent side chats require a Git project or General workspace.
        </p>
      )}
      <div
        role="tablist"
        aria-label="Side conversations"
        className="flex gap-1 border-b px-3 py-1.5"
      >
        {(
          [
            ['threads', `Agents (${children.length})`],
            ['read-only', `Read-only (${questionCount})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              'rounded-md border border-transparent px-2 py-1 text-xs',
              view === id
                ? 'studio-selected-surface font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {view === 'read-only' ? (
        readOnlyQuestions
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {nested && (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              This is a side chat. Bring its results back to the parent thread, or start another
              side chat from there.
            </p>
          )}
          {!children.length && (
            <div className="studio-panel-empty">
              <MessagesSquare className="studio-panel-empty-icon" aria-hidden="true" />
              <h3 className="text-sm font-medium">No agent side chats yet.</h3>
              {!nested && (
                <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Explore in a separate checkout, then bring the results back to this thread’s
                  draft.
                </p>
              )}
              {!nested && (
                <Button
                  size="sm"
                  disabled={!connected || readOnly || busy}
                  onClick={() =>
                    void create().then((id) => {
                      if (id) onOpen(id)
                    })
                  }
                >
                  <GitBranchPlus className="size-3.5" />
                  {busy ? 'Creating…' : 'New side chat'}
                </Button>
              )}
            </div>
          )}
          <ul className="space-y-2">
            {children.map((child) => {
              const kind = sideThreadAttention(attention, child.id)
              return (
                <li
                  key={child.id}
                  className={cn(
                    'space-y-2 rounded-lg border p-2.5',
                    openId === child.id && 'border-primary/50 bg-muted/40',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline disabled:no-underline"
                      disabled={!!child.archivedAt}
                      aria-current={openId === child.id || undefined}
                      onClick={() => onOpen(child.id)}
                      title={child.title}
                    >
                      {child.title}
                    </button>
                    {kind && <SideThreadAttentionBadge kind={kind} />}
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                      {child.archivedAt
                        ? 'Archived'
                        : unusedSideDraft(child)
                          ? 'Unsent draft'
                          : statusLabels[child.status]}
                    </span>
                  </div>
                  {child.sideThread && <SideThreadProvenance link={child.sideThread} />}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-auto text-[0.6875rem] text-muted-foreground">
                      {formatDateTime(child.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {kind && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[0.6875rem]"
                        aria-label={`${attentionActions[kind]} in ${child.title}`}
                        onClick={() => onAttend(child.id, kind)}
                      >
                        {attentionActions[kind]}
                      </Button>
                    )}
                    <IconButton
                      label="Show beside this thread"
                      className="size-6"
                      disabled={!!child.archivedAt}
                      aria-pressed={openId === child.id}
                      onClick={() => onOpen(child.id)}
                    >
                      <PanelRight className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="Open side chat as a thread"
                      className="size-6"
                      onClick={() => onOpenThread(child.id)}
                    >
                      <ExternalLink className="size-3.5" />
                    </IconButton>
                    <DiscardSideDraft child={child} onDiscarded={onDiscarded} />
                    {!unusedSideDraft(child) && (
                      <BringBackButton
                        child={child}
                        parent={task}
                        onDone={(handoff) => onBroughtBack(handoff, child)}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
