import { useEffect, useRef, useState } from 'react'
import {
  RuntimeRequestError,
  automationActionSendSchema,
  decode,
  threadActionResultSchema,
  type AutomationActionSend,
  type Task,
  type ThreadAction,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { botScope } from '../../bots/bot-scope'
import { taskActionClient } from '../../list/task-row-actions'
import { AutomationActionReview } from './automation-action-review'

/** `attempt` is the exact body of a start whose outcome is unknown. Retry resends it. */
type Draft = { text: string; attempt?: AutomationActionSend; stale?: boolean }
const drafts = new Map<string, Draft>()

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Starts one existing automation after a person reviews its exact saved revision. */
export function AutomationActionCard({ task, action }: { task: Task; action: ThreadAction }) {
  const store = useWorkspace()
  const host = useStudioHost()
  const runtimeId = store.activeRuntimeId
  const scope = JSON.stringify([
    botScope(store.snapshot?.runtimeId ?? runtimeId, store.connection),
    task.id,
    action.id,
  ])
  const [results, setResults] = useState<Readonly<Record<string, ThreadAction>>>({})
  // Busy, error and review state belong to one scope. A request for another runtime, thread
  // or action never locks or reports into this one, and always releases its own scope.
  const [reviewingScope, setReviewingScope] = useState<string>()
  const [pending, setPending] = useState<readonly string[]>([])
  const [failure, setFailure] = useState<{ scope: string; message: string }>()
  const [draft, setDraft] = useState<{ scope: string; value: Draft }>()
  const inFlight = useRef(new Set<string>())
  const reviewing = reviewingScope === scope
  const busy = pending.includes(scope)
  const error = failure?.scope === scope ? failure.message : ''
  const setError = (key: string, text: string) =>
    setFailure(text ? { scope: key, message: text } : undefined)
  // Late replies must not touch a card that now shows another runtime, thread or action.
  const live = useRef<string | undefined>(scope)
  live.current = scope
  useEffect(
    () => () => {
      live.current = undefined
    },
    [],
  )
  // A receipt or refreshed review applies only to the scope that requested it.
  const received = results[scope]
  const current = received && received.updatedAt >= action.updatedAt ? received : action
  const snapshot = current.automation ?? action.automation
  const value = (draft?.scope === scope ? draft.value : undefined) ??
    drafts.get(scope) ?? { text: action.prompt }
  if (!snapshot || current.state === 'dismissed' || store.snapshot?.threadActionsSupported !== true)
    return null
  const write = (key: string, next: Draft | undefined) => {
    if (next) drafts.set(key, next)
    else drafts.delete(key)
    if (live.current === key) setDraft({ scope: key, value: next ?? { text: action.prompt } })
  }
  const client = taskActionClient(store, {
    runtimeId,
    online: store.connected,
    name: 'Source computer',
  })
  const refresh = async (key: string) => {
    try {
      await client.refresh()
    } catch (cause) {
      if (live.current === key)
        setError(key, `Saved. Waiting for the source computer to refresh: ${message(cause)}`)
    }
  }
  const run = async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    setPending((keys) => [...keys, key])
    setError(key, '')
    try {
      await work()
    } catch (cause) {
      if (live.current === key) setError(key, message(cause))
    } finally {
      inFlight.current.delete(key)
      // Setting state after unmount is a no-op, so this always releases the scope.
      setPending((keys) => keys.filter((item) => item !== key))
    }
  }
  const start = () =>
    run(scope, async () => {
      const key = scope
      const latest = drafts.get(key) ?? value
      const attempt =
        latest.attempt ??
        decode(automationActionSendSchema, {
          sourceTaskId: task.id,
          actionId: action.id,
          revision: snapshot.revision,
          text: latest.text.trim(),
        })
      write(key, { text: latest.text, attempt })
      let response
      try {
        response = await client.request(
          '/api/thread-actions/send',
          attempt,
          threadActionResultSchema,
        )
      } catch (cause) {
        // Only a definite no-start unlocks the payload. Keep the person's context.
        if (
          cause instanceof RuntimeRequestError &&
          cause.mutationRejected &&
          drafts.get(key)?.attempt === attempt
        )
          write(key, { text: latest.text, stale: true })
        throw cause
      }
      // A newer draft for this action stays when an older start completes late.
      if (drafts.get(key)?.attempt === attempt) write(key, undefined)
      // Scoped: the receipt shows only when this runtime, thread and action are shown again.
      setResults((items) => ({ ...items, [key]: response.action }))
      if (live.current !== key) return
      setReviewingScope(undefined)
      await refresh(key)
    })
  const review = () =>
    run(scope, async () => {
      const key = scope
      const response = await client.request(
        '/api/thread-actions/review',
        { sourceTaskId: task.id, actionId: action.id },
        threadActionResultSchema,
      )
      const latest = drafts.get(key)
      if (latest && !latest.attempt) write(key, { text: latest.text })
      setResults((items) => ({ ...items, [key]: response.action }))
    })
  const dismiss = () =>
    run(scope, async () => {
      const key = scope
      const response = await client.request(
        '/api/thread-actions/dismiss',
        { sourceTaskId: task.id, actionId: action.id },
        threadActionResultSchema,
      )
      setResults((items) => ({ ...items, [key]: response.action }))
      if (live.current === key) await refresh(key)
    })
  const sent = current.automationSent
  const frozen = !!value.attempt
  return (
    <section
      aria-label={`Automation action: ${current.title}`}
      data-thread-action={action.id}
      // Paired human consent: Studio UI tools cannot click or type in this card.
      data-studio-human-only="true"
      className="my-3 grid min-w-0 gap-3 rounded-xl border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{current.title}</h3>
        <span className="text-xs text-muted-foreground">
          {sent ? 'Started' : `Automation · ${snapshot.workflow.name}`}
        </span>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
        {current.prompt}
      </p>
      {sent ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            host.navigate({
              viewId: 'jobs',
              entityId: sent.runId,
              ...(runtimeId
                ? {
                    automationTarget: {
                      runtimeId,
                      automationId: snapshot.automationId,
                      runId: sent.runId,
                    },
                  }
                : {}),
            })
          }
        >
          Open automation run
        </Button>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Review the saved workflow, agents, projects and access before Start.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!store.connected || busy}
              onClick={() => {
                setError(scope, '')
                setReviewingScope(scope)
              }}
            >
              Review and Start
            </Button>
            <Button size="sm" variant="ghost" disabled={!store.connected || busy} onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </>
      )}
      {error && !reviewing && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {reviewing && current.state === 'prepared' && !sent && (
        <AutomationActionReview
          snapshot={snapshot}
          text={value.text}
          frozen={frozen}
          busy={busy}
          stale={!!value.stale}
          error={error}
          blocked={
            !store.connected
              ? 'Reconnect the source computer before Start.'
              : snapshot.workflow.enabled === false && !frozen
                ? 'This automation is paused. Resume it in Automations, then refresh the review.'
                : undefined
          }
          onText={(text) => {
            const latest = drafts.get(scope) ?? value
            if (!latest.attempt) write(scope, { ...latest, text })
          }}
          onStart={() => void start()}
          onRefresh={() => void review()}
          onClose={() => setReviewingScope(undefined)}
        />
      )}
    </section>
  )
}
