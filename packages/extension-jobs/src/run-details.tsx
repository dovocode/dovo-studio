import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useState } from 'react'
import {
  automationReviewLink,
  automationRunNeedsReview,
  explainAutomationDraftSchema,
  randomUUID,
} from '@dovo/protocol'
import { RestoreDefinition } from './restore-definition'
import { RunAudit } from './run-audit'
import { RunRoutineSource, type RoutineProvenanceState } from './routine-provenance'
import {
  ArrowUpRight,
  Check,
  Circle,
  Clock3,
  LoaderCircle,
  OctagonX,
  RotateCw,
  X,
} from 'lucide-react'
import {
  clientScopeKey,
  useStudioHost,
  useWorkspace,
  type Automation,
  type JobRun,
  formatDateTime,
} from '@dovo/studio-core'
import { Button, ChoicePicker, Textarea, cn } from '@dovo/studio-ui'
import {
  elapsed,
  liveRun,
  pendingTaskInput,
  runLabel,
  runSteps,
  stepLabels,
  type RunStep,
} from './run-progress'
import type { JobActions } from './use-job-actions'
const stepIcons = {
  pending: Circle,
  running: LoaderCircle,
  waiting: Clock3,
  completed: Check,
  failed: OctagonX,
  cancelled: X,
}
export function StepStatus({
  step,
  needsInput = false,
}: {
  step: Pick<RunStep, 'status'> &
    Partial<Pick<RunStep, 'kind' | 'queuedAt' | 'workStartedAt' | 'waitsForCi'>>
  needsInput?: boolean
}) {
  const Icon = needsInput ? Clock3 : stepIcons[step.status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[0.6875rem]',
        step.status === 'failed'
          ? 'text-destructive'
          : step.status === 'waiting' || needsInput
            ? 'text-status-warning'
            : step.status === 'running'
              ? 'text-primary'
              : 'text-muted-foreground',
      )}
    >
      <Icon
        className={cn('size-3.5', step.status === 'running' && !needsInput && 'animate-spin')}
        aria-hidden="true"
      />
      {needsInput
        ? 'Needs input'
        : step.status === 'running' && step.queuedAt && !step.workStartedAt
          ? 'Waiting for worker'
          : step.status === 'waiting' && step.kind === 'task'
            ? 'Waiting for provider'
            : step.status === 'waiting' && step.waitsForCi
              ? 'Waiting for CI'
              : stepLabels[step.status]}
    </span>
  )
}
export function RunDetails({
  flow,
  runs,
  run,
  provenance,
  selectRun,
  actions,
  onStep,
}: {
  flow: Automation
  runs: JobRun[]
  run: JobRun | undefined
  provenance: RoutineProvenanceState
  selectRun: (id: string) => void
  actions: JobActions
  onStep: (id: string) => void
}) {
  const { workspace, connected, connection, syncError, snapshot, activeRuntimeId, request } =
    useWorkspace()
  const host = useStudioHost()
  const [now, setNow] = useApplicationState(Date.now)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState('')
  const [reviewInput, setReviewInput] = useState<{ key: string; text: string }>()
  const attemptRequests = useRef(new Map<string, string>())
  const pairing = clientScopeKey(connection)
  const explainScope = useRef(0)
  useEffect(() => {
    setExplainError('')
    setExplaining(false)
    return () => {
      explainScope.current++
    }
  }, [pairing, run?.id])
  const active = !!run && liveRun(run)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, run?.id])
  if (!run)
    return (
      <div className="p-5 text-sm">
        <h2 className="font-medium">Ready when you are</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Run this automation to follow each step here. Thread results and review decisions stay
          attached to the run.
        </p>
      </div>
    )
  const steps = runSteps(run, flow)
  const subject = run.subject
  const inputStep = steps.find(
    (step) => step.status === 'running' && pendingTaskInput(snapshot, step.taskId),
  )
  const inputTaskId = inputStep?.taskId
  const completed = steps.filter((step) => step.status === 'completed').length
  const disabled = !connected || actions.busy || !!syncError
  const canRetry = run.status === 'failed' || run.status === 'cancelled'
  const anotherActive = runs.some((item) => item.id !== run.id && liveRun(item))
  const waiting = steps.find(
    (step) => step.nodeId === run.waitingNodeId || step.status === 'waiting',
  )
  const reviewKey = JSON.stringify([pairing, run.id, waiting?.nodeId, waiting?.attempt])
  const reason = reviewInput?.key === reviewKey ? reviewInput.text : ''
  const prompt = waiting?.reviewPrompt
  const link = automationReviewLink(prompt?.link)
  const reviewDisabled = disabled || (!!prompt?.requireReason && !reason.trim())
  const tasks = run.taskIds.flatMap((id) => {
    const task = workspace.tasks.find((item) => item.id === id)
    return task ? [task] : []
  })
  const duration = elapsed(
    run.createdAt,
    run.finishedAt ?? (!active ? run.updatedAt : undefined),
    now,
  )
  const openTask = (id: string) =>
    host.navigate({
      viewId: workspace.tasks.find((task) => task.id === id)?.bot ? 'bots' : 'tasks',
      entityId: id,
    })
  const explain = async (attempt: number) => {
    const key = JSON.stringify([pairing, run.id, attempt])
    const taskId = attemptRequests.current.get(key) ?? randomUUID()
    attemptRequests.current.set(key, taskId)
    const current = host.taskNavigationGuard?.()
    const scope = explainScope.current
    setExplainError('')
    setExplaining(true)
    try {
      const result = await request(
        '/api/jobs/explain',
        { id: run.id, attempt, taskId },
        explainAutomationDraftSchema,
      )
      if (scope === explainScope.current && (!current || current())) openTask(result.taskId)
    } catch (cause) {
      if (scope === explainScope.current)
        setExplainError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (scope === explainScope.current) setExplaining(false)
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <RestoreDefinition key={`${activeRuntimeId}:${run.id}`} runId={run.id} />
      <RunRoutineSource state={provenance} runCreatedAt={run.createdAt} />
      {snapshot?.runAuditSupported && (
        <RunAudit key={`${activeRuntimeId}:${run.id}`} runId={run.id} />
      )}
      <div className="space-y-3 border-b p-4">
        {subject?.kind === 'url' && (
          <a
            className="block truncate text-xs text-primary underline"
            href={subject.url}
            target="_blank"
            rel="noreferrer"
          >
            {subject.url}
          </a>
        )}
        {subject?.kind === 'thread' && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() =>
              host.openThread?.({
                runtimeId: activeRuntimeId,
                threadId: subject.threadId,
                title:
                  workspace.tasks.find(({ id }) => id === subject.threadId)?.title ??
                  'Subject thread',
              })
            }
            disabled={!host.openThread}
          >
            Open subject thread
          </Button>
        )}
        {run.mcpEvent && (
          <p className="text-xs text-muted-foreground">
            MCP event · {run.mcpEvent.name} · {run.mcpEvent.server}
          </p>
        )}
        {run.scheduledFor && (
          <p className="text-xs text-muted-foreground">
            Due {formatDateTime(run.scheduledFor)} · Enqueued {formatDateTime(run.createdAt)}
            {' · '}
            {run.scheduleTimezone ?? 'UTC'}
            {' · '}
            {Math.max(
              0,
              Math.floor((Date.parse(run.createdAt) - Date.parse(run.scheduledFor)) / 1000),
            )}
            s late
          </p>
        )}
        <ChoicePicker
          aria-label="Automation run"
          value={run.id}
          onValueChange={selectRun}
          className="h-8 w-full rounded border bg-background px-2 text-xs"
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              {formatDateTime(item.createdAt)} · {runLabel(item)}
            </option>
          ))}
        </ChoicePicker>
        <div className="flex items-center justify-between gap-2 text-xs">
          <strong
            className={cn(
              'font-medium',
              run.status === 'failed' && 'text-destructive',
              run.status === 'waiting' && 'text-status-warning',
            )}
          >
            {inputStep ? 'Needs input' : runLabel(run)}
          </strong>
          <span className="text-muted-foreground">
            {completed}/{steps.length} steps
            {duration && (active || run.finishedAt || run.updatedAt) ? ` · ${duration}` : ''}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Automation progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-all"
            style={{
              width: `${steps.length ? (completed / steps.length) * 100 : 0}%`,
            }}
          />
        </div>
        {(run.attempt ?? 1) > 1 && (
          <p className="text-xs text-muted-foreground">
            Attempt {run.attempt} · completed steps retained
          </p>
        )}
        {run.interrupted && (
          <p className="text-xs text-muted-foreground">
            The computer stopped before this run finished. Retry to continue from the interrupted
            step.
          </p>
        )}
        {run.error && (
          <p role="alert" className="break-words text-xs leading-relaxed text-destructive">
            {run.error}
          </p>
        )}
        {!run.steps && (
          <p className="text-xs text-muted-foreground">
            This older run has limited step history. Its threads are listed below.
          </p>
        )}
        {inputTaskId && (
          <div className="rounded-lg border border-status-warning/25 bg-status-warning/5 p-3">
            <p className="text-xs font-medium">{inputStep.label} needs your input</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {pendingTaskInput(snapshot, inputTaskId)}
            </p>
            <Button size="sm" className="mt-3" onClick={() => openTask(inputTaskId)}>
              {workspace.tasks.find((task) => task.id === inputTaskId)?.bot
                ? 'Open Bot'
                : 'Open thread'}
            </Button>
          </div>
        )}
        {run.retryAt && run.pause?.phase !== 'paused' && (
          <p className="text-xs">
            Provider startup retry {run.startupRetryCount}/3 at {formatDateTime(run.retryAt)}. No
            input was accepted. Cancel stops this retry.
          </p>
        )}
        {run.pipelineWait && run.pause?.phase !== 'paused' && (
          <p className="text-xs">
            Waiting until {formatDateTime(run.pipelineWait.until)} for the{' '}
            <a className="underline" href={run.pipelineWait.url} target="_blank" rel="noreferrer">
              selected GitHub Actions attempt
            </a>
            .
          </p>
        )}
        {automationRunNeedsReview(run) && (
          <div className="rounded-lg border border-status-warning/25 bg-status-warning/5 p-3">
            <p className="text-xs font-medium">{waiting?.label ?? 'Review needed'}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {prompt?.instructions?.trim() ||
                'Open the completed threads below and review their changes before continuing.'}
            </p>
            {link && (
              <a className="text-xs underline" href={link} target="_blank" rel="noreferrer">
                Open review link
              </a>
            )}
            {prompt && (
              <Textarea
                aria-label={prompt.requireReason ? 'Reason (required)' : 'Reason (optional)'}
                placeholder={prompt.requireReason ? 'Reason (required)' : 'Reason (optional)'}
                maxLength={4000}
                value={reason}
                disabled={disabled}
                onChange={(event) => setReviewInput({ key: reviewKey, text: event.target.value })}
              />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={reviewDisabled}
                data-studio-human-only
                onClick={() => void actions.review(run, true, reason.trim() || undefined)}
              >
                Approve & continue
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={reviewDisabled}
                data-studio-human-only
                onClick={() => void actions.review(run, false, reason.trim() || undefined)}
              >
                Reject
              </Button>
            </div>
          </div>
        )}
        {run.reviewDecisions?.some(({ answeredAt }) => !!answeredAt) && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {run.reviewDecisions.map(
              (decision) =>
                decision.answeredAt && (
                  <li key={`${decision.nodeId}:${decision.attempt}`}>
                    {steps.find(({ nodeId }) => nodeId === decision.nodeId)?.label} ·{' '}
                    {decision.allow ? 'Approved' : 'Rejected'} · {decision.answeredBy ?? 'Reviewer'}{' '}
                    · {formatDateTime(decision.answeredAt)}
                    {decision.reason && <p className="whitespace-pre-wrap">{decision.reason}</p>}
                  </li>
                ),
            )}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <Button
              size="sm"
              disabled={disabled || anotherActive}
              onClick={() => void actions.retry(run.id, selectRun)}
            >
              <RotateCw />
              {run.status === 'cancelled' ? 'Retry cancelled run' : 'Retry failed step'}
            </Button>
          )}
          {active && snapshot?.automationPauseSupported && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void actions.control(run.id, run.pause ? 'resume' : 'pause')}
            >
              {run.pause?.phase === 'afterStep'
                ? 'Keep running'
                : run.pause
                  ? 'Resume run'
                  : 'Pause run'}
            </Button>
          )}
          {active && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void actions.control(run.id, 'cancel')}
            >
              Cancel run
            </Button>
          )}
        </div>
        {canRetry && (
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
            {anotherActive
              ? 'Wait for the current run to finish before retrying.'
              : 'Continues this run. Completed threads will not run again.'}
          </p>
        )}
        {!!run.failures?.length && snapshot?.automationExplainSupported && (
          <div className="space-y-2">
            <p className="text-xs font-medium">Failed attempts</p>
            {run.failures.map(({ attempt, failedAt }) => (
              <Button
                key={attempt}
                size="sm"
                variant="outline"
                disabled={disabled || explaining}
                onClick={() => void explain(attempt)}
              >
                Explain attempt {attempt} · {formatDateTime(failedAt)}
              </Button>
            ))}
            {explainError && (
              <p role="alert" className="text-xs text-destructive">
                {explainError}
              </p>
            )}
          </div>
        )}
      </div>
      <ol aria-label="Run steps" className="space-y-1 p-3">
        {steps.map((step, index) => {
          const task = workspace.tasks.find((task) => task.id === step.taskId)
          const duration =
            step.finishedAt || step.status === 'running' || step.status === 'waiting'
              ? elapsed(step.queuedAt ? step.workStartedAt : step.startedAt, step.finishedAt, now)
              : null
          const present = flow.nodes.some((node) => node.id === step.nodeId)
          return (
            <li
              key={step.nodeId}
              className={cn(
                'rounded-lg border border-transparent px-2 py-3',
                (step.status === 'running' ||
                  step.status === 'waiting' ||
                  step.status === 'failed') &&
                  'border-border bg-accent/35',
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-4 shrink-0 text-[0.6875rem] text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    className="text-left text-xs font-medium enabled:hover:underline disabled:cursor-default"
                    disabled={!present}
                    onClick={() => onStep(step.nodeId)}
                  >
                    {step.label}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {task?.bot && (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        Bot job · {task.title}
                      </span>
                    )}
                    <StepStatus
                      step={step}
                      needsInput={
                        step.status === 'running' && !!pendingTaskInput(snapshot, step.taskId)
                      }
                    />
                    {step.queuedAt && (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        Queue {elapsed(step.queuedAt, step.workStartedAt ?? step.finishedAt, now)}
                      </span>
                    )}
                    {duration && (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        Work {duration}
                      </span>
                    )}
                    {step.attempt > 1 && (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        Attempt {step.attempt}
                      </span>
                    )}
                  </div>
                  {task && (
                    <button
                      className="mt-2 flex max-w-full items-center gap-1 text-left text-xs text-primary hover:underline"
                      onClick={() => openTask(task.id)}
                    >
                      <ArrowUpRight className="size-3.5 shrink-0" />
                      <span className="truncate">{task.title}</span>
                    </button>
                  )}
                  {step.error && step.error !== run.error && (
                    <p className="mt-2 break-words text-xs text-destructive">{step.error}</p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      {tasks.length > 0 && (
        <div className="space-y-2 border-t p-4">
          <h3 className="text-xs font-medium">Threads in this run</h3>
          {tasks.map((task) => (
            <button
              key={task.id}
              className="flex w-full min-w-0 items-center justify-between gap-2 text-left text-xs hover:text-primary"
              onClick={() => openTask(task.id)}
            >
              <span className="min-w-0 truncate">
                {task.bot ? 'Bot job · ' : ''}
                {task.title}
              </span>
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{task.status}</span>
              <ArrowUpRight className="size-3.5 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
