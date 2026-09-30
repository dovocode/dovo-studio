import type Database from 'better-sqlite3'
import { decode, mutableStruct, resolveTaskAgent, type Workspace } from '@dovo/protocol'
import { Schema, Effect } from 'effect'
import type { IncomingMessage } from 'node:http'
import { readResetCredits, consumeResetCredit } from '../../agents/tasks/reset-credits.js'
import { RuntimeServices } from '../../services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'
const attempts = new WeakMap<
  object,
  Map<string, { key: string; result?: Promise<string>; settled: boolean }>
>()
const storedAttemptSchema = mutableStruct({
  key: Schema.String,
  settled: Schema.Boolean,
  outcome: Schema.optional(Schema.String),
})
function accountAttempts(db: Database.Database, accountId: string) {
  let cache = attempts.get(db)
  if (!cache) {
    cache = new Map()
    attempts.set(db, cache)
  }
  if (!cache.has(accountId)) {
    const row = db
      .prepare('SELECT value FROM documents WHERE id = ?')
      .get(`usage-reset:${accountId}`)
    if (row) {
      const record = decode(mutableStruct({ value: Schema.String }), row)
      const stored = decode(storedAttemptSchema, JSON.parse(record.value))
      cache.set(accountId, {
        key: stored.key,
        settled: stored.settled,
        ...(stored.outcome ? { result: Promise.resolve(stored.outcome) } : {}),
      })
    }
  }
  return cache
}
function saveAttempt(db: Database.Database, accountId: string, key: string, outcome?: string) {
  db.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)').run(
    `usage-reset:${accountId}`,
    JSON.stringify({ key, settled: outcome !== undefined, ...(outcome ? { outcome } : {}) }),
  )
}
const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200))
export const usageResets = (request: IncomingMessage, path: string) =>
  Effect.gen(function* () {
    const s = yield* RuntimeServices
    const input = decode(
      mutableStruct({
        taskId: text,
        accountId: text,
        creditId: Schema.optional(text),
        idempotencyKey: Schema.optional(
          Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,64}$/)),
        ),
      }),
      yield* serviceResult(body(request)),
    )
    const task = s.store.task(input.taskId)
    const agent = resolveTaskAgent(task, s.store.get().agents)
    const account = [...(task.turns ?? [])]
      .reverse()
      .find((turn) => turn.usageAccount?.id === input.accountId)?.usageAccount
    if (!agent || !account)
      throw new HttpError(400, 'No verified provider account for this thread. Run a turn first.')
    if (path === '/api/usage/resets/read') {
      const read = yield* serviceResult(readResetCredits(agent, account))
      if (read.limits.length)
        s.store.update((workspace: Workspace) => ({
          ...workspace,
          planLimits: [
            ...(workspace.planLimits ?? []).filter(
              (previous) =>
                !(previous.provider === agent.provider && previous.account?.id === account.id),
            ),
            ...read.limits.map((limit) => ({ ...limit, account, sourceTaskId: task.id })),
          ],
        }))
      const pending = accountAttempts(s.db, account.id).get(account.id)
      return {
        ...read.credits,
        ...(pending && !pending.settled ? { pendingAttemptId: pending.key } : {}),
      }
    }
    if (!input.idempotencyKey) throw new HttpError(400, 'A reset attempt ID is required.')
    const key = input.idempotencyKey
    const byAccount = accountAttempts(s.db, account.id)
    const prior = byAccount.get(account.id)
    if (prior && !prior.settled && prior.key !== key)
      throw new HttpError(
        409,
        'A reset attempt is already recorded for this account. Refresh before starting another.',
      )
    saveAttempt(s.db, account.id, key)
    const result =
      (prior?.key === key ? prior.result : undefined) ??
      consumeResetCredit(agent, account, input.creditId, key)
    byAccount.set(account.id, { key, result, settled: false })
    const cache = byAccount
    const outcome = yield* serviceResult(result).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          // Reissue the same logical attempt after a transport failure.
          cache.set(account.id, { key, settled: false })
        }),
      ),
      Effect.tap((outcome) =>
        Effect.sync(() => {
          saveAttempt(s.db, account.id, key, outcome)
          cache.set(account.id, { key, result, settled: true })
        }),
      ),
    )
    return { outcome }
  })
