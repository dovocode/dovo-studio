import { routineQuietNow } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { Effect, Result, Schema } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import {
  ACCOUNT_DIRECTORY_URL,
  notificationTestTaskId,
  connectServiceOrigin,
  decode,
  mutableStruct,
  pushRegistrationSchema,
  relayResultSchema,
  relayNotificationSchema,
  notificationQuestion,
  notificationQuestionBody,
  type QuestionPrompt,
  type PushRegistration,
  type RelayNotification,
  type RelayMessage,
  type TaskSummary,
} from '@dovo/protocol'
import type { WorkspaceChange, WorkspaceStore } from '../storage/workspace.js'
import type { Devices } from '../auth/devices.js'
import { HttpError } from '../errors.js'

const record = mutableStruct({ deviceId: Schema.String, value: Schema.String })
const outboxEntrySchema = mutableStruct({
  ...record.fields,
  id: Schema.String,
  attempt: Schema.Number,
})
type OutboxEntry = Schema.Schema.Type<typeof outboxEntrySchema>
const parallelDevices = 4
const stateSchema = mutableStruct({
  running: Schema.Boolean,
  failed: Schema.Boolean,
  cancelled: Schema.Boolean,
  input: Schema.String,
  turn: Schema.String,
  checks: Schema.String,
  pull: Schema.Number,
})
type State = Schema.Schema.Type<typeof stateSchema>
type PendingInput = {
  id: string
  preview: string
  type?: 'question' | 'approval'
  prompt?: QuestionPrompt
}
type Relay<Message = RelayMessage> = {
  error?: string
  send?: (message: Message) => Promise<{ delivered: boolean; invalidToken: boolean }>
}
export function notificationRelay(env = process.env): Relay {
  if (!env.DOVO_NOTIFICATION_RELAY_URL || !env.DOVO_NOTIFICATION_RELAY_TOKEN) return {}
  let url: URL
  try {
    url = new URL(env.DOVO_NOTIFICATION_RELAY_URL)
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      env.DOVO_NOTIFICATION_RELAY_TOKEN.length < 32
    )
      throw new Error('Invalid relay configuration')
  } catch {
    return { error: 'Set a valid notification relay URL and a token of at least 32 characters.' }
  }
  return {
    async send(message) {
      const response = await fetch(`${url.href.replace(/\/$/, '')}/v1/notifications`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.DOVO_NOTIFICATION_RELAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('Notification relay could not deliver the message')
      return decode(relayResultSchema, await response.json())
    },
  }
}
export async function managedNotification(
  message: RelayMessage,
  token: string,
  origin = ACCOUNT_DIRECTORY_URL,
) {
  const response = await fetch(
    connectServiceOrigin(origin) +
      ('kind' in message ? '/v1/push/activities/send' : '/v1/push/send'),
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (response.status === 401 || response.status === 410)
    return { delivered: false, invalidToken: true }
  if (!response.ok) throw new Error('Managed notification delivery failed')
  return decode(relayResultSchema, await response.json())
}
const clipText = (text: string, limit: number) =>
  text.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '')
