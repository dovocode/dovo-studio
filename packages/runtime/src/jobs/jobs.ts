import type { Activity } from '../storage/activity.js'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { CronExpressionParser } from 'cron-parser'
import { jobRunSchema, type JobRun, type AutomationNode } from '@dovo/protocol'
import { z } from 'zod'
import { WorkspaceStore } from '../storage/workspace.js'
import { Tasks } from '../agents/tasks.js'
import { HttpError, errorMessage } from '../errors.js'
import { validateAutomation } from './validation.js'
import {
  storedRunSchema,
  runSteps,
  updateStep,
  reconcileCompletedTasks,
  type StoredRun,
} from './run-state.js'
const recordSchema = z.object({ value: z.string() })
export class Jobs {
  private runs = new Map<string, StoredRun>()
  private active = new Map<string, Promise<void>>()
  private stopping = false
  private timer?: ReturnType<typeof setInterval>
  private scheduleErrors = new Map<string, string>()
  private next = new Map<string, { signature: string; at: number }>()
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private tasks: Tasks,
    private activity?: Pick<Activity, 'add'>,
  ) {
    for (const row of db.prepare('SELECT value FROM job_runs').all()) {
      const stored = storedRunSchema.parse(JSON.parse(recordSchema.parse(row).value))
      const run = { ...stored, steps: runSteps(stored) }
      this.runs.set(run.id, run)
      if (run.status === 'running') {
        this.runs.set(run.id, reconcileCompletedTasks(run, store.get().tasks))
        this.finish(
          run.id,
          'failed',
          'Runtime stopped during execution. Retry to resume unfinished steps.',
          true,
        )
      }
    }
  }
  requireTaskIdle(id: string) {
    if (
      [...this.runs.values()].some(
        (run) =>
          run.taskIds.includes(id) &&
          (['running', 'waiting'].includes(run.status) || this.active.has(run.id)),
      )
    )
      throw new HttpError(409, 'Finish or cancel the automation before changing this thread.')
  }
  startScheduler() {
    if (this.timer || this.stopping) return
    this.timer = setInterval(() => {
      try {
        this.tick()
      } catch (error) {
        console.error('Scheduler failed', error)
      }
    }, 1000)
    this.timer.unref()
  }
  list(): JobRun[] {
    return [...this.runs.values()]
      .reverse()
      .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
      .slice(0, 100)
      .map((run) => jobRunSchema.parse(run))
  }
  private write(run: StoredRun) {
    this.db
      .prepare(
        'INSERT INTO job_runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(run.id, JSON.stringify(run))
    this.activity?.add('job', run.id, `${run.flow.name} · ${run.status}`, {
      automationId: run.automationId,
      completedNodes: run.completedNodes,
      currentNodeId: run.currentNodeId,
      failedNodeId: run.failedNodeId,
      waitingNodeId: run.waitingNodeId,
      taskIds: run.taskIds,
      error: run.error,
      triggerPayload: run.triggerPayload,
    })
  }
  private save(input: StoredRun) {
    const run = { ...input, updatedAt: new Date().toISOString() }
    this.db.transaction(() => this.write(run))()
    this.runs.set(run.id, run)
    return run
  }
  private requireIdle(automationId: string, except?: string) {
    if (this.stopping) throw new HttpError(503, 'Runtime is shutting down')
    if (
      [...this.runs.values()].some(
        (run) =>
          run.id !== except &&
          run.automationId === automationId &&
          (['running', 'waiting'].includes(run.status) || this.active.has(run.id)),
      )
    )
      throw new HttpError(409, 'This automation already has an active run')
  }
  startManual(id: string, requestId?: string) {
    const key = requestId ? `manual:${requestId}` : undefined
    const existing =
      key &&
      [...this.runs.values()].find((run) => run.automationId === id && run.deliveryKey === key)
    if (existing) return existing.id
    return this.start(id, key)
  }
  start(id: string, key?: string, triggerPayload?: unknown) {
    const flow = this.store.get().automations.find((flow) => flow.id === id)
    if (!flow) throw new HttpError(404, 'Automation not found')
    try {
      validateAutomation(flow, this.store.get())
    } catch (error) {
      throw new HttpError(400, errorMessage(error))
    }
    this.requireIdle(id)
    const now = new Date().toISOString()
    const initial: StoredRun = {
      id: randomUUID(),
      automationId: id,
      flow: structuredClone(flow),
      triggerPayload,
      deliveryKey: key,
      status: 'running',
      completedNodes: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
      attempt: 1,
    }
    const run = { ...initial, steps: runSteps(initial) }
    // A delivery is consumed only if its accepted run also commits successfully.
    this.db.transaction(() => {
      if (key) {
        const result = this.db
          .prepare('INSERT OR IGNORE INTO deliveries VALUES (?,?)')
          .run(`${id}:${key}`, now)
        if (!result.changes) throw new HttpError(409, 'This trigger was already delivered')
      }
      this.write(run)
    })()
    this.runs.set(run.id, run)
    this.launch(run.id)
    return run.id
  }
  retry(id: string) {
    const existing = this.runs.get(id)
    if (!existing) throw new HttpError(404, 'Job not found')
    if (this.active.has(id))
      throw new HttpError(409, 'Wait for the current step to stop before retrying')
    if (!['failed', 'cancelled'].includes(existing.status))
      throw new HttpError(409, 'Only failed or stopped runs can be retried')
    this.requireIdle(existing.automationId, id)
    try {
      validateAutomation(existing.flow, this.store.get())
    } catch (error) {
      throw new HttpError(400, errorMessage(error))
    }
    const reconciled = reconcileCompletedTasks(existing, this.store.get().tasks)
    if (
      runSteps(reconciled).some(
        (step) =>
          step.status !== 'completed' &&
          step.taskId &&
          this.store.get().tasks.find((task) => task.id === step.taskId)?.status === 'running',
      )
    )
      throw new HttpError(409, 'This step is still running in its task. Wait for it to finish.')
    this.save({
      ...reconciled,
      status: 'running',
      attempt: (existing.attempt ?? 1) + 1,
      steps: runSteps(reconciled).map((step) =>
        step.status === 'completed'
          ? step
          : { ...step, status: 'pending', error: undefined, finishedAt: undefined },
      ),
      currentNodeId: undefined,
      failedNodeId: undefined,
      waitingNodeId: undefined,
      error: undefined,
      interrupted: undefined,
      finishedAt: undefined,
    })
    this.launch(id)
    return id
  }
  approve(id: string, allow: boolean) {
    if (this.stopping) throw new HttpError(503, 'Runtime is shutting down')
    const run = this.runs.get(id)
    if (!run || run.status !== 'waiting' || !run.waitingNodeId)
      throw new HttpError(409, 'Job is not waiting for review')
    if (!allow) {
      this.finish(id, 'cancelled')
      return
    }
    const nodeId = run.waitingNodeId
    this.save({
      ...updateStep(run, nodeId, { status: 'completed', finishedAt: new Date().toISOString() }),
      status: 'running',
      completedNodes: [...run.completedNodes, nodeId],
      currentNodeId: undefined,
      waitingNodeId: undefined,
    })
    const pending = this.active.get(id)
    if (pending)
      void pending
        .then(() => this.launch(id))
        .catch((error) => console.error('Could not resume reviewed automation', error))
    else this.launch(id)
  }
  cancel(id: string) {
    const run = this.runs.get(id)
    if (!run) throw new HttpError(404, 'Job not found')
    if (!['running', 'waiting'].includes(run.status))
      throw new HttpError(409, 'This run has already finished')
    this.finish(id, 'cancelled')
    this.stopTask(run)
  }
  private stopTask(run: StoredRun) {
    const taskId = runSteps(run).find((step) => step.nodeId === run.currentNodeId)?.taskId
    if (!taskId || this.store.get().tasks.find((task) => task.id === taskId)?.status !== 'running')
      return
    try {
      this.tasks.cancel(taskId)
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 409)) throw error
    }
  }
  private finish(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
    interrupted?: boolean,
  ) {
    const run = this.runs.get(id)
    if (!run) return
    const finishedAt = new Date().toISOString()
    const current =
      runSteps(run).find(
        (step) =>
          step.nodeId === (run.currentNodeId ?? run.waitingNodeId) && step.status !== 'completed',
      ) ?? runSteps(run).find((step) => step.status === 'running')
    const next = current ? updateStep(run, current.nodeId, { status, error, finishedAt }) : run
    this.save({
      ...next,
      status,
      error,
      interrupted,
      finishedAt,
      currentNodeId: undefined,
      waitingNodeId: undefined,
      failedNodeId: status === 'failed' ? current?.nodeId : undefined,
    })
  }
  private launch(id: string) {
    if (this.active.has(id) || this.stopping) return
    // Schedule after registering ownership so synchronous review/completion paths
    // cannot leave a stale active promise behind.
    const pending = Promise.resolve()
      .then(() => this.advance(id))
      .finally(() => this.active.delete(id))
    this.active.set(id, pending)
    void pending.catch((error) => console.error('Automation persistence failed', error))
  }
  private createTask(run: StoredRun, node: AutomationNode) {
    const previous = this.store.get()
    let next: StoredRun = run
    try {
      const task = this.db.transaction(() => {
        const task = this.tasks.create({
          title: node.data.label,
          agentId: node.data.agentId,
          repositoryId: node.data.repositoryId,
          execution: node.data.execution,
          objective:
            run.triggerPayload === undefined
              ? node.data.objective
              : `${node.data.objective}\n\nExternal trigger data (event context):\n${JSON.stringify(run.triggerPayload, null, 2)}`,
          origin: run.automationId,
        })
        next = {
          ...updateStep(run, node.id, { taskId: task.id }),
          taskIds: [...run.taskIds, task.id],
          updatedAt: new Date().toISOString(),
        }
        this.write(next)
        return task
      })()
      this.runs.set(run.id, next)
      return task
    } catch (error) {
      // WorkspaceStore publishes its in-memory snapshot synchronously. Restore it
      // if the enclosing task + run transaction failed before commit.
      if (this.store.get() !== previous) this.store.update(() => previous)
      throw error
    }
  }
  private async advance(id: string) {
    try {
      while (!this.stopping) {
        const currentRun = this.runs.get(id)
        if (!currentRun || currentRun.status !== 'running') return
        let run: StoredRun = currentRun
        const node = run.flow.nodes.find(
          (node) =>
            !run.completedNodes.includes(node.id) &&
            run.flow.edges
              .filter((edge) => edge.target === node.id)
              .every((edge) => run.completedNodes.includes(edge.source)),
        )
        if (!node) {
          if (run.completedNodes.length !== run.flow.nodes.length)
            throw new Error('No unfinished step is ready. Check the automation connections.')
          this.finish(id, 'completed')
          return
        }
        const step = runSteps(run).find((step) => step.nodeId === node.id)!
        run = this.save({
          ...updateStep(run, node.id, {
            status: node.data.kind === 'review' ? 'waiting' : 'running',
            attempt: step.attempt + 1,
            startedAt: new Date().toISOString(),
            finishedAt: undefined,
            error: undefined,
          }),
          currentNodeId: node.id,
          status: node.data.kind === 'review' ? 'waiting' : 'running',
          waitingNodeId: node.data.kind === 'review' ? node.id : undefined,
        })
        if (node.data.kind === 'review') return
        if (node.data.kind === 'task') {
          const task = step.taskId ? this.store.task(step.taskId) : this.createTask(run, node)
          if (!['review', 'done'].includes(task.status)) {
            const execution = await this.tasks.start(task.id)
            const current = this.runs.get(id)
            if (!current || current.status !== 'running' || this.stopping) {
              this.stopTask({
                ...run,
                steps: runSteps(this.runs.get(id) ?? run),
                currentNodeId: node.id,
              })
              await execution.done.catch(() => {
                /* Cancellation is recorded on the task. */
              })
              return
            }
            await execution.done
          }
        }
        const current = this.runs.get(id)
        if (!current || current.status !== 'running' || this.stopping) return
        this.save({
          ...updateStep(current, node.id, {
            status: 'completed',
            finishedAt: new Date().toISOString(),
          }),
          completedNodes: [...current.completedNodes, node.id],
          currentNodeId: undefined,
        })
      }
    } catch (error) {
      const run = this.runs.get(id)
      if (run?.status === 'running')
        this.finish(id, 'failed', errorMessage(error), this.stopping || undefined)
    }
  }
  async shutdown() {
    this.dispose()
    this.stopping = true
    for (const run of this.runs.values()) {
      if (run.status !== 'running') continue
      this.finish(
        run.id,
        'failed',
        'Runtime stopped during execution. Retry to resume unfinished steps.',
        true,
      )
      this.stopTask(run)
    }
    await Promise.allSettled(this.active.values())
  }
  tick(now = Date.now()) {
    const flows = this.store.get().automations
    for (const id of this.next.keys())
      if (!flows.some((flow) => flow.id === id)) this.next.delete(id)
    for (const id of this.scheduleErrors.keys())
      if (!flows.some((flow) => flow.id === id)) this.scheduleErrors.delete(id)
    for (const flow of flows) {
      try {
        if (!flow.enabled) {
          this.next.delete(flow.id)
          continue
        }
        const trigger = flow.nodes.find((n) => n.data.kind === 'trigger')
        if (trigger?.data.trigger !== 'schedule') {
          this.next.delete(flow.id)
          this.scheduleErrors.delete(flow.id)
          continue
        }
        const signature = JSON.stringify(trigger.data)
        let next = this.next.get(flow.id)
        if (!next || next.signature !== signature) {
          validateAutomation(flow, this.store.get())
          next = {
            signature,
            at: CronExpressionParser.parse(trigger.data.schedule, {
              tz: trigger.data.timezone,
              currentDate: new Date(now),
            })
              .next()
              .getTime(),
          }
          this.next.set(flow.id, next)
        }
        this.scheduleErrors.delete(flow.id)
        if (next.at <= now) {
          const due = next.at
          next.at = CronExpressionParser.parse(trigger.data.schedule, {
            tz: trigger.data.timezone,
            currentDate: new Date(now),
          })
            .next()
            .getTime()
          try {
            this.start(flow.id, `schedule:${due}`)
          } catch (error) {
            if (!(error instanceof HttpError && error.status === 409))
              console.error('Scheduled job failed', error)
          }
        }
      } catch (error) {
        this.next.delete(flow.id)
        const message = errorMessage(error)
        if (this.scheduleErrors.get(flow.id) !== message)
          console.error(`Schedule ${flow.name} failed`, error)
        this.scheduleErrors.set(flow.id, message)
      }
    }
  }
  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
