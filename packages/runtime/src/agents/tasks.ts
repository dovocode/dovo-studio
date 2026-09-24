import { Cause, Deferred, Effect, Fiber, Layer, ManagedRuntime } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { decode } from '@dovo/protocol'
import type { Attachments } from '../storage/attachments.js'
import { TaskTurnRunner, FinalizationFailure } from './run-turn.js'
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
import {
  HttpError,
  RuntimeOperationError,
  errorMessage,
  runtimeFailure,
  runtimeOperation,
  type RuntimeFailure,
} from '../errors.js'
type Running = {
  controller: AbortController
  fiber?: Fiber.RuntimeFiber<void, RuntimeFailure>
  cwd?: string
  steer?: (messageId: string) => Promise<void>
}
export class Tasks {
  private readonly executor = ManagedRuntime.make(Layer.empty)
  private stopping = false
  private restartLease: { id: string; expiresAt: number } | undefined
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
    const input = decode(taskFeedbackSchema, value)
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
    return {
      ok: true,
    }
  }
  sendEffect(id: string, messageId: string, text: string, attachmentIds: string[] = []) {
    return runtimeOperation(() => {
      this.queue.add(id, messageId, text, this.attachments.metadata(id, attachmentIds))
      return (
        this.store.task(id).queue?.some((message) => message.id === messageId) &&
        !this.running.has(id) &&
        !this.store.task(id).queuePaused
      )
    }).pipe(
      Effect.flatMap((start) =>
        start
          ? this.startEffect(id).pipe(
              // Input is accepted durably; start failures are persisted on the task.
              Effect.catchAll(() => Effect.void),
              Effect.asVoid,
            )
          : Effect.void,
      ),
      Effect.as({ ok: true }),
    )
  }
  send(id: string, messageId: string, text: string, attachmentIds: string[] = []) {
    return runClientEffect(this.sendEffect(id, messageId, text, attachmentIds))
  }
  steerEffect(id: string, messageId: string, text: string, attachmentIds: string[] = []) {
    return runtimeOperation(() => {
      if (this.queue.accepted(id, messageId, text, this.attachments.metadata(id, attachmentIds))) {
        return null
      }
      if (this.steering.has(id))
        throw new HttpError(409, 'A steering request is already being applied')
      const run = this.running.get(id)
      if (!run) throw new HttpError(409, 'The turn finished. Send this as a follow-up instead.')
      if (this.store.task(id).runPhase === 'finalizing') {
        this.queue.add(id, messageId, text, this.attachments.metadata(id, attachmentIds))
        return null
      }
      const nativeSteer = run.steer
      const paused = this.store.task(id).queuePaused ?? false
      if (!this.queue.add(id, messageId, text, this.attachments.metadata(id, attachmentIds)))
        return null
      const token = Symbol()
      this.steering.set(id, token)
      this.store.updateTask(id, (task) => ({
        ...task,
        queuePaused: nativeSteer ? task.queuePaused : true,
        queue: [
          ...(task.queue ?? []).filter((message) => message.id === messageId),
          ...(task.queue ?? []).filter((message) => message.id !== messageId),
        ],
      }))
      return { run, nativeSteer, paused, token }
    }).pipe(
      Effect.flatMap((prepared) => {
        if (!prepared) return Effect.succeed({ ok: true })
        const { run, nativeSteer, paused, token } = prepared
        const operation = nativeSteer
          ? runtimeOperation(() => nativeSteer(messageId)).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() =>
                  this.store.updateTask(id, (task) => ({
                    ...task,
                    queuePaused: true,
                    error: `Steering was not confirmed. Your message is queued: ${errorMessage(error)}`,
                  })),
                ),
              ),
              Effect.asVoid,
            )
          : Effect.gen(this, function* () {
              run.controller.abort(new Error('Interrupted to apply steering'))
              if (run.fiber) yield* Fiber.await(run.fiber)
              if (
                this.steering.get(id) === token &&
                this.store.task(id).queue?.[0]?.id === messageId
              )
                yield* this.startEffect(id, paused)
            })
        return operation.pipe(
          Effect.as({ ok: true }),
          Effect.ensuring(
            Effect.sync(() => {
              if (this.steering.get(id) === token) this.steering.delete(id)
            }),
          ),
        )
      }),
      Effect.uninterruptible,
    )
  }
  steer(id: string, messageId: string, text: string, attachmentIds: string[] = []) {
    return runClientEffect(this.steerEffect(id, messageId, text, attachmentIds))
  }
  prepareRestart() {
    if (this.stopping || (this.restartLease && this.restartLease.expiresAt > Date.now()))
      throw new HttpError(409, 'A runtime restart is already in progress')
    if (this.running.size)
      throw new HttpError(409, 'Finish or stop running tasks before changing network access.')
    this.restartLease = { id: randomUUID(), expiresAt: Date.now() + 60000 }
    return { id: this.restartLease.id }
  }
  cancelRestart(id: string) {
    if (this.restartLease?.id === id) this.restartLease = undefined
    return { ok: true }
  }
  startEffect(
    id: string,
    pauseQueue = false,
    admit?: () => boolean,
  ): Effect.Effect<{ completion: Effect.Effect<void, RuntimeFailure> }, RuntimeFailure> {
    return Effect.suspend(() => {
      if (this.stopping || (this.restartLease && this.restartLease.expiresAt > Date.now()))
        return Effect.fail(new HttpError(503, 'Runtime is restarting. Try again shortly.'))
      return runtimeOperation(() => this.store.task(id)).pipe(
        Effect.flatMap((task) => {
          // The native boundary above yields. Admission must be rechecked in the
          // same synchronous turn that registers the worker with its executor.
          if (this.stopping || (this.restartLease && this.restartLease.expiresAt > Date.now()))
            return Effect.fail(new HttpError(503, 'Runtime is restarting. Try again shortly.'))
          if (admit && !admit()) {
            const completion: Effect.Effect<void, RuntimeFailure> = Effect.void
            return Effect.succeed({ completion })
          }
          if (task.example || task.archived || task.archivedAt)
            return Effect.fail(new HttpError(400, 'Restore this task before running it'))
          if (
            !task.messages.some(
              (message) =>
                message.role === 'user' && (message.text.trim() || message.attachments?.length),
            ) &&
            !task.queue?.length &&
            !task.turns?.length &&
            !task.consumedMessageIds?.length
          )
            return Effect.fail(
              new HttpError(400, 'Send the first prompt before starting this task'),
            )
          if (this.running.has(id))
            return Effect.fail(new HttpError(409, 'This task is already running'))
          let recoveringQueue = task.restartRecovery?.kind === 'queue'
          const recoveringTurn = task.restartRecovery?.kind === 'turn'
          let resumeInterruptedTurn = recoveringTurn
          const ready = Effect.runSync(Deferred.make<void, RuntimeFailure>())
          const run: Running = { controller: new AbortController() }
          this.store.updateTask(id, (task) => ({
            ...task,
            status: 'running',
            runPhase: task.runPhase === 'finalizing' ? 'finalizing' : 'preparing',
            runAttempt: recoveringTurn ? task.runAttempt : undefined,
            restartRecovery: undefined,
            queuePaused: pauseQueue,
            error: undefined,
            activity: 'Preparing checkout',
          }))
          this.running.set(id, run)
          const work = Effect.gen(this, function* () {
            const cwd = yield* runtimeOperation(() => this.checkouts.directory(id))
            yield* runtimeOperation(() => run.controller.signal.throwIfAborted())
            if ([...this.running.values()].some((other) => other !== run && other.cwd === cwd))
              return yield* Effect.fail(
                new HttpError(
                  409,
                  'Another task is running in this repository. Wait or cancel it first.',
                ),
              )
            if (this.checkoutMutations.has(cwd))
              return yield* Effect.fail(
                new HttpError(
                  409,
                  'This checkout is switching branches. Try again after it finishes.',
                ),
              )
            run.cwd = cwd
            yield* Deferred.succeed(ready, undefined)
            if (task.runPhase === 'finalizing') {
              yield* this.runner.finalizeEffect(id, cwd)
              resumeInterruptedTurn = false
              if (pauseQueue || !this.store.task(id).queue?.length) return
            }
            do {
              yield* runtimeOperation(() => run.controller.signal.throwIfAborted())
              if (recoveringQueue && !this.store.task(id).queue?.length) {
                this.store.updateTask(id, (current) => ({
                  ...current,
                  status: task.status,
                  runPhase: undefined,
                  activity: undefined,
                  queuePaused: true,
                }))
                return
              }
              recoveringQueue = false
              const continuing = resumeInterruptedTurn
              if (!resumeInterruptedTurn) this.queue.take(id)
              resumeInterruptedTurn = false
              yield* this.runner.runEffect(
                id,
                cwd,
                run.controller,
                (steer) => {
                  run.steer = steer
                },
                (prompt) => {
                  // Message forms outlive the turn; Stop and runtime shutdown still dismiss them.
                  void this.questions.request(
                    id,
                    prompt,
                    run.controller.signal,
                    undefined,
                    (answers, receipt) => {
                      const text = answers
                        ? prompt.questions
                            .map((q) => `${q.question}\n${(answers[q.id] ?? []).join('\n')}`)
                            .join('\n\n')
                        : `The user declined to answer:\n${prompt.questions.map((q) => q.question).join('\n')}`
                      const messageId = `answer:${receipt.id}`
                      // The answer receipt and input are one transaction, before HTTP acknowledgement.
                      this.queue.add(id, messageId, text, [], receipt)
                      if (!this.store.task(id).queue?.some((message) => message.id === messageId))
                        return
                      const active = this.running.get(id)
                      const nativeSteer = active?.steer
                      const token = Symbol()
                      const deliver =
                        nativeSteer && !this.steering.has(id)
                          ? Effect.acquireUseRelease(
                              Effect.sync(() => this.steering.set(id, token)),
                              () => runtimeOperation(() => nativeSteer(messageId)),
                              () =>
                                Effect.sync(() => {
                                  if (this.steering.get(id) === token) this.steering.delete(id)
                                }),
                            )
                          : this.sendEffect(id, messageId, text)
                      this.executor.runFork(
                        deliver.pipe(
                          Effect.catchAllCause((cause) =>
                            Effect.sync(() => {
                              this.store.updateTask(id, (task) => ({
                                ...task,
                                queuePaused: true,
                                error: `Form answer saved in the queue; delivery was not confirmed: ${errorMessage(Cause.squash(cause))}`,
                              }))
                            }),
                          ),
                        ),
                      )
                    },
                  )
                },
                continuing,
              )
            } while (!this.store.task(id).queuePaused && this.store.task(id).queue?.length)
          }).pipe(
            Effect.tapErrorCause((cause) =>
              Effect.gen(this, function* () {
                const error = runtimeFailure(Cause.squash(cause))
                if (
                  error instanceof RuntimeOperationError &&
                  error.cause instanceof FinalizationFailure
                ) {
                  yield* Deferred.fail(ready, error)
                  return
                }
                this.store.updateTask(id, (task) => ({
                  ...task,
                  status:
                    task.runPhase === 'finalizing' && task.turns?.at(-1)?.status === 'completed'
                      ? 'review'
                      : run.controller.signal.aborted
                        ? 'cancelled'
                        : 'failed',
                  runPhase: task.runPhase === 'finalizing' ? 'finalizing' : undefined,
                  queuePaused: true,
                  restartRecovery:
                    !run.controller.signal.aborted && recoveringTurn
                      ? { kind: 'turn', automatic: false }
                      : task.restartRecovery,
                  activity: undefined,
                  error: errorMessage(run.controller.signal.reason ?? error),
                }))
                yield* Deferred.fail(ready, error)
              }),
            ),
            Effect.ensuring(
              Effect.gen(this, function* () {
                // Let already-delivered input enqueue before releasing this task's ownership.
                yield* Effect.yieldNow()
                this.running.delete(id)
                const next = this.store.task(id)
                if (
                  !this.stopping &&
                  !run.controller.signal.aborted &&
                  !next.queuePaused &&
                  next.queue?.length
                ) {
                  const resumed = yield* this.startEffect(id).pipe(Effect.orDie)
                  yield* resumed.completion.pipe(Effect.orDie)
                }
              }),
            ),
            // Provider SDKs use AbortSignal. Stop aborts that signal, then we await their
            // checkpoint and cleanup before allowing the database scope to close.
            Effect.uninterruptible,
          )
          const fiber = this.executor.runFork(work)
          run.fiber = fiber
          // The executor can fail a worker before its program starts. Never leave
          // an accepted request waiting on a Deferred only that program can settle.
          fiber.addObserver((exit) => {
            if (exit._tag === 'Failure') Effect.runSync(Deferred.failCause(ready, exit.cause))
          })
          return Deferred.await(ready).pipe(Effect.as({ completion: Fiber.join(fiber) }))
        }),
      )
    })
  }
  async start(id: string, pauseQueue = false): Promise<{ done: Promise<void> }> {
    const { completion } = await runClientEffect(this.startEffect(id, pauseQueue))
    const done = runClientEffect(completion)
    // Task failures are persisted by the owning fiber; API callers choose whether to wait.
    void done.catch(() => undefined)
    return { done }
  }
  withCheckoutMutationEffect<A, E>(cwd: string, action: Effect.Effect<A, E>) {
    return Effect.acquireUseRelease(
      Effect.try({
        try: () => {
          if (
            this.checkoutMutations.has(cwd) ||
            [...this.running.values()].some((run) => !run.cwd || run.cwd === cwd)
          )
            throw new HttpError(
              409,
              'Wait for the running agent or checkout operation to finish before switching branches.',
            )
          this.checkoutMutations.add(cwd)
        },
        catch: runtimeFailure,
      }),
      () => action,
      () =>
        Effect.sync(() => {
          this.checkoutMutations.delete(cwd)
        }),
    )
  }
  withCheckoutMutation<A>(cwd: string, action: () => Promise<A>): Promise<A> {
    return runClientEffect(this.withCheckoutMutationEffect(cwd, runtimeOperation(action)))
  }
  cancel(id: string) {
    this.steering.delete(id)
    const run = this.running.get(id)
    if (!run) throw new HttpError(409, 'Task is not running')
    this.store.updateTask(id, (t) => ({
      ...t,
      queuePaused: true,
      restartRecovery: undefined,
    }))
    this.questions.cancelTask(id)
    run.controller.abort(new Error('Cancelled by user'))
  }
  /** Startup work is owned by this executor, so shutdown also drains its current task. */
  continueAfterRestart(
    enabled: () => boolean,
    automationOwns: (id: string) => boolean = () => false,
  ) {
    const ids = this.store
      .get()
      .tasks.filter((task) => task.restartRecovery)
      .map((task) => task.id)
    this.executor.runFork(
      Effect.gen(this, function* () {
        for (const id of ids) {
          if (this.stopping) break
          const task = this.store.get().tasks.find((item) => item.id === id)
          if (!task?.restartRecovery) continue
          if (
            !enabled() ||
            !task.restartRecovery.automatic ||
            task.archived ||
            automationOwns(id)
          ) {
            this.store.updateTask(id, (task) => ({
              ...task,
              restartRecovery: task.restartRecovery
                ? { ...task.restartRecovery, automatic: false }
                : undefined,
            }))
            continue
          }
          const interruptedTurn = task.restartRecovery.kind === 'turn'
          const pendingInput = task.queue?.[0]?.id
          this.activity?.add('task', id, 'Continuing after runtime restart')
          yield* this.startEffect(
            id,
            false,
            () =>
              enabled() &&
              this.store.task(id).restartRecovery?.automatic === true &&
              !this.store.task(id).archived,
          ).pipe(
            Effect.flatMap((run) => run.completion),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                if (this.stopping || this.store.task(id).status === 'cancelled') return
                // A failed startup stays actionable; it must not silently retry forever.
                this.store.updateTask(id, (task) => ({
                  ...task,
                  status:
                    task.runPhase === 'finalizing' && task.turns?.at(-1)?.status === 'completed'
                      ? 'review'
                      : 'failed',
                  queuePaused: true,
                  restartRecovery: {
                    kind:
                      interruptedTurn || !task.queue?.some((message) => message.id === pendingInput)
                        ? 'turn'
                        : 'queue',
                    automatic: false,
                  },
                  error: `Could not continue after restart. ${errorMessage(error)}`,
                }))
              }),
            ),
          )
        }
      }),
    )
  }
  disposeEffect() {
    return Effect.gen(this, function* () {
      this.stopping = true
      this.steering.clear()
      const running = [...this.running.values()]
      for (const [id, run] of this.running) {
        const task = this.store.task(id)
        if (
          !run.controller.signal.aborted &&
          task.status === 'running' &&
          task.runPhase !== 'finalizing'
        )
          this.store.updateTask(id, (task) => ({
            ...task,
            restartRecovery: {
              kind:
                task.runPhase === 'preparing' && !task.runAttempt && task.queue?.length
                  ? 'queue'
                  : 'turn',
              automatic: !task.queuePaused,
            },
          }))
        run.controller.abort(new Error('Runtime shutting down'))
      }
      yield* Effect.forEach(running, (run) => (run.fiber ? Fiber.await(run.fiber) : Effect.void), {
        concurrency: 'unbounded',
        discard: true,
      })
      yield* Effect.promise(() => this.executor.dispose())
    })
  }
  dispose() {
    return runClientEffect(this.disposeEffect())
  }
  create(
    input: Pick<Task, 'title' | 'agentId' | 'repositoryId' | 'execution' | 'pullRequest'> & {
      objective: string
      origin?: string
    },
  ) {
    const defaults = this.store.taskDefaults(input.repositoryId)
    const task: Task = {
      ...defaults,
      id: randomUUID(),
      ...input,
      execution: input.execution ?? defaults.execution,
      harness: input.agentId ? undefined : defaults.harness,
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: input.objective.trim()
        ? [{ id: randomUUID(), role: 'user', text: input.objective }]
        : [],
      files: [],
      draft: '',
      example: false,
    }
    this.store.update((w) => ({
      ...w,
      tasks: [...w.tasks, task],
    }))
    return task
  }
}
