import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
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
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Devices } from '../auth/devices.js'
import { HttpError } from '../errors.js'

const record = mutableStruct({ deviceId: Schema.String, value: Schema.String })
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
const preview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 350)
export class PushNotifications {
  private scheduler?: ReturnType<typeof startPolling>
  private pending?: Promise<void>
  private stopped = false
  private nextAttempt = 0
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
      CREATE TABLE IF NOT EXISTS push_outbox (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL, attempt INTEGER NOT NULL, next INTEGER NOT NULL);`)
  }
  private registration(deviceId: string): PushRegistration | undefined {
    const row = this.db.prepare('SELECT value FROM push_devices WHERE device_id=?').get(deviceId)
    if (!row) return
    return decode(
      pushRegistrationSchema,
      JSON.parse(decode(mutableStruct({ value: Schema.String }), row).value),
    )
  }
  status(deviceId: string) {
    const registration = this.registration(deviceId)
    return {
      configured: !!this.relay.send || !!registration?.managedToken,
      registered: !!registration,
      error: this.error,
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
      this.remove(deviceId)
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
      registrations.push({
        deviceId: entry.deviceId,
        value: decode(pushRegistrationSchema, JSON.parse(entry.value)),
      })
    }
    this.db.transaction(() => {
      for (const task of this.store.get().tasks) {
        const current = this.state(task)
        const raw = this.db.prepare('SELECT value FROM push_states WHERE task_id=?').get(task.id)
        const before = raw
          ? decode(
              stateSchema,
              JSON.parse(decode(mutableStruct({ value: Schema.String }), raw).value),
            )
          : undefined
        if (raw && JSON.stringify(current) === JSON.stringify(before)) continue
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
        if (!inputs.length && before?.running && !current.running && !current.cancelled)
          kinds.push({ kind: current.failed ? 'failed' : 'done' })
        for (const { kind, input } of kinds)
          for (const registration of registrations) {
            const id = createHash('sha256')
              .update(JSON.stringify([registration.deviceId, task.id, kind, current, input?.id]))
              .digest('hex')
            const detail =
              kind === 'input'
                ? input?.preview
                : [...this.store.task(task.id).messages]
                    .reverse()
                    .find((message) => message.role === 'assistant')?.text
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
            const message: RelayNotification = {
              platform: registration.value.platform,
              token: registration.value.token,
              environment: registration.value.environment,
              id,
              title: `${task.title || 'Dovo task'} · ${label}`.slice(0, 160),
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
                project: this.store
                  .get()
                  .repositories.find((repo) => repo.id === task.repositoryId)
                  ?.name.slice(0, 200),
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
    if (Date.now() < this.nextAttempt) return
    const rows = this.db
      .prepare(
        'SELECT id,device_id AS deviceId,value,attempt FROM push_outbox WHERE next<=? ORDER BY expires LIMIT 20',
      )
      .all(Date.now())
    for (const raw of rows) {
      if (this.stopped) break
      const entry = decode(
        mutableStruct({ ...record.fields, id: Schema.String, attempt: Schema.Number }),
        raw,
      )
      if (
        entry.deviceId !== 'owner' &&
        !this.devices.list().some((device) => device.id === entry.deviceId && !device.revokedAt)
      ) {
        this.remove(entry.deviceId)
        continue
      }
      const value = decode(relayNotificationSchema, JSON.parse(entry.value))
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
          const current = this.registration(entry.deviceId)
          if (current?.token === value.token && current.managedToken === registration.managedToken)
            this.remove(entry.deviceId)
          else this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        } else if (result.delivered)
          this.db.prepare('DELETE FROM push_outbox WHERE id=?').run(entry.id)
        else throw new Error('Notification was not delivered')
        this.error = null
      } catch {
        this.error = 'Push delivery failed. Check the relay connection and provider credentials.'
        const attempt = entry.attempt + 1
        this.nextAttempt = Date.now() + Math.min(30_000 * 2 ** Math.min(attempt - 1, 5), 900_000)
        this.db
          .prepare('UPDATE push_outbox SET attempt=?,next=? WHERE id=?')
          .run(
            attempt,
            Date.now() + Math.min(30_000 * 2 ** Math.min(attempt - 1, 5), 900_000),
            entry.id,
          )
        break
      }
    }
  }
  start() {
    const managed = this.db
      .prepare(
        "SELECT device_id FROM push_devices WHERE json_extract(value,'$.managedToken') IS NOT NULL LIMIT 1",
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
