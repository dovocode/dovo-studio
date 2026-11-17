import { useEffect, useRef, useState } from 'react'
import {
  routineChangeForRun,
  routineAutomaticPause,
  routineFieldChangeText,
  routineProvenanceSchema,
  routineSourceText,
  type RoutineChange,
} from '@dovo/protocol'
import { formatDateTime, useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export type RoutineProvenanceState = {
  supported: boolean
  changes?: RoutineChange[]
  error: string
}

/** Loads a routine's recorded changes. Reloads after the computer saves a change, not on
 * every local draft edit. */
export function useRoutineProvenance(id: string | undefined): RoutineProvenanceState {
  const { request, connection, connected, snapshot } = useWorkspace()
  const supported = snapshot?.routineProvenanceSupported === true
  const [changes, setChanges] = useState<RoutineChange[]>()
  const [error, setError] = useState('')
  const generation = useRef(0)
  const saved = snapshot?.workspace.automations.find((item) => item.id === id)
  const revision = saved ? JSON.stringify(saved) : ''
  useEffect(() => {
    const version = ++generation.current
    setChanges(undefined)
    setError('')
    if (!id || !supported || !connected) return
    request('/api/jobs/provenance', { id }, routineProvenanceSchema)
      .then((result) => {
        if (version === generation.current) setChanges(result.changes)
      })
      .catch((cause: unknown) => {
        if (version === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [id, revision, supported, connected, connection])
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  return { supported, changes, error }
}

/** The owner's words with a link back to their message when it still exists. */
function RoutineSource({ change }: { change: RoutineChange | undefined }) {
  const host = useStudioHost()
  const { workspace, activeRuntimeId } = useWorkspace()
  if (!change) return <p className="text-xs text-muted-foreground">Source not recorded</p>
  const source = change.source
  return (
    <div className="grid justify-items-start gap-1 text-xs">
      <p className="whitespace-pre-wrap break-words">{routineSourceText(source)}</p>
      {source.kind === 'agent' &&
        source.runId &&
        (source.runAvailable ? (
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() =>
              host.navigate({
                viewId: 'jobs',
                entityId: source.runId,
                ...(activeRuntimeId
                  ? {
                      automationTarget: {
                        runtimeId: activeRuntimeId,
                        automationId: change.automationId,
                        runId: source.runId,
                      },
                    }
                  : {}),
              })
            }
          >
            Open responsible run
          </Button>
        ) : (
          <span className="text-muted-foreground">Responsible run unavailable</span>
        ))}
      {source.kind === 'owner' &&
        (source.linkAvailable ? (
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() =>
              host.navigate({
                viewId: workspace.tasks.find((task) => task.id === source.taskId)?.bot
                  ? 'bots'
                  : 'tasks',
                entityId: source.taskId,
                messageId: source.messageId,
              })
            }
          >
            Open source message
          </Button>
        ) : (
          <span className="text-muted-foreground">Source message unavailable</span>
        ))}
    </div>
  )
}

/** The change in effect when a run started. */
export function RunRoutineSource({
  state,
  runCreatedAt,
}: {
  state: RoutineProvenanceState
  runCreatedAt: string
}) {
  if (!state.supported) return null
  return (
    <section className="grid gap-1 border-b p-4" aria-label="Run source">
      <h3 className="text-xs font-medium">Why this run happened</h3>
      {state.error ? (
        <p role="alert" className="text-xs">
          {state.error}
        </p>
      ) : state.changes ? (
        <RoutineSource change={routineChangeForRun(state.changes, runCreatedAt)} />
      ) : (
        <p className="text-xs text-muted-foreground">Loading source…</p>
      )}
    </section>
  )
}

/** Every recorded change, newest first, with who asked for it. */
export function RoutineHistory({ state }: { state: RoutineProvenanceState }) {
  if (!state.supported) return null
  return (
    <section className="mt-6 grid gap-2" aria-label="Change history">
      <h2 className="text-sm font-medium">Change history</h2>
      {state.error && (
        <p role="alert" className="text-xs">
          {state.error}
        </p>
      )}
      {!state.changes && !state.error && (
        <p className="text-xs text-muted-foreground">Loading change history…</p>
      )}
      {state.changes?.length === 0 && <RoutineSource change={undefined} />}
      {!!state.changes?.length && (
        <ol className="divide-y rounded-lg border">
          {state.changes.map((change) => (
            <li key={change.id} className="grid gap-1.5 p-3">
              <p className="text-[0.6875rem] text-muted-foreground">
                {change.action === 'created' ? 'Created' : 'Changed'} {formatDateTime(change.at)}
              </p>
              <RoutineSource change={change} />
              {!!change.changes.length && (
                <ul className="grid gap-0.5 text-xs text-muted-foreground">
                  {change.changes.map((field, index) => (
                    <li key={index} className="break-words">
                      {routineFieldChangeText(field)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function AutomaticPauseSource({
  state,
  enabled,
}: {
  state: RoutineProvenanceState
  enabled: boolean | undefined
}) {
  const { snapshot } = useWorkspace()
  const change = routineAutomaticPause({ enabled }, state.changes ?? [])
  if (!snapshot?.routineRunProvenanceSupported || !change) return null
  return (
    <section className="grid gap-1 border-b px-4 py-3" aria-label="Automatic pause">
      <p className="text-xs font-medium">Paused by an automation run</p>
      <RoutineSource change={change} />
    </section>
  )
}
