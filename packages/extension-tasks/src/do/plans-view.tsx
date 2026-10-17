import { useEffect, useRef, useState } from 'react'
import {
  DO_LIMITS,
  doDiscoverReplySchema,
  doListReplySchema,
  doRunReplySchema,
  type DoDiscoverReply,
  type DoItem,
  type DoRun,
  type DoRunSummary,
  type DoSaveRequest,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button, EmptyState, Input, PageHeader, cn } from '@dovo/studio-ui'
import { Workflow } from 'lucide-react'
import { ItemEditor } from './item-editor'
import { editablePlan, newItem, newPlan, planErrors } from './plan'
import { doThreadOwner } from './thread-owner'

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
const control = 'w-full rounded-md border bg-background px-3 py-2 text-sm'
const activeStatuses = new Set(['running', 'attention', 'cancelling'])
const retryable = new Set(['failed', 'blocked', 'cancelled'])

export function DoPlans({
  profile,
  runId,
  navigationKey,
  onChat,
}: {
  profile: RuntimeProfile
  runId?: string
  navigationKey?: number
  onChat: () => void
}) {
  const { readRuntime, switchRuntime, runtimeRegistry, runtimes } = useWorkspace()
  const host = useStudioHost()
  const [runs, setRuns] = useState<DoRunSummary[]>([])
  const [run, setRun] = useState<DoRun | null>(null)
  const [draft, setDraft] = useState<DoSaveRequest | null>(null)
  const [computers, setComputers] = useState<NonNullable<DoDiscoverReply['computers']>>([
    { id: 'local', name: profile.name || 'This computer', local: true },
  ])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [note, setNote] = useState('')
  const alive = useRef(true)
  const sequence = useRef(0)
  const locked = useRef(false)
  const dirty = !!draft && (!run || JSON.stringify(draft) !== JSON.stringify(editablePlan(run)))
  const errors = draft ? planErrors(draft) : []
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      sequence.current++
    }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const refreshList = async () => {
    const reply = await readRuntime(profile, '/api/do/list', {}, doListReplySchema)
    if (alive.current) setRuns(reply.runs)
  }
  const refreshCatalog = async () => {
    const reply = await readRuntime(profile, '/api/do/discover', {}, doDiscoverReplySchema)
    if (alive.current)
      setComputers(
        reply.computers ?? [{ id: 'local', name: profile.name || 'This computer', local: true }],
      )
  }
  const refresh = async () => {
    if (locked.current) return
    locked.current = true
    setLoading(true)
    setError('')
    const results = await Promise.allSettled([refreshList(), refreshCatalog()])
    if (!alive.current) return
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [message(result.reason)] : [],
    )
    setError(failures.join(' · '))
    setLoading(false)
    locked.current = false
  }
  useEffect(() => {
    void refresh()
  }, [])
  const leaveDraft = () => !dirty || window.confirm('Discard unsaved plan changes?')
  const openRun = async (id: string) => {
    if (locked.current || !leaveDraft()) return
    locked.current = true
    const request = ++sequence.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const reply = await readRuntime(profile, '/api/do/read', { id }, doRunReplySchema)
      if (!alive.current || request !== sequence.current) return
      setRun(reply.run)
      setDraft(null)
      setNote('')
    } catch (cause) {
      if (alive.current && request === sequence.current) setError(message(cause))
    } finally {
      if (alive.current && request === sequence.current) {
        setBusy(false)
        locked.current = false
      }
    }
  }
  const openedLink = useRef<string | null>(null)
  useEffect(() => {
    if (!runId || loading || busy) return
    const link = JSON.stringify([runId, navigationKey])
    if (openedLink.current === link) return
    openedLink.current = link
    void openRun(runId)
  }, [runId, navigationKey, loading, busy])
  // Poll runtime-owned state only; draft editing never competes with a background read.
  useEffect(() => {
    if (!run || !activeStatuses.has(run.status)) return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!locked.current) {
        const version = sequence.current
        try {
          const reply = await readRuntime(profile, '/api/do/read', { id: run.id }, doRunReplySchema)
          if (current && alive.current && version === sequence.current) setRun(reply.run)
        } catch (cause) {
          if (current && alive.current && version === sequence.current)
            setError(`Status refresh failed: ${message(cause)}`)
        }
      }
      if (current) timer = setTimeout(() => void poll(), 3000)
    }
    timer = setTimeout(() => void poll(), 3000)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [run?.id, run?.status, profile, readRuntime])
  const mutate = async (
    operation: 'save' | 'start' | 'retry' | 'cancel' | 'complete',
    input: unknown,
  ) => {
    if (locked.current) return
    locked.current = true
    const request = ++sequence.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const reply = await readRuntime(profile, `/api/do/${operation}`, input, doRunReplySchema)
      if (!alive.current || request !== sequence.current) return
      setRun(reply.run)
      setDraft(
        operation === 'save' && reply.run.status === 'draft' ? editablePlan(reply.run) : null,
      )
      setNotice(
        operation === 'save'
          ? 'Plan saved. Review it, then choose Start plan.'
          : operation === 'complete'
            ? 'Human review recorded.'
            : operation === 'cancel'
              ? 'Cancellation requested. Each owned thread must confirm it has stopped.'
              : '',
      )
      try {
        await refreshList()
      } catch (cause) {
        if (alive.current && request === sequence.current)
          setError(`Plan updated, but refreshing saved plans failed: ${message(cause)}`)
      }
    } catch (cause) {
      if (alive.current && request === sequence.current) setError(message(cause))
    } finally {
      if (alive.current && request === sequence.current) {
        locked.current = false
        setBusy(false)
      }
    }
  }
  const openThread = async (item: DoItem) => {
    if (!item.state.taskId || locked.current) return
    const owner = doThreadOwner(runtimes, profile.id, item.target.runtimeId)
    if (!owner) {
      setError(
        'This target computer is not paired in this Studio. Pair it in Settings → Devices & runtime to open its thread.',
      )
      return
    }
    const current = host.taskNavigationGuard?.() ?? (() => alive.current)
    locked.current = true
    setBusy(true)
    setError('')
    try {
      if (owner.id !== runtimeRegistry.activeId) await switchRuntime(owner.id)
      if (current()) host.navigate({ viewId: 'tasks', entityId: item.state.taskId })
    } catch (cause) {
      if (alive.current) setError(message(cause))
    } finally {
      if (alive.current) {
        locked.current = false
        setBusy(false)
      }
    }
  }
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Do workspace">
      <PageHeader
        title="Do plans"
        description="Review saved proposals and approve the exact plan you want to run."
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || loading}
          onClick={() => {
            if (leaveDraft()) onChat()
          }}
        >
          New chat
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
        <Button
          size="sm"
          disabled={busy || loading}
          onClick={() => {
            if (!leaveDraft()) return
            sequence.current++
            setRun(null)
            setDraft(newPlan())
            setError('')
            setNotice('')
            setNote('')
          }}
        >
          New plan
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid w-full max-w-7xl min-w-0 gap-6 p-4 sm:p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav
            aria-label="Saved Do plans"
            className="max-h-64 min-w-0 space-y-2 overflow-y-auto lg:max-h-none"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved plans
            </h2>
            {loading && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading plans…
              </p>
            )}
            {!loading && !runs.length && (
              <p className="text-sm text-muted-foreground">Your saved plans will appear here.</p>
            )}
            {runs.map((entry) => (
              <button
                type="button"
                key={entry.id}
                disabled={busy || loading}
                aria-current={run?.id === entry.id ? 'true' : undefined}
                onClick={() => void openRun(entry.id)}
                className={cn(
                  'w-full min-w-0 rounded-lg border p-3 text-left hover:bg-accent disabled:opacity-50',
                  run?.id === entry.id && 'bg-accent',
                )}
              >
                <span className="block break-words text-sm font-medium">{entry.title}</span>
                <span className="mt-1 block text-xs capitalize text-muted-foreground">
                  {run?.id === entry.id ? run.status : entry.status} ·{' '}
                  {run?.id === entry.id
                    ? run.items.filter((item) => item.state.status === 'completed').length
                    : (entry.items.completed ?? 0)}{' '}
                  completed
                </span>
              </button>
            ))}
          </nav>
          <div className="min-w-0 space-y-4">
            <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              Plans belong to {profile.name || 'this computer'}. Keep Studio open on the owner
              computer for paired remote execution. Work runs in normal threads; review their
              changes before recording your final decision.
            </p>
            {error && (
              <div
                role="alert"
                className="break-words rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
              >
                {error}
                {run && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void openRun(run.id)}
                    className="ml-2"
                  >
                    Reload saved plan
                  </Button>
                )}
              </div>
            )}
            {notice && (
              <p role="status" className="rounded-lg bg-muted p-3 text-sm">
                {notice}
              </p>
            )}
            {!run && !draft && (
              <EmptyState
                icon={<Workflow />}
                title="Review your plans"
                description="Open a saved proposal to review its instructions and assignments, then choose Start plan. You can ask Do to prepare a proposal in chat."
                action={<Button onClick={onChat}>Talk to Do</Button>}
              />
            )}
            {draft && (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!errors.length) void mutate('save', draft)
                }}
              >
                <fieldset disabled={busy || loading} className="space-y-4">
                  <label className="block text-sm font-medium">
                    Plan title
                    <Input
                      value={draft.title}
                      maxLength={DO_LIMITS.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Goal
                    <textarea
                      className={`${control} mt-1 min-h-28 resize-y`}
                      value={draft.goal}
                      maxLength={DO_LIMITS.goal}
                      onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    Maximum concurrent items
                    <Input
                      type="number"
                      className="mt-1 max-w-28"
                      min={1}
                      max={DO_LIMITS.maxConcurrency}
                      step={1}
                      value={draft.maxConcurrency ?? DO_LIMITS.defaultConcurrency}
                      onChange={(event) =>
                        setDraft({ ...draft, maxConcurrency: event.target.valueAsNumber })
                      }
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Use a new worktree for independent changes. Items sharing a project checkout can
                    write the same files; add dependencies when they must run in sequence.
                  </p>
                  {draft.items.map((item) => (
                    <ItemEditor
                      key={item.id}
                      item={item}
                      items={draft.items}
                      computers={computers}
                      profile={profile}
                      disabled={busy}
                      onChange={(next) =>
                        setDraft({
                          ...draft,
                          items: draft.items.map((entry) => (entry.id === item.id ? next : entry)),
                        })
                      }
                      onRemove={() =>
                        setDraft({
                          ...draft,
                          items: draft.items
                            .filter((entry) => entry.id !== item.id)
                            .map((entry) => ({
                              ...entry,
                              dependsOn: entry.dependsOn.filter((id) => id !== item.id),
                            })),
                        })
                      }
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={draft.items.length >= DO_LIMITS.items}
                    onClick={() =>
                      setDraft({ ...draft, items: [...draft.items, newItem(draft.items)] })
                    }
                  >
                    Add work item
                  </Button>
                </fieldset>
                {!!errors.length && (
                  <ul
                    aria-label="Plan validation"
                    className="list-disc space-y-1 pl-5 text-sm text-muted-foreground"
                  >
                    {errors.map((issue, index) => (
                      <li key={`${index}:${issue}`}>{issue}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={busy || loading || !!errors.length || !dirty}>
                    {busy ? 'Saving…' : 'Save plan'}
                  </Button>
                  {run?.status === 'draft' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || dirty}
                      onClick={() =>
                        void mutate('start', { id: run.id, expectedRevision: run.revision })
                      }
                    >
                      Start plan
                    </Button>
                  )}
                </div>
                {dirty && run && (
                  <p className="text-xs text-muted-foreground">
                    Save your changes before starting.
                  </p>
                )}
              </form>
            )}
            {run && !draft && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-xl font-semibold">{run.title}</h2>
                    <p role="status" className="mt-1 text-sm capitalize text-muted-foreground">
                      {run.status} · Up to {run.maxConcurrency} concurrent items
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {run.status === 'draft' && (
                      <>
                        <Button
                          disabled={busy || loading}
                          onClick={() =>
                            void mutate('start', { id: run.id, expectedRevision: run.revision })
                          }
                        >
                          Start plan
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || loading}
                          onClick={() => setDraft(editablePlan(run))}
                        >
                          Edit plan
                        </Button>
                      </>
                    )}
                    {run.items.some((item) => retryable.has(item.state.status)) &&
                      !['cancelling', 'completed'].includes(run.status) && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void mutate('retry', { id: run.id })}
                        >
                          Retry unfinished items
                        </Button>
                      )}
                    {['running', 'attention', 'cancelling'].includes(run.status) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Stop all threads owned by this plan? Completed work is kept.',
                            )
                          )
                            void mutate('cancel', { id: run.id })
                        }}
                      >
                        {run.status === 'cancelling' ? 'Retry cancellation' : 'Cancel run'}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{run.goal}</p>
                {run.error && (
                  <p role="alert" className="break-words text-sm text-destructive">
                    {run.error}
                  </p>
                )}
                {run.items.map((item) => (
                  <article
                    key={item.id}
                    className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="min-w-0 break-words font-medium">{item.title}</h3>
                      <span className="text-xs capitalize text-muted-foreground">
                        {item.state.status} · Attempt {item.state.attempt}
                      </span>
                    </div>
                    <p className="break-words text-xs text-muted-foreground">
                      {computers.find((computer) => computer.id === item.target.runtimeId)?.name ??
                        item.target.runtimeId}{' '}
                      · {item.target.repositoryId} ·{' '}
                      {item.target.agentId || 'Project default agent'} ·{' '}
                      {item.target.execution || 'Project default checkout'}
                    </p>
                    {!!item.target.linkedCheckouts?.length && (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p className="font-medium">Linked checkouts</p>
                        {item.target.linkedCheckouts.map((checkout) => (
                          <p key={checkout.id} className="break-words">
                            {checkout.repositoryId} · {checkout.access} · {checkout.execution}
                            {checkout.existingWorktreePath
                              ? ` · ${checkout.existingWorktreePath}`
                              : ''}
                            {checkout.baseBranch ? ` · Base: ${checkout.baseBranch}` : ''}
                            {checkout.branch ? ` · Branch: ${checkout.branch}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                    {!!item.dependsOn.length && (
                      <p className="break-words text-xs text-muted-foreground">
                        Depends on:{' '}
                        {item.dependsOn
                          .map((id) => run.items.find((entry) => entry.id === id)?.title || id)
                          .join(', ')}
                      </p>
                    )}
                    <details>
                      <summary className="cursor-pointer text-sm">Instructions</summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                        {item.instructions}
                      </p>
                    </details>
                    {item.state.attention && (
                      <p role="status" className="text-sm">
                        Needs human {item.state.attention}. Open the thread to respond.
                      </p>
                    )}
                    {(item.state.error || item.state.blockedReason) && (
                      <p role="alert" className="break-words text-sm text-destructive">
                        {[item.state.error, item.state.blockedReason].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {item.state.result && (
                      <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Agent-reported result · Unverified
                          {item.state.result.truncated ? ' · Excerpt' : ''}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {item.state.result.summary || 'No result text.'}
                        </p>
                        {item.state.result.branch && (
                          <p className="break-words text-xs">Branch: {item.state.result.branch}</p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {item.state.taskId && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void openThread(item)}
                        >
                          Open thread
                        </Button>
                      )}
                      {retryable.has(item.state.status) &&
                        !['cancelling', 'completed'].includes(run.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void mutate('retry', { id: run.id, itemIds: [item.id] })}
                          >
                            Retry item
                          </Button>
                        )}
                    </div>
                  </article>
                ))}
                {run.status === 'review' && (
                  <fieldset disabled={busy} className="space-y-3 rounded-xl border p-4">
                    <legend className="px-1 font-medium">Final human review</legend>
                    <p className="text-sm text-muted-foreground">
                      Inspect each thread and its changes. Record whether the goal was met. This
                      decision does not merge or publish anything.
                    </p>
                    <label className="block text-sm">
                      Review note (optional)
                      <textarea
                        className={`${control} mt-1 min-h-24`}
                        maxLength={DO_LIMITS.note}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          void mutate('complete', { id: run.id, decision: 'accepted', note })
                        }
                      >
                        Accept results
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void mutate('complete', { id: run.id, decision: 'rejected', note })
                        }
                      >
                        Reject results
                      </Button>
                    </div>
                  </fieldset>
                )}
                {run.review && (
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-medium capitalize">
                      Human review: {run.review.decision}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                      {run.review.note}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {new Date(run.review.reviewedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
