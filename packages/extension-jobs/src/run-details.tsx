import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
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
import { useStudioHost, useWorkspace, type Automation, type JobRun } from '@dovo/studio-core'
import { Button, ChoicePicker, cn } from '@dovo/studio-ui'
import {
  elapsed,
  liveRun,
  pendingTaskInput,
  runLabels,
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
  step: Pick<RunStep, 'status'>
  needsInput?: boolean
}) {
  const Icon = needsInput ? Clock3 : stepIcons[step.status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px]',
        step.status === 'failed'
          ? 'text-destructive'
          : step.status === 'waiting' || needsInput
            ? 'text-amber-500'
            : step.status === 'running'
              ? 'text-primary'
              : 'text-muted-foreground',
      )}
    >
      <Icon
        className={cn('size-3.5', step.status === 'running' && !needsInput && 'animate-spin')}
        aria-hidden="true"
      />
      {needsInput ? 'Needs input' : stepLabels[step.status]}
    </span>
  )
}
export function RunDetails({
  flow,
  runs,
  run,
  selectRun,
  actions,
  onStep,
}: {
  flow: Automation
  runs: JobRun[]
  run: JobRun | undefined
  selectRun: (id: string) => void
  actions: JobActions
  onStep: (id: string) => void
}) {
  const { workspace, connected, syncError, snapshot } = useWorkspace()
  const host = useStudioHost()
  const [now, setNow] = useApplicationState(Date.now)
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
          Run this automation to follow each step here. Task results and review decisions stay
          attached to the run.
        </p>
      </div>
    )
  const steps = runSteps(run, flow)
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
      viewId: 'tasks',
      entityId: id,
    })
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-3 border-b p-4">
        <ChoicePicker
          aria-label="Automation run"
          value={run.id}
          onValueChange={selectRun}
          className="h-8 w-full rounded border bg-background px-2 text-xs"
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              {new Date(item.createdAt).toLocaleString()} · {runLabels[item.status]}
            </option>
          ))}
        </ChoicePicker>
        <div className="flex items-center justify-between gap-2 text-xs">
          <strong
            className={cn(
              'font-medium',
              run.status === 'failed' && 'text-destructive',
              run.status === 'waiting' && 'text-amber-500',
            )}
          >
            {inputStep ? 'Needs input' : runLabels[run.status]}
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
            This older run has limited step history. Its tasks are listed below.
          </p>
        )}
        {inputTaskId && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-xs font-medium">{inputStep.label} needs your input</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {pendingTaskInput(snapshot, inputTaskId)}
            </p>
            <Button size="sm" className="mt-3" onClick={() => openTask(inputTaskId)}>
              Open task
            </Button>
          </div>
        )}
        {run.status === 'waiting' && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-xs font-medium">{waiting?.label ?? 'Review needed'}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Open the completed tasks below and review their changes before continuing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => void actions.review(run.id, true)}
              >
                Approve & continue
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => void actions.review(run.id, false)}
              >
                Reject
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <Button
              size="sm"
              disabled={disabled || anotherActive}
              onClick={() => void actions.retry(run.id, selectRun)}
            >
              <RotateCw />
              {run.status === 'cancelled' ? 'Resume run' : 'Retry failed step'}
            </Button>
          )}
          {active && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void actions.cancel(run.id)}
            >
              Cancel run
            </Button>
          )}
        </div>
        {canRetry && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {anotherActive
              ? 'Wait for the current run to finish before retrying.'
              : 'Continues this run. Completed tasks will not run again.'}
          </p>
        )}
      </div>
      <ol aria-label="Run steps" className="space-y-1 p-3">
        {steps.map((step, index) => {
          const task = workspace.tasks.find((task) => task.id === step.taskId)
          const duration =
            step.finishedAt || step.status === 'running' || step.status === 'waiting'
              ? elapsed(step.startedAt, step.finishedAt, now)
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
                <span className="mt-0.5 w-4 shrink-0 text-[11px] text-muted-foreground">
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
                    <StepStatus
                      step={step}
                      needsInput={
                        step.status === 'running' && !!pendingTaskInput(snapshot, step.taskId)
                      }
                    />
                    {duration && (
                      <span className="text-[11px] text-muted-foreground">{duration}</span>
                    )}
                    {step.attempt > 1 && (
                      <span className="text-[11px] text-muted-foreground">
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
          <h3 className="text-xs font-medium">Tasks in this run</h3>
          {tasks.map((task) => (
            <button
              key={task.id}
              className="flex w-full min-w-0 items-center justify-between gap-2 text-left text-xs hover:text-primary"
              onClick={() => openTask(task.id)}
            >
              <span className="min-w-0 truncate">{task.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{task.status}</span>
              <ArrowUpRight className="size-3.5 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
