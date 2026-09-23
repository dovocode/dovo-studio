import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { hostname } from 'node:os'
import { Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect'
import { startPolling, runClientEffect } from '@dovo/client-runtime'
import { liveActivityRegistrationSchema, liveTaskProps, type LiveTaskProps } from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Devices } from '../auth/devices.js'
import { HttpError, runtimeOperation } from '../errors.js'
import { Apns, apnsConfig } from './apns.js'
const rowSchema = mutableStruct({
  ...liveActivityRegistrationSchema.fields,
  ...{
    deviceId: Schema.String,
    expires: Schema.Number.pipe(Schema.finite()),
    fingerprint: Schema.String,
    sentAt: Schema.Number.pipe(Schema.finite()),
  },
})
export function activityPayload(props: LiveTaskProps, ended: boolean, now: number) {
  const timestamp = Math.floor(now / 1000)
  return {
    aps: {
      timestamp,
      event: ended ? 'end' : 'update',
      'content-state': {
        name: 'DovoTask',
        props: JSON.stringify(props),
      },
      ...(ended
        ? {
            'dismissal-date': timestamp + 300,
          }
        : {
            'stale-date': timestamp + 120,
          }),
    },
  }
}
export class LiveActivities {
  private scheduler?: ReturnType<typeof startPolling>
  private pending?: Fiber.RuntimeFiber<void, never>
  private executor = ManagedRuntime.make(Layer.empty)
  private stopped = false
  private error: string | null = null
  private nextAttempt = 0
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private devices: Devices,
    private needsInput: (taskId: string) => boolean,
    private apns = (() => {
      const config = apnsConfig()
      return config ? new Apns(config) : undefined
    })(),
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS live_activities (device_id TEXT NOT NULL, activity_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(device_id, activity_id))',
    )
  }
  status() {
    return {
      configured: !!this.apns,
      environment: this.apns?.config.production ? ('production' as const) : ('sandbox' as const),
      error: this.error,
    }
  }
  register(deviceId: string, value: unknown) {
    const input = decode(liveActivityRegistrationSchema, value)
    const task = this.store.task(input.taskId)
    if (task.status !== 'running' || task.turns?.at(-1)?.id !== input.turnId)
      throw new HttpError(409, 'This task turn is no longer running')
    const count = decode(
      mutableStruct({
        count: Schema.Number.pipe(Schema.finite()),
      }),
      this.db
        .prepare('SELECT count(*) as count FROM live_activities WHERE device_id=?')
        .get(deviceId),
    ).count
    const existing = this.db
      .prepare('SELECT value FROM live_activities WHERE device_id=? AND activity_id=?')
      .get(deviceId, input.activityId)
    if (count >= 8 && !existing)
      throw new HttpError(409, 'Too many Live Activities for this device')
    const row = {
      ...input,
      deviceId,
      expires: Date.now() + 8 * 60 * 60_000,
      fingerprint: '',
      sentAt: 0,
    }
    this.db
      .prepare('INSERT OR REPLACE INTO live_activities VALUES (?,?,?)')
      .run(deviceId, input.activityId, JSON.stringify(row))
    return this.status()
  }
  remove(deviceId: string, activityId: string) {
    this.db
      .prepare('DELETE FROM live_activities WHERE device_id=? AND activity_id=?')
      .run(deviceId, activityId)
  }
  start() {
    if (this.scheduler || this.stopped) return
    this.scheduler = startPolling(this.flushEffect(), {
      interval: 3000,
      immediate: false,
      onError: () => {
        this.error =
          'Live Activity delivery failed. Check APNs credentials and connectivity on this runtime.'
      },
    })
  }
  flushEffect(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.stopped) return Effect.void
      if (this.pending) return Fiber.join(this.pending)
      this.pending = this.executor.runFork(
        Effect.yieldNow().pipe(
          Effect.zipRight(this.deliverEffect()),
          Effect.catchAllCause(() =>
            Effect.sync(() => {
              this.error =
                'Live Activity delivery failed. Check APNs credentials and connectivity on this runtime.'
              this.nextAttempt = Date.now() + 60_000
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              this.pending = undefined
            }),
          ),
          Effect.uninterruptible,
        ),
      )
      return Fiber.join(this.pending)
    })
  }
  flush() {
    return runClientEffect(this.flushEffect())
  }
  private deliverEffect() {
    return Effect.gen(this, function* () {
      const now = Date.now()
      const trusted = new Set([
        'owner',
        ...this.devices
          .list()
          .filter((d) => !d.revokedAt)
          .map((d) => d.id),
      ])
      for (const raw of this.db.prepare('SELECT value FROM live_activities').all()) {
        const row = decode(
          rowSchema,
          JSON.parse(
            decode(
              mutableStruct({
                value: Schema.String,
              }),
              raw,
            ).value,
          ),
        )
        if (!trusted.has(row.deviceId) || row.expires <= now) {
          this.remove(row.deviceId, row.activityId)
          continue
        }
        if (!this.apns || now < this.nextAttempt) continue
        const workspace = this.store.get()
        const task = workspace.tasks.find((t) => t.id === row.taskId)
        const sameTurn = task?.turns?.at(-1)?.id === row.turnId
        const ended = !task || task.status !== 'running' || !sameTurn || !!task.archived
        const props = task
          ? liveTaskProps(
              task,
              hostname(),
              workspace.repositories.find((r) => r.id === task.repositoryId)?.name ?? '',
              this.needsInput(task.id),
            )
          : {
              title: 'Task removed',
              project: '',
              device: hostname(),
              status: 'Stopped' as const,
              startedAt: 0,
            }
        if (task && (!sameTurn || task.archived)) props.status = 'Stopped'
        const fingerprint = JSON.stringify({
          props,
          ended,
        })
        if (row.fingerprint === fingerprint && now - row.sentAt < 60_000) continue
        const apns = this.apns
        const status = yield* runtimeOperation(() =>
          apns.send(row.pushToken, activityPayload(props, ended, now)),
        )
        if (status === 410 || status === 400) {
          this.remove(row.deviceId, row.activityId)
          this.error =
            status === 400
              ? 'APNs rejected a Live Activity token or payload. Check the push environment.'
              : null
          continue
        }
        if (status !== 200) throw new Error(`APNs returned ${status}`)
        this.error = null
        if (ended) this.remove(row.deviceId, row.activityId)
        else
          this.db
            .prepare(
              'UPDATE live_activities SET value=? WHERE device_id=? AND activity_id=? AND value=?',
            )
            .run(
              JSON.stringify({
                ...row,
                fingerprint,
                sentAt: now,
              }),
              row.deviceId,
              row.activityId,
              decode(
                mutableStruct({
                  value: Schema.String,
                }),
                raw,
              ).value,
            )
      }
    })
  }
  disposeEffect() {
    return Effect.gen(this, function* () {
      this.stopped = true
      const scheduler = this.scheduler
      if (scheduler) yield* runtimeOperation(() => scheduler.stop())
      this.scheduler = undefined
      if (this.pending) yield* Fiber.await(this.pending)
      yield* runtimeOperation(() => this.executor.dispose())
    })
  }
  dispose() {
    return runClientEffect(this.disposeEffect())
  }
}
