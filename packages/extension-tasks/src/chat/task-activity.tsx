import { useApplicationState } from '@dovo/studio-core/state'
import { Effect, Schema } from 'effect'
import { useEffect, useMemo } from 'react'
import {
  activitySchema,
  startPolling,
  clientScopeKey,
  recentTools,
  retainActivityEvents,
  activitySummary,
  toolPresentation,
  useWorkspace,
  type TaskTurn,
} from '@dovo/studio-core'
import { MessageResponse } from '@dovo/studio-ui'
import {
  BrainCircuit,
  ChevronRight,
  FileCode2,
  Globe,
  Monitor,
  Terminal,
  Wrench,
} from 'lucide-react'
import { TurnLabel } from './turn-label'
import {
  activityCommandLabel,
  taskActivityState,
  taskActivityOutcome,
  type ActivityState,
} from './task-activity-state'
export function useTaskActivity(taskId: string) {
  const { requestEffect: request, connected, connection, activeRuntimeId } = useWorkspace()
  const identity = JSON.stringify([activeRuntimeId, clientScopeKey(connection), taskId])
  const [snapshot, setSnapshot] = useApplicationState<{
    identity: string
    events: Schema.Schema.Type<typeof activitySchema>['events']
    error: string
  }>(() => ({
    identity,
    events: [],
    error: '',
  }))
  useEffect(() => {
    let stopped = false
    setSnapshot((previous) =>
      previous.identity === identity ? previous : { identity, events: [], error: '' },
    )
    const load = Effect.gen(function* () {
      if (!connected || document.visibilityState !== 'visible') return
      const result = yield* request(
        '/api/activity',
        { scope: taskId, kind: 'task-activity' },
        activitySchema,
      )
      if (!stopped)
        setSnapshot((previous) => {
          const events =
            previous.identity === identity
              ? retainActivityEvents(previous.events, result.events)
              : result.events
          return previous.identity === identity && !previous.error && events === previous.events
            ? previous
            : { identity, events, error: '' }
        })
    })
    const polling = startPolling(load, {
      interval: 2000,
      onError: (error) => {
        if (!stopped)
          setSnapshot((previous) =>
            previous.identity === identity ? { ...previous, error: error.message } : previous,
          )
      },
    })
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
    }
  }, [request, connected, taskId, identity])

  return {
    tools: useMemo(
      () => recentTools(snapshot.identity === identity ? snapshot.events : []),
      [snapshot.identity, snapshot.events, identity],
    ),
    error: snapshot.identity === identity ? snapshot.error : '',
  }
}
type ActivityTool = ReturnType<typeof recentTools>[number]
type Presentation = ReturnType<typeof toolPresentation>
const icons = {
  command: Terminal,
  computer: Monitor,
  web: Globe,
  file: FileCode2,
  tool: Wrench,
  reasoning: BrainCircuit,
}
function activeTitle(presentation: Presentation) {
  if (presentation.kind === 'command')
    return `Running ${activityCommandLabel(presentation.input || presentation.title)}`
  if (presentation.kind === 'reasoning') return 'Reasoning…'
  if (presentation.kind === 'web') return 'Searching the web'
  if (presentation.kind === 'computer')
    return presentation.title === 'Computer Use' ? 'Using Computer Use' : presentation.title
  return presentation.title
}
export function TaskActivity({
  tools,
  error = '',
  turn,
  status,
}: {
  tools: ReturnType<typeof recentTools>
  error?: string
  turn?: TaskTurn
  status?: TaskTurn['status']
}) {
  const [expanded, setExpanded] = useApplicationState(false)
  const entries = useMemo(
    () =>
      tools
        .map((tool) => ({
          tool,
          presentation: toolPresentation(tool.payload, tool.summary, tool.inputPayload),
          state: taskActivityState(tool.status, turn?.status ?? status),
        }))
        .sort((a, b) => a.tool.time.localeCompare(b.tool.time)),
    [tools, turn?.status, status],
  )
  const running = entries.filter((entry) => entry.state === 'running')
  const current =
    running.filter((entry) => entry.presentation.kind !== 'reasoning').at(-1) ?? running.at(-1)
  if (!tools.length && !error && !turn) return null
  const outcome = taskActivityOutcome(
    entries.filter((entry) => entry.presentation.kind !== 'reasoning').map((entry) => entry.state),
  )
  const headline =
    !expanded && current
      ? [activeTitle(current.presentation), outcome].filter(Boolean).join(' · ')
      : [activitySummary(tools), outcome].filter(Boolean).join(' · ')
  const summaryKind = (['computer', 'command', 'file', 'web', 'tool', 'reasoning'] as const).find(
    (kind) => entries.some((entry) => entry.presentation.kind === kind),
  )
  const Icon =
    !expanded && current ? icons[current.presentation.kind] : icons[summaryKind ?? 'tool']
  return (
    <section className="min-w-0 text-xs" aria-label="Task tool activity">
      {tools.length ? (
        <details
          className="group/activity min-w-0"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
            <Icon
              aria-hidden
              className={`size-3.5 shrink-0 ${current ? 'animate-pulse motion-reduce:animate-none' : ''}`}
            />
            <span className="min-w-0 flex-1 truncate" title={headline}>
              {headline}
            </span>
            {turn && (
              <span className="hidden shrink-0 sm:inline">
                <TurnLabel turn={turn} />
              </span>
            )}
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 transition-transform group-open/activity:rotate-90 motion-reduce:transition-none"
            />
          </summary>
          {expanded && (
            <div className="space-y-0.5 pb-2 pl-1">
              {entries.map(({ tool, presentation, state }) => (
                <ActivityEntry
                  key={tool.id}
                  tool={tool}
                  presentation={presentation}
                  state={state}
                />
              ))}
              {turn && (
                <details className="pt-1 text-[11px] text-muted-foreground/70">
                  <summary className="w-fit cursor-pointer py-1 hover:text-muted-foreground">
                    Run details
                  </summary>
                  <p className="py-1">
                    {[
                      turn.provider,
                      turn.model || 'Default model',
                      turn.branch,
                      turn.reasoning,
                      turn.status,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <TurnLabel turn={turn} />
                </details>
              )}
            </div>
          )}
        </details>
      ) : (
        turn && (
          <div className="py-1.5">
            <TurnLabel turn={turn} />
          </div>
        )
      )}
      {error && (
        <p role="alert" className="py-2 text-destructive">
          Activity could not be loaded. {error}
        </p>
      )}
    </section>
  )
}
function ActivityEntry({
  tool,
  presentation,
  state,
}: {
  tool: ActivityTool
  presentation: Presentation
  state: ActivityState
}) {
  const Icon = icons[presentation.kind]
  const title = state === 'running' ? activeTitle(presentation) : presentation.title
  const status =
    state === 'failed'
      ? 'Failed'
      : state === 'stopped'
        ? 'Stopped'
        : state === 'interrupted'
          ? 'Interrupted'
          : ''
  const reasoning = presentation.kind === 'reasoning'
  return (
    <details className="group/action min-w-0">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded px-1 py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
        <Icon
          aria-hidden
          className={`size-3.5 shrink-0 ${state === 'running' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        />
        <span className="min-w-0 flex-1 truncate" title={title}>
          {title}
        </span>
        {status && (
          <span className={`shrink-0 text-[10px] ${state === 'failed' ? 'text-destructive' : ''}`}>
            {status}
          </span>
        )}
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform group-open/action:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <div className="mb-2 ml-2.5 space-y-3 border-l pl-4 text-[11px] leading-relaxed text-muted-foreground">
        {!!presentation.input && (
          <div>
            <p className="mb-1 text-[10px] text-muted-foreground/65">
              {presentation.kind === 'command' ? 'Command' : 'Input'}
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {presentation.input}
            </pre>
          </div>
        )}
        {!!presentation.output &&
          (reasoning ? (
            <div className="text-xs">
              <MessageResponse isStreaming={state === 'running'}>
                {presentation.output}
              </MessageResponse>
            </div>
          ) : (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground/65">Output</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                {presentation.output}
              </pre>
            </div>
          ))}
        {!presentation.input && !presentation.output && (
          <p>{state === 'running' ? 'Waiting for output…' : 'No text output recorded.'}</p>
        )}
        <details className="text-[10px] text-muted-foreground/60">
          <summary className="w-fit cursor-pointer py-1 hover:text-muted-foreground">
            Raw event · <time dateTime={tool.time}>{new Date(tool.time).toLocaleTimeString()}</time>
          </summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">
            {tool.payload.slice(0, 24000)}
          </pre>
          {tool.payload.length > 24000 && <p>Raw preview limited to 24,000 characters.</p>}
        </details>
      </div>
    </details>
  )
}
