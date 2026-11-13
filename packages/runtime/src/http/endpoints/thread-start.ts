import { createHash, randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import {
  decode,
  mutableStruct,
  SCRATCH_PROJECT_ID,
  taskMetadataSchema,
  type Bot,
  type Task,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError, runtimeOperation } from '../../errors.js'
import { serviceResult } from '../support/effect.js'

const bootstrapSchema = mutableStruct({ messageId: Schema.String, fingerprint: Schema.String })

/** Key order is not part of a task's identity; clients may encode the same draft differently. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}
const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
const reject = (message: string) => new HttpError(409, message, { mutationRejected: true })

/** Create the unsent draft carried by a thread's first message, once.
 *
 * The bootstrap record commits in the same transaction as the task. A retry after a lost
 * response or a restart may continue only with the same message and draft. It can never
 * replace another draft, and a deleted thread stays deleted. */
export function startThreadEffect(
  s: Services,
  input: {
    messageId: string
    createTask: Task
    /** Bot identity committed with the thread. It is part of the request identity. */
    bot?: Pick<Bot, 'role' | 'responsibilities'>
    /** Runs inside the creating transaction, also on an idempotent replay. Throwing rolls
     * the new thread back. */
    commit?: () => void
  },
) {
  const task = input.createTask
  const key = `task-bootstrap:${task.id}`
  const identity = {
    messageId: input.messageId,
    fingerprint: fingerprint(input.bot ? { task, bot: input.bot } : task),
  }
  return Effect.gen(function* () {
    // Filesystem preparation is idempotent and must stay outside SQLite transactions.
    if (task.repositoryId === SCRATCH_PROJECT_ID && !s.store.wasTaskDeleted(task.id))
      yield* serviceResult(s.scratch.ensure())
    yield* runtimeOperation(() =>
      s.store.transaction(() => {
        if (s.store.wasTaskDeleted(task.id))
          throw reject('This thread was deleted. Start a new thread.')
        const row = s.db.prepare('SELECT value FROM documents WHERE id=?').get(key)
        const saved =
          row && typeof row === 'object' && 'value' in row && typeof row.value === 'string'
            ? decode(bootstrapSchema, JSON.parse(row.value))
            : undefined
        if (s.store.get().tasks.some((item) => item.id === task.id)) {
          if (saved?.messageId === identity.messageId && saved.fingerprint === identity.fingerprint)
            return input.commit?.()
          throw reject(
            saved?.messageId === identity.messageId
              ? 'This thread already started with a different draft. It has been preserved.'
              : 'This thread already exists. Its current draft has been preserved.',
          )
        }
        s.tasks.requireCheckoutReferencesAvailable(decode(taskMetadataSchema, task))
        const now = new Date().toISOString()
        const bot: Bot | undefined = input.bot && {
          ...input.bot,
          state: 'active',
          revision: randomUUID(),
          createdAt: now,
          updatedAt: now,
        }
        // A Bot is created with its identity in the same write, so it is never shared.
        const { reconciled } = s.store.patch(
          { collection: 'tasks', id: task.id, create: task, changes: {} },
          { bot },
        )
        if (reconciled) throw reject('This thread could not be created. Start a new thread.')
        s.db
          .prepare('INSERT OR REPLACE INTO documents (id,value) VALUES (?,?)')
          .run(key, JSON.stringify(identity))
        input.commit?.()
      }),
    )
  })
}

/** A snapshot of this runtime instance at the returned revision or later includes the thread
 * and its message, unless the thread was deleted later. Receipt replays report the current
 * cursor, so a client can also settle a thread deleted after a lost acknowledgement. */
export function threadStartAcknowledgement<A extends object>(s: Services, result: A) {
  return { ...result, revision: s.store.version(), runtimeInstanceId: s.instanceId }
}
/** Receipts store the original acknowledgement. Report the current cursor on replay. */
export function threadStartReplay(s: Services, value: unknown) {
  return value !== null &&
    typeof value === 'object' &&
    'runtimeInstanceId' in value &&
    typeof value.runtimeInstanceId === 'string'
    ? threadStartAcknowledgement(s, value)
    : value
}