const preview = (text: string) => clipText(text.replace(/\s+/g, ' ').trim(), 350)
export class PushNotifications {
  private scheduler?: ReturnType<typeof startPolling>
  private pending?: Promise<void>
  private stopped = false
  private error: string | null
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private devices: Devices,
    private input: (taskId: string) => PendingInput | PendingInput[] | undefined,
    private relay: Relay<RelayNotification> = notificationRelay(),
    private managedSend: (
      message: RelayNotification,
      token: string,
      origin?: string,
    ) => ReturnType<typeof managedNotification> = managedNotification,
  ) {
    this.error = relay.error ?? null
    db.exec(`CREATE TABLE IF NOT EXISTS push_devices (device_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_states (task_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_completions (task_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_outbox (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL, attempt INTEGER NOT NULL, next INTEGER NOT NULL);`)
  }
  /** Called inside the workspace transaction so a short run survives the polling interval. */
  workspace({ before, after }: WorkspaceChange) {
    if (
      before.tasks === after.tasks ||
      !this.db.prepare('SELECT 1 FROM push_devices LIMIT 1').get()
    )
      return
    const running = new Set(
      before.tasks.filter((task) => task.status === 'running').map(({ id }) => id),
    )
    if (!running.size) return
    const save = this.db.prepare('INSERT OR REPLACE INTO push_completions VALUES (?,?)')
    for (const task of after.tasks) {
      if (running.has(task.id) && ['review', 'done', 'failed'].includes(task.status))
        save.run(task.id, task.history.latestTurn?.id ?? '')
    }
  }
  private registration(deviceId: string): PushRegistration | undefined {
    const row = this.db.prepare('SELECT value FROM push_devices WHERE device_id=?').get(deviceId)
    if (!row) return
    try {
      return decode(
        pushRegistrationSchema,
        JSON.parse(decode(mutableStruct({ value: Schema.String }), row).value),
      )
    } catch {
      this.error = 'A saved push registration is unreadable. Its record was preserved.'
      return undefined
    }
  }
  status(deviceId: string) {
    const registration = this.registration(deviceId)
    const unreadable = this.db
      .prepare(
        'SELECT 1 FROM push_outbox WHERE device_id=? AND attempt=0 AND next=expires AND expires>? LIMIT 1',
      )
      .get(deviceId, Date.now())
    // Another device's success clears the shared error; this device's own retry still shows.
    const waiting = this.db
      .prepare('SELECT 1 FROM push_outbox WHERE device_id=? AND attempt>0 LIMIT 1')
      .get(deviceId)
    return {
      configured: !!this.relay.send || !!registration?.managedToken,
      registered: !!registration,
      error:
        (unreadable
          ? 'A queued notification is unreadable. Its record was preserved until expiry.'
          : null) ??
        this.error ??
        (waiting
          ? 'Push delivery failed. Check the relay connection and provider credentials.'
          : null),
    }
  }
  async test(deviceId: string) {
    const registration = this.registration(deviceId)
    if (!registration) throw new HttpError(409, 'Enable notifications for this computer first.')
    const value = decode(relayNotificationSchema, {
      platform: registration.platform,
      token: registration.token,
      environment: registration.environment,
      id: createHash('sha256').update(randomUUID()).digest('hex'),
      title: 'Dovo test notification',
      body: 'Notification delivery from your computer is working.',
      data: { runtimeId: registration.runtimeId, taskId: notificationTestTaskId, kind: 'done' },
    })
    const result = registration.managedToken
      ? await this.managedSend(value, registration.managedToken, registration.managedOrigin)
      : await this.relay.send?.(value)
    if (result?.invalidToken) {
      if (!this.removeInvalidRegistration(deviceId, registration))
        throw new HttpError(
          409,
          'This device registered a different push token. Run the test again.',
        )
      throw new HttpError(
        409,
        'This device’s push token expired. Disable and enable notifications to register it again.',
      )
    }
    if (!result?.delivered)
      throw new HttpError(
        502,
        'The notification service did not accept the test. Check delivery settings.',
      )
    return { ok: true }
  }
  register(deviceId: string, value: unknown) {
    const registration = decode(pushRegistrationSchema, value)
    if (!this.relay.send && !registration.managedToken)
      throw new HttpError(409, 'Configure the notification relay on this runtime first')
    const existing = this.registration(deviceId)
    if (
      existing &&
      (existing.token !== registration.token ||
        existing.platform !== registration.platform ||
        existing.environment !== registration.environment ||
        existing.runtimeId !== registration.runtimeId ||
        existing.questionActions !== registration.questionActions)
    )
      this.db.prepare('DELETE FROM push_outbox WHERE device_id=?').run(deviceId)
    this.db
      .prepare('INSERT OR REPLACE INTO push_devices VALUES (?,?)')
      .run(deviceId, JSON.stringify(registration))
    if (registration.managedToken) this.start()
    return this.status(deviceId)
  }
  remove(deviceId: string) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM push_devices WHERE device_id=?').run(deviceId)
      this.db.prepare('DELETE FROM push_outbox WHERE device_id=?').run(deviceId)
    })()
  }
  private removeInvalidRegistration(deviceId: string, sent: PushRegistration) {
    const current = this.registration(deviceId)
    if (
      !current ||
      current.token !== sent.token ||
      current.platform !== sent.platform ||
      current.environment !== sent.environment ||
      current.managedToken !== sent.managedToken ||
      current.managedOrigin !== sent.managedOrigin
    )
      return false
    this.remove(deviceId)
    return true
  }
  private inputs(taskId: string): PendingInput[] {
    const value = this.input(taskId)
    return value ? (Array.isArray(value) ? value : [value]) : []
  }
  private state(task: TaskSummary): State {
    const turn = task.history.latestTurn
    return {
      running: task.status === 'running',
      failed: task.status === 'failed',
      cancelled:
        task.status === 'cancelled' || task.status === 'draft' || turn?.status === 'cancelled',
      input: JSON.stringify(
        this.inputs(task.id)
          .map((entry) => entry.id)
          .sort(),
      ),
      turn: turn?.id ?? '',
      checks: task.pullStatus?.checks ?? '',
      pull: task.pullStatus?.number ?? 0,
    }
  }
  private capture() {
    const trusted = new Set([
      'owner',
      ...this.devices
        .list()
        .filter((device) => !device.revokedAt)
        .map((device) => device.id),
    ])
    const registrations: Array<{ deviceId: string; value: PushRegistration }> = []
    for (const raw of this.db
      .prepare('SELECT device_id AS deviceId,value FROM push_devices')
      .all()) {
      const entry = decode(record, raw)
      if (!trusted.has(entry.deviceId)) {
        this.remove(entry.deviceId)
        continue
      }
      try {
        registrations.push({
          deviceId: entry.deviceId,
          value: decode(pushRegistrationSchema, JSON.parse(entry.value)),
        })
      } catch {
        this.error = 'A saved push registration is unreadable. Its record was preserved.'
      }
    }
    this.db.transaction(() => {
      const completions = new Map(
        this.db
          .prepare('SELECT task_id AS id, turn_id AS turn FROM push_completions')
          .all()
          .map((row) => decode(mutableStruct({ id: Schema.String, turn: Schema.String }), row))
          .map(({ id, turn }) => [id, turn]),
      )
      for (const task of this.store.get().tasks) {
        const current = this.state(task)
        const completed = completions.get(task.id) === current.turn
        const raw = this.db.prepare('SELECT value FROM push_states WHERE task_id=?').get(task.id)
        let before: State | undefined
        if (raw) {
          try {
            before = decode(
              stateSchema,
              JSON.parse(decode(mutableStruct({ value: Schema.String }), raw).value),
            )
          } catch {
            // Rebuild this projection. The completion record still carries a real transition.
          }
        }
        if (!completed && before && JSON.stringify(current) === JSON.stringify(before)) continue
        this.db
          .prepare('INSERT OR REPLACE INTO push_states VALUES (?,?)')
          .run(task.id, JSON.stringify(current))
        if (task.example || task.archived) continue
        const kinds: Array<{ kind: RelayNotification['data']['kind']; input?: PendingInput }> = []
        let previousInputs: string[]
        try {
          const parsed: unknown = JSON.parse(before?.input ?? '[]')
          previousInputs = Array.isArray(parsed)
            ? parsed.filter((id): id is string => typeof id === 'string')
            : []
        } catch {
          previousInputs = before?.input ? [before.input] : []
        }
        const inputs = this.inputs(task.id)
        for (const input of inputs)
          if (!previousInputs.includes(input.id)) kinds.push({ kind: 'input', input })
        if (
          !inputs.length &&
          (completed || before?.running) &&
          !current.running &&
          !current.cancelled &&
          (current.failed || (!task.delegation && !task.spawnParent))
        )
          if (
            current.failed ||
            !routineQuietNow(
              this.store.get().automations.find((flow) => flow.id === task.origin)?.policy
                ?.quietHours,
            )
          )
            kinds.push({ kind: current.failed ? 'failed' : 'done' })
        for (const { kind, input } of kinds) {
          if (!registrations.length) break
          const detail = kind === 'input' ? input?.preview : this.store.latestAssistantText(task.id)
          for (const registration of registrations) {
            const id = createHash('sha256')
              .update(JSON.stringify([registration.deviceId, task.id, kind, current, input?.id]))
              .digest('hex')
            const question =
              kind === 'input' &&
              input?.type === 'question' &&
              input.prompt &&
              registration.value.questionActions === 1
                ? notificationQuestion(input.prompt)
                : undefined
            const label = {
              input: 'Needs your input',
              done: 'Finished',
              failed: 'Failed',
              'checks-passed': 'PR checks passed',
              'checks-failed': 'PR checks failed',
            }[kind]
            const project = this.store
              .get()
              .repositories.find((repo) => repo.id === task.repositoryId)?.name
            const message: RelayNotification = {
              platform: registration.value.platform,
              token: registration.value.token,
              environment: registration.value.environment,
              id,
              title: clipText(`${task.title || 'Dovo task'} · ${label}`, 160),
              body:
                question && input?.prompt
                  ? notificationQuestionBody(input.prompt)
                  : preview(detail ?? '') || label,
              data: {
                runtimeId: registration.value.runtimeId,
                taskId: task.id,
                kind,
                ...(current.turn ? { turnId: current.turn } : {}),
                ...(kind === 'input'
                  ? {
                      inputId: input?.id,
                      inputType: input?.type,
                      ...(question ? { question: JSON.stringify(question) } : {}),
                    }
                  : {}),
                project: project === undefined ? undefined : clipText(project, 200),
              },
            }
            // APNs/FCM cap the full UTF-8 payload at 4 KB, including identity and options.
            if (
              message.data.question &&
              Buffer.byteLength(
                JSON.stringify({
                  title: message.title,
                  body: message.body,
                  ...message.data,
                  thread: `${message.data.runtimeId}:${message.data.taskId}`,
                  subtitle: message.data.project,
                }),
              ) > 3500
            ) {
              delete message.data.question
              message.body = preview(detail ?? '') || label
            }
            this.db
              .prepare('INSERT OR IGNORE INTO push_outbox VALUES (?,?,?,?,0,0)')
              .run(id, registration.deviceId, JSON.stringify(message), Date.now() + 3_600_000)
          }
        }
      }
      this.db.prepare('DELETE FROM push_completions').run()
      // Removed tasks cannot leave state or pending notifications behind.
      const ids = new Set(this.store.get().tasks.map((task) => task.id))
      for (const raw of this.db.prepare('SELECT task_id AS id FROM push_states').all()) {
        const { id } = decode(mutableStruct({ id: Schema.String }), raw)
        if (!ids.has(id)) this.db.prepare('DELETE FROM push_states WHERE task_id=?').run(id)
      }
      this.db.prepare('DELETE FROM push_outbox WHERE expires<=?').run(Date.now())
    })()
  }
  flush() {
    if (this.stopped) return Promise.resolve()
    if (this.pending) return this.pending
    this.pending = this.deliver().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }
  private async deliver() {
    this.capture()
    const now = Date.now()
    // Give each due device a slot before spending the batch on one device's backlog.
    const rows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT id,device_id AS deviceId,value,attempt,expires,
                  ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY expires,rowid) AS device_rank
           FROM push_outbox AS due
           WHERE next<=? AND NOT EXISTS (
             SELECT 1 FROM push_outbox AS waiting
             WHERE waiting.device_id=due.device_id AND waiting.attempt>0 AND waiting.next>?
           )
         )
         SELECT id,deviceId,value,attempt FROM ranked ORDER BY device_rank,expires,deviceId LIMIT 20`,
      )
      .all(now, now)
    const devices = new Map<string, OutboxEntry[]>()
    for (const raw of rows) {
      const entry = decode(outboxEntrySchema, raw)
      const batch = devices.get(entry.deviceId)
      if (batch) batch.push(entry)
      else devices.set(entry.deviceId, [entry])
    }
    // Settle every lane before admitting another flush, even if a database operation fails.
    const outcomes = await Effect.runPromise(
      Effect.forEach(
        devices.values(),
        (entries) => Effect.result(Effect.tryPromise(() => this.deliverDevice(entries))),
        { concurrency: parallelDevices },
      ),
    )
    const fault = outcomes.find(Result.isFailure)
    if (fault) throw fault.failure
    if (outcomes.some((outcome) => Result.isSuccess(outcome) && outcome.success === 'failed'))
      this.error = 'Push delivery failed. Check the relay connection and provider credentials.'
    else if (
      outcomes.some((outcome) => Result.isSuccess(outcome) && outcome.success === 'delivered')
    )
      this.error = null
  }
  private async deliverDevice(entries: readonly OutboxEntry[]) {
    let delivered = false
    for (const entry of entries) {
      if (this.stopped) break
      if (
        entry.deviceId !== 'owner' &&
        !this.devices.list().some((device) => device.id === entry.deviceId && !device.revokedAt)
      ) {
        this.remove(entry.deviceId)
        continue
      }
      let value: RelayNotification
      try {
        value = decode(relayNotificationSchema, JSON.parse(entry.value))
      } catch {
        // Keep the record until its normal expiry without imposing backoff on this device.
        this.db.prepare('UPDATE push_outbox SET attempt=0,next=expires WHERE id=?').run(entry.id)
        continue
      }
      const task = this.store.get().tasks.find((task) => task.id === value.data.taskId)
      const latest = task?.history.latestTurn
      const staleTurn = value.data.turnId && latest?.id !== value.data.turnId
      const staleCompletion =
        (value.data.kind === 'done' || value.data.kind === 'failed') &&
        (task?.status === 'running' ||
          task?.status === 'cancelled' ||
          task?.status === 'draft' ||
          latest?.status === 'cancelled')
      if (
        !['input', 'done', 'failed'].includes(value.data.kind) ||
        !task ||
        task.archived ||
        task.example ||
        (value.data.kind === 'done' && !!(task.delegation || task.spawnParent)) ||
        staleTurn ||
        staleCompletion
      ) {
        this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        continue
      }
      const registration = this.registration(entry.deviceId)
      if (!registration || registration.token !== value.token) {
        this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        continue
      }
      if (
        value.data.kind === 'input' &&
        (!this.inputs(value.data.taskId).length ||
          (value.data.inputId &&
            !this.inputs(value.data.taskId).some((input) => input.id === value.data.inputId)))
      ) {
        this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        continue
      }
      try {
        const result = registration.managedToken
          ? registration.managedOrigin
            ? await this.managedSend(value, registration.managedToken, registration.managedOrigin)
            : await this.managedSend(value, registration.managedToken)
          : await this.relay.send?.(value)
        if (!result) throw new Error('Notification relay is not configured')
        if (result.invalidToken) {
          if (!this.removeInvalidRegistration(entry.deviceId, registration))
            this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        } else if (result.delivered)
          this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        else throw new Error('Notification was not delivered')
        delivered = true
      } catch {
        const attempt = entry.attempt + 1
        const next = Date.now() + Math.min(30_000 * 2 ** Math.min(attempt - 1, 5), 900_000)
        this.db
          .prepare('UPDATE push_outbox SET attempt=?,next=? WHERE id=?')
          .run(attempt, next, entry.id)
        return 'failed' as const
      }
    }
    return delivered ? ('delivered' as const) : ('idle' as const)
  }
  start() {
    if (this.db.prepare('SELECT 1 FROM push_devices WHERE NOT json_valid(value) LIMIT 1').get())
      this.error = 'Some saved push registrations are unreadable. Their records were preserved.'
    const managed = this.db
      .prepare(
        "SELECT device_id FROM push_devices WHERE CASE WHEN json_valid(value) THEN json_extract(value,'$.managedToken') END IS NOT NULL LIMIT 1",
      )
      .get()
    if ((this.relay.send || managed) && !this.scheduler && !this.stopped)
      this.scheduler = startPolling(
        Effect.tryPromise(() => this.flush()),
        {
          interval: 3000,
          immediate: true,
          onError: () => {
            this.error = 'Could not process push notifications'
          },
        },
      )
  }
  async dispose() {
    this.stopped = true
    await this.scheduler?.stop()
    await this.pending
  }
}
