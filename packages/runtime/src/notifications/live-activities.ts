import { activityPayload, liveActivityRefreshMs, type RelayLiveActivity } from '@dovo/protocol'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { notificationRelay, managedNotification } from './push.js'
import { hostname } from 'node:os'
import { Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect'
import { startPolling, runClientEffect } from '@dovo/client-runtime'
import { liveActivityRegistrationSchema, liveTaskProps } from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Devices } from '../auth/devices.js'
import { HttpError, runtimeOperation } from '../errors.js'
import { Apns, apnsConfig } from './apns.js'
const rowSchema = mutableStruct({
  ...liveActivityRegistrationSchema.fields,
  ...{
    deviceId: Schema.String,
    expires: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    fingerprint: Schema.String,
    sentAt: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  },
})
export { activityPayload } from '@dovo/protocol'
export class LiveActivities {
  private scheduler?: ReturnType<typeof startPolling>
  private pending?: Fiber.Fiber<void, never>
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
    private relay = notificationRelay(),
    private managedSend = managedNotification,
  ) {
    this.error = relay.error ?? null
    db.exec(
      'CREATE TABLE IF NOT EXISTS live_activities (device_id TEXT NOT NULL, activity_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(device_id, activity_id))',
    )
  }
  status(deviceId?: string) {
    const managed =
      deviceId &&
      this.db
        .prepare(
          "SELECT activity_id FROM live_activities WHERE device_id=? AND json_extract(value,'$.managedToken') IS NOT NULL LIMIT 1",
        )
        .get(deviceId)
    return {
      configured: !!this.apns || !!this.relay.send || !!managed,
      environment: this.apns?.config.production ? ('production' as const) : ('sandbox' as const),
      error: this.error,
    }
  }
  register(deviceId: string, value: unknown) {
    const input = decode(liveActivityRegistrationSchema, value)
    if (input.managedToken && (!input.runtimeId || !input.environment))
      throw new HttpError(400, 'Managed Live Activities require a runtime and push environment')
    const task = this.store.task(input.taskId)
    if (task.status !== 'running' || task.turns?.at(-1)?.id !== input.turnId)
      throw new HttpError(409, 'This task turn is no longer running')
    const count = decode(
      mutableStruct({
        count: Schema.Number.pipe(Schema.check(Schema.isFinite())),
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
    return this.status(deviceId)
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
          'Live Activity delivery failed. Check push delivery configuration and connectivity.'
      },
    })
  }
  flushEffect(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.stopped) return Effect.void
      if (this.pending) return Fiber.join(this.pending)
      this.pending = this.executor.runFork(
        Effect.yieldNow.pipe(
          Effect.andThen(this.deliverEffect()),
          Effect.catchCause(() =>
            Effect.sync(() => {
              this.error =
                'Live Activity delivery failed. Check push delivery configuration and connectivity.'
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
    return Effect.gen({ self: this }, function* () {
      const now = Date.now()
      const trusted = new Set([
        'owner',
        ...this.devices
          .list()
          .filter((d) => !d.revokedAt)
          .map((d) => d.id),
      ])
      for (const raw of this.db.prepare('SELECT value FROM live_activities').all()) {
        const stored = decode(mutableStruct({ value: Schema.String }), raw).value
        const row = decode(rowSchema, JSON.parse(stored))
        if (!trusted.has(row.deviceId) || row.expires <= now) {
          this.remove(row.deviceId, row.activityId)
          continue
        }
        if ((!this.apns && !this.relay.send && !row.managedToken) || now < this.nextAttempt)
          continue
        const workspace = this.store.get()
        const task = workspace.tasks.find((t) => t.id === row.taskId)
        const sameTurn = task?.history.latestTurn?.id === row.turnId
        const ended = !task || task.status !== 'running' || !sameTurn || !!task.archived
        const props = task
          ? liveTaskProps(
              task,
              hostname(),
              workspace.repositories.find((r) => r.id === task.repositoryId)?.name ?? '',
              this.needsInput(task.id),
              workspace.tasks.filter((entry) => entry.status === 'running' && !entry.archived)
                .length,
            )
          : {
              title: 'Task removed',
              activity: 'Thread removed',
              project: '',
              device: hostname(),
              status: 'Stopped' as const,
              startedAt: 0,
            }
        if (task && (!sameTurn || task.archived)) {
          props.status = 'Stopped'
          props.activity = 'Thread stopped'
        }
        const fingerprint = JSON.stringify({
          props,
          ended,
        })
        if (row.fingerprint === fingerprint && now - row.sentAt < liveActivityRefreshMs) continue
        const message: RelayLiveActivity | undefined =
          row.runtimeId && row.environment
            ? {
                kind: 'liveactivity',
                platform: 'ios',
                token: row.pushToken,
                runtimeId: row.runtimeId,
                activityId: row.activityId,
                taskId: row.taskId,
                turnId: row.turnId,
                environment: row.environment,
                id: createHash('sha256')
                  .update(JSON.stringify([row.runtimeId, row.activityId]))
                  .digest('hex'),
                event: ended ? 'end' : 'update',
                timestamp: Math.floor(now / 1000),
                props,
              }
            : undefined
        const result = yield* runtimeOperation(async () => {
          if (row.managedToken && message)
            return row.managedOrigin
              ? this.managedSend(message, row.managedToken, row.managedOrigin)
              : this.managedSend(message, row.managedToken)
          if (this.relay.send && message) return this.relay.send(message)
          if (!this.apns) throw new Error('Live Activity push delivery is not configured')
          const status = await this.apns.send(row.pushToken, activityPayload(props, ended, now))
          if (status !== 200 && status !== 400 && status !== 410)
            throw new Error(`APNs returned ${status}`)
          return { delivered: status === 200, invalidToken: status === 410 || status === 400 }
        })
        if (result.invalidToken) {
          this.db
            .prepare('DELETE FROM live_activities WHERE device_id=? AND activity_id=? AND value=?')
            .run(row.deviceId, row.activityId, stored)
          this.error = null
          continue
        }
        if (!result.delivered) throw new Error('Live Activity was not delivered')
        this.error = null
        if (ended)
          this.db
            .prepare('DELETE FROM live_activities WHERE device_id=? AND activity_id=? AND value=?')
            .run(row.deviceId, row.activityId, stored)
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
              stored,
            )
      }
    })
  }
  disposeEffect() {
    return Effect.gen({ self: this }, function* () {
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
