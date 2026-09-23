import type { Attachments } from '../storage/attachments.js'
import { TaskTurnRunner } from './run-turn.js'
import { TaskQueue } from './task-queue.js'
import type { Questions } from './questions.js'
import type { Activity } from '../storage/activity.js'
import { taskFeedbackSchema } from '@dovo/protocol'
import type { Commands } from '../storage/commands.js'
import type { TaskCheckout } from '../scm/task-checkout.js'
import { randomUUID } from 'node:crypto'
import type { Task } from '@dovo/protocol'
import { WorkspaceStore } from '../storage/workspace.js'
import { GitService } from '../scm/git.js'
import { AgentRegistry } from './registry.js'
import { Approvals } from './approvals.js'
import { HttpError, errorMessage } from '../errors.js'
type Running = {
  controller: AbortController
  done: Promise<void>
  cwd?: string
  steer?: (messageId: string) => Promise<void>
}
export class Tasks {
  private steering = new Map<string, symbol>()
  private checkoutMutations = new Set<string>()
  private running = new Map<string, Running>()
  readonly queue: TaskQueue
  private runner: TaskTurnRunner
  constructor(
    private store: WorkspaceStore,
    git: GitService,
    registry: AgentRegistry,
    approvals: Approvals,
    private checkouts: TaskCheckout,
    commands: Commands,
    private questions: Questions,
    private attachments: Attachments,
    private activity?: Pick<Activity, 'add'>,
  ) {
    this.runner = new TaskTurnRunner(
      store,
      git,
      registry,
      approvals,
      commands,
      questions,
      attachments,
      activity,
    )
    this.queue = new TaskQueue(store, activity)
  }
  requireIdle(id: string) {
    const task = this.store.task(id)
    if (task.status === 'running' || this.running.has(id))
      throw new HttpError(409, 'Stop the active turn before archiving or deleting this thread.')
  }
  feedback(value: unknown) {
    const input = taskFeedbackSchema.parse(value)
    const task = this.store.task(input.id)
    const file = task.files.find((f) => f.path === input.path)
    const lines = (input.side === 'additions' ? file?.after : file?.before)?.split('\n')
    if (
      !lines ||
      input.end > lines.length ||
      lines.slice(input.start - 1, input.end).join('\n') !== input.excerpt
    )
      throw new HttpError(409, 'This diff changed. Refresh and select the lines again.')
    const { id, path, ...comment } = input
    this.store.updateTask(id, (t) => ({
      ...t,
      messages: [
        ...t.messages,
        {
          id: randomUUID(),
          role: 'user',
          file: path,
          diffComment: comment,
          text: `Review feedback on ${path}:${input.start}-${input.end} (${input.side === 'additions' ? 'new' : 'old'} version):\n${input.body}\n\nCode at time of comment:\n${input.excerpt}`,
        },
      ],
    }))
    return { ok: true }
  }
  async send(id: string, messageId: string, text: string, attachmentIds: string[] = []) {
    this.queue.add(id, messageId, text, this.attachments.metadata(id, attachmentIds))
    const queued = this.store.task(id).queue?.some((m) => m.id === messageId)
    if (queued && !this.running.has(id) && !this.store.task(id).queuePaused) {
      try {
        await this.start(id)
      } catch {
        /* Accepted input remains queued; task.error explains why execution paused. */
      }
    }
    return { ok: true }
  }
  async steer(id: string, messageId: string, text: string, attachmentIds: string[] = []) {
    const task = this.store.task(id)
    if ([...task.messages, ...(task.queue ?? [])].some((m) => m.id === messageId)) {
      this.queue.add(id, messageId, text, this.attachments.metadata(id, attachmentIds))
      return { ok: true }
    }
    if (this.steering.has(id))
      throw new HttpError(409, 'A steering request is already being applied')
    const run = this.running.get(id)
    if (!run) throw new HttpError(409, 'The turn finished. Send this as a follow-up instead.')
    const nativeSteer = run.steer
    const paused = this.store.task(id).queuePaused ?? false
    if (!this.queue.add(id, messageId, text, this.attachments.metadata(id, attachmentIds)))
      return { ok: true }
    const token = Symbol()
    this.steering.set(id, token)
    this.store.updateTask(id, (t) => ({
      ...t,
      queuePaused: nativeSteer ? t.queuePaused : true,
      queue: [
        ...(t.queue ?? []).filter((m) => m.id === messageId),
        ...(t.queue ?? []).filter((m) => m.id !== messageId),
      ],
    }))
    if (nativeSteer) {
      try {
        await nativeSteer(messageId)
      } catch (error) {
        // Keep unconfirmed input queued and paused; never silently replay it into the harness.
        this.store.updateTask(id, (t) => ({
          ...t,
          queuePaused: true,
          error: `Steering was not confirmed. Your message is queued: ${errorMessage(error)}`,
        }))
      } finally {
        if (this.steering.get(id) === token) this.steering.delete(id)
      }
      return { ok: true }
    }
    run.controller.abort(new Error('Interrupted to apply steering'))
    try {
      await run.done.catch(() => {
        /* The interrupted turn records its checkpoint and status. */
      })
      if (this.steering.get(id) === token && this.store.task(id).queue?.[0]?.id === messageId)
        await this.start(id, paused)
      return { ok: true }
    } finally {
      if (this.steering.get(id) === token) this.steering.delete(id)
    }
  }
  async start(id: string, pauseQueue = false): Promise<{ done: Promise<void> }> {
    const task = this.store.task(id)
    if (task.example || task.archived)
      throw new HttpError(400, 'Restore this task before running it')
    if (this.running.has(id)) throw new HttpError(409, 'This task is already running')
    let resolveReady = () => {},
      rejectReady = (_error: unknown) => {}
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const run: Running = { controller: new AbortController(), done: Promise.resolve() }
    this.running.set(id, run)
    this.store.updateTask(id, (t) => ({
      ...t,
      status: 'running',
      queuePaused: pauseQueue,
      error: undefined,
      activity: 'Preparing checkout',
    }))
    run.done = Promise.resolve()
      .then(async () => {
        const cwd = await this.checkouts.directory(id)
        run.controller.signal.throwIfAborted()
        if ([...this.running.values()].some((other) => other !== run && other.cwd === cwd))
          throw new HttpError(
            409,
            'Another task is running in this repository. Wait or cancel it first.',
          )
        if (this.checkoutMutations.has(cwd))
          throw new HttpError(
            409,
            'This checkout is switching branches. Try again after it finishes.',
          )
        run.cwd = cwd
        resolveReady()
        do {
          run.controller.signal.throwIfAborted()
          this.queue.take(id)
          await this.runner.run(
            id,
            cwd,
            run.controller,
            (steer) => {
              run.steer = steer
            },
            (prompt) => {
              // Message forms outlive the turn; Stop and runtime shutdown still dismiss them.
              const deliver = async (answers: import('@dovo/protocol').QuestionAnswers | null) => {
                try {
                  const text = answers
                    ? prompt.questions
                        .map((q) => `${q.question}\n${(answers[q.id] ?? []).join('\n')}`)
                        .join('\n\n')
                    : `The user declined to answer:\n${prompt.questions.map((q) => q.question).join('\n')}`
                  const messageId = randomUUID()
                  if (this.running.get(id)?.steer && !this.steering.has(id))
                    await this.steer(id, messageId, text)
                  else await this.send(id, messageId, text)
                } catch (error) {
                  this.store.updateTask(id, (t) => ({
                    ...t,
                    error: `Could not deliver the form answer: ${errorMessage(error)}`,
                  }))
                }
              }
              void this.questions.request(
                id,
                prompt,
                run.controller.signal,
                undefined,
                (answers) => {
                  void deliver(answers)
                },
              )
            },
          )
        } while (!this.store.task(id).queuePaused && this.store.task(id).queue?.length)
      })
      .catch((error) => {
        this.store.updateTask(id, (t) => ({
          ...t,
          status: run.controller.signal.aborted ? 'cancelled' : 'failed',
          queuePaused: true,
          activity: undefined,
          error: errorMessage(run.controller.signal.reason ?? error),
        }))
        rejectReady(error)
        throw error
      })
      .finally(async () => {
        this.running.delete(id)
        // A message can arrive between the last queue check and releasing the running task.
        const next = this.store.task(id)
        if (!run.controller.signal.aborted && !next.queuePaused && next.queue?.length) {
          const resumed = await this.start(id)
          await resumed.done
        }
      })
    void run.done.catch(() => {
      /* Failure is persisted on the task. */
    })
    await ready
    return { done: run.done }
  }
  async withCheckoutMutation<T>(cwd: string, action: () => Promise<T>): Promise<T> {
    if (
      this.checkoutMutations.has(cwd) ||
      [...this.running.values()].some((run) => !run.cwd || run.cwd === cwd)
    )
      throw new HttpError(
        409,
        'Wait for the running agent or checkout operation to finish before switching branches.',
      )
    this.checkoutMutations.add(cwd)
    try {
      return await action()
    } finally {
      this.checkoutMutations.delete(cwd)
    }
  }
  cancel(id: string) {
    this.steering.delete(id)
    const run = this.running.get(id)
    if (!run) throw new HttpError(409, 'Task is not running')
    this.store.updateTask(id, (t) => ({ ...t, queuePaused: true }))
    this.questions.cancelTask(id)
    run.controller.abort(new Error('Cancelled by user'))
  }
  async dispose() {
    this.steering.clear()
    for (const run of this.running.values())
      run.controller.abort(new Error('Runtime shutting down'))
    await Promise.allSettled([...this.running.values()].map((run) => run.done))
  }
  create(
    input: Pick<Task, 'title' | 'agentId' | 'repositoryId' | 'execution' | 'pullRequest'> & {
      objective: string
      origin?: string
    },
  ) {
    const task: Task = {
      id: randomUUID(),
      ...input,
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [{ id: randomUUID(), role: 'user', text: input.objective }],
      files: [],
      draft: '',
      example: false,
    }
    this.store.update((w) => ({ ...w, tasks: [...w.tasks, task] }))
    return task
  }
}
