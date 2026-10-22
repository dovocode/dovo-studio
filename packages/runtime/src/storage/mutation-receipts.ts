import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  decode,
  mutableStruct,
  safeValidationMessage,
  safeValidationIssues,
  ValidationError,
  type WorkspacePatchResult,
  workspacePatchResultSchema,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError, errorMessage } from '../errors.js'
const receiptSchema = mutableStruct({
  fingerprint: Schema.String,
  result: Schema.NullOr(Schema.String),
})
const outcomeSchema = Schema.Union([
  mutableStruct({ retired: Schema.Literal(true) }),
  mutableStruct({
    ok: Schema.Literal(true),
    value: Schema.Unknown,
    workspace: Schema.optional(Schema.Literal(true)),
  }),
  mutableStruct({
    ok: Schema.Literal(false),
    status: Schema.Number,
    error: Schema.String,
    mutationRejected: Schema.optional(Schema.Literal(true)),
  }),
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
      for (const id of new Set(ids))
        if (!this.pending.has(JSON.stringify([deviceId, id]))) {
          const row = this.db
            .prepare('SELECT fingerprint,result FROM mutation_receipts WHERE device_id=? AND id=?')
            .get(deviceId, id)
          if (row) {
            const receipt = decode(receiptSchema, row)
            if (receipt.result) {
              const outcome = decode(outcomeSchema, JSON.parse(receipt.result))
              // Workspace outcomes are already small. Keep them so restored journals
              // receive their original resolution instead of asking for manual discard.
              if ('retired' in outcome || ('workspace' in outcome && outcome.workspace)) continue
            }
          }
          retire.run(JSON.stringify({ retired: true }), deviceId, id)
        }
    })()
  }
  /** The caller encloses this synchronous operation in WorkspaceStore.transaction,
   * including the live snapshot rollback. No workspace commit can outlive its receipt. */
  executeWorkspace(
    deviceId: string,
    id: string,
    request: unknown,
    run: () => WorkspacePatchResult,
    settle: (
      reason: 'acknowledged' | 'interrupted' | 'rejected',
      error?: string,
    ) => WorkspacePatchResult,
  ): WorkspacePatchResult {
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT fingerprint,result FROM mutation_receipts WHERE device_id=? AND id=?')
        .get(deviceId, id)
      if (row) {
        const previous = decode(receiptSchema, row)
        if (previous.fingerprint !== fingerprint)
          throw new HttpError(409, 'This action ID already belongs to another request.')
        if (previous.result !== null) {
          const result = decode(outcomeSchema, JSON.parse(previous.result))
          if ('retired' in result) return settle('acknowledged')
          if (result.ok) return decode(workspacePatchResultSchema, result.value)
          if (![400, 403, 404, 409, 422].includes(result.status))
            throw new HttpError(result.status, result.error)
        }
        // An older runtime could commit an edit without its receipt. Its current
        // value wins that uncertainty; preserve the intent without executing it again.
      } else
        this.db
          .prepare('INSERT INTO mutation_receipts VALUES (?,?,?,NULL)')
          .run(deviceId, id, fingerprint)
      let value: WorkspacePatchResult
      if (row) {
        const previous = decode(receiptSchema, row)
        const result =
          previous.result === null ? null : decode(outcomeSchema, JSON.parse(previous.result))
        value = settle(
          result === null ? 'interrupted' : 'rejected',
          result && 'error' in result ? result.error : undefined,
        )
      } else {
        try {
          value = run()
        } catch (error) {
          const status =
            error instanceof HttpError ? error.status : error instanceof ValidationError ? 400 : 500
          if (![400, 403, 404, 409, 422].includes(status)) throw error
          value = settle(
            'rejected',
            error instanceof ValidationError ? safeValidationMessage(error) : errorMessage(error),
          )
        }
      }
      this.db
        .prepare('UPDATE mutation_receipts SET result=? WHERE device_id=? AND id=?')
        .run(JSON.stringify({ ok: true, workspace: true, value }), deviceId, id)
      return value
    })()
  }
  async execute(
    deviceId: string,
    id: string,
    request: unknown,
    run: () => Promise<unknown>,
    safelyRepeat = false,
    retryRejected = false,
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
          throw new HttpError(409, 'This action was already acknowledged; it was not repeated.', {
            mutationRetired: true,
          })
        if (!result.ok && !retryRejected)
          throw new HttpError(result.status, result.error, {
            mutationRejected: result.mutationRejected,
          })
        if (result.ok) return result.value
        // Only coordinators whose destination has its own stable receipt opt in.
        this.db
          .prepare('UPDATE mutation_receipts SET result=NULL WHERE device_id=? AND id=?')
          .run(deviceId, id)
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
          // Preserve explicit pre-commit rejections through receipt recovery. Workspace
          // patches also validate the full edit before committing. Receipt conflicts and
          // interrupted/unknown outcomes must keep their uncertainty.
          const mutationRejected =
            (error instanceof HttpError && error.mutationRejected === true) ||
            ([400, 403, 404, 409, 422].includes(status) &&
              typeof request === 'object' &&
              request !== null &&
              'path' in request &&
              request.path === '/api/workspace' &&
              'method' in request &&
              request.method === 'PATCH')
          if (status >= 500) this.failed.add(key)
          if (status < 500)
            this.db.prepare('UPDATE mutation_receipts SET result=? WHERE device_id=? AND id=?').run(
              JSON.stringify({
                ok: false,
                status,
                ...(mutationRejected ? { mutationRejected: true } : {}),
                error:
                  error instanceof ValidationError
                    ? safeValidationMessage(error)
                    : errorMessage(error),
              }),
              deviceId,
              id,
            )
          if (mutationRejected)
            throw new HttpError(
              status,
              error instanceof ValidationError ? safeValidationMessage(error) : errorMessage(error),
              {
                mutationRejected: true,
                ...(error instanceof ValidationError
                  ? { issues: safeValidationIssues(error) }
                  : {}),
              },
            )
          throw error
        },
      )
      .finally(() => this.pending.delete(key))
    this.pending.set(key, pending)
    return pending
  }
  uncertainCount(deviceId: string) {
    const rows = decode(
      Schema.Array(mutableStruct({ id: Schema.String })),
      this.db
        .prepare('SELECT id FROM mutation_receipts WHERE device_id=? AND result IS NULL')
        .all(deviceId),
    )
    return rows.filter(({ id }) => !this.pending.has(JSON.stringify([deviceId, id]))).length
  }
  revoke(deviceId: string) {
    this.db.prepare('DELETE FROM mutation_receipts WHERE device_id=?').run(deviceId)
    for (const key of this.failed) {
      if (JSON.parse(key)[0] === deviceId) this.failed.delete(key)
    }
  }
}
