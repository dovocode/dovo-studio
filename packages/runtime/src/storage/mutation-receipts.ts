import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { decode, mutableStruct, safeValidationMessage, ValidationError } from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError, errorMessage } from '../errors.js'
const receiptSchema = mutableStruct({
  fingerprint: Schema.String,
  result: Schema.NullOr(Schema.String),
})
const outcomeSchema = Schema.Union([
  mutableStruct({ retired: Schema.Literal(true) }),
  mutableStruct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  mutableStruct({ ok: Schema.Literal(false), status: Schema.Number, error: Schema.String }),
])
/** Persist responses rather than replaying side effects when an acknowledgement is lost.
 * An interrupted in-flight action is uncertain after restart and must never run blindly. */
export class MutationReceipts {
  private pending = new Map<string, Promise<unknown>>()
  private failed = new Set<string>()
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS mutation_receipts (device_id TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT, PRIMARY KEY(device_id,id))',
    )
  }
  /** Retain compact identities forever so an old journal cannot repeat acknowledged effects. */
  acknowledge(deviceId: string, ids: readonly string[]) {
    const retire = this.db.prepare(
      'UPDATE mutation_receipts SET result=? WHERE device_id=? AND id=? AND result IS NOT NULL',
    )
    this.db.transaction(() => {
      for (const id of ids)
        if (!this.pending.has(JSON.stringify([deviceId, id])))
          retire.run(JSON.stringify({ retired: true }), deviceId, id)
    })()
  }
  async execute(
    deviceId: string,
    id: string,
    request: unknown,
    run: () => Promise<unknown>,
    safelyRepeat = false,
  ): Promise<unknown> {
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const key = JSON.stringify([deviceId, id])
    const row = this.db
      .prepare('SELECT fingerprint,result FROM mutation_receipts WHERE device_id=? AND id=?')
      .get(deviceId, id)
    if (row) {
      const previous = decode(receiptSchema, row)
      if (previous.fingerprint !== fingerprint)
        throw new HttpError(409, 'This action ID already belongs to another request.')
      const pending = this.pending.get(key)
      if (pending) return pending
      if (previous.result !== null) {
        const result = decode(outcomeSchema, JSON.parse(previous.result))
        if ('retired' in result)
          throw new HttpError(
            409,
            'This action was already acknowledged. Discard the stale saved action; it was not repeated.',
          )
        if (!result.ok) throw new HttpError(result.status, result.error)
        return result.value
      }
      if (!safelyRepeat)
        throw new HttpError(
          409,
          this.failed.has(key)
            ? 'The previous attempt failed on the runtime and may have partially applied. Check its current state and discard the saved action before trying again.'
            : 'The runtime restarted while applying this action. Check its current state and discard the saved action before trying again.',
        )
    } else
      this.db
        .prepare('INSERT INTO mutation_receipts VALUES (?,?,?,NULL)')
        .run(deviceId, id, fingerprint)
    const pending = Promise.resolve()
      .then(run)
      .then(
        (value) => {
          this.failed.delete(key)
          this.db
            .prepare('UPDATE mutation_receipts SET result=? WHERE device_id=? AND id=?')
            .run(JSON.stringify({ ok: true, value }), deviceId, id)
          return value
        },
        (error: unknown) => {
          // A gateway/runtime failure may be transient. Preserve uncertainty rather than recording a false rejection.
          const status =
            error instanceof HttpError ? error.status : error instanceof ValidationError ? 400 : 500
          if (status >= 500) this.failed.add(key)
          if (status < 500)
            this.db.prepare('UPDATE mutation_receipts SET result=? WHERE device_id=? AND id=?').run(
              JSON.stringify({
                ok: false,
                status,
                error:
                  error instanceof ValidationError
                    ? safeValidationMessage(error)
                    : errorMessage(error),
              }),
              deviceId,
              id,
            )
          throw error
        },
      )
      .finally(() => this.pending.delete(key))
    this.pending.set(key, pending)
    return pending
  }
  revoke(deviceId: string) {
    this.db.prepare('DELETE FROM mutation_receipts WHERE device_id=?').run(deviceId)
    for (const key of this.failed) {
      if (JSON.parse(key)[0] === deviceId) this.failed.delete(key)
    }
  }
}
