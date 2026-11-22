import { routeProgram, serviceResult } from '../support/effect.js'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode, automationDryRunRequestSchema } from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
import { newSecret, hashSecret } from '../../auth/devices.js'
import { dryRunAutomation } from '../../jobs/dry-run.js'
import { isDeepStrictEqual } from 'node:util'
import { automationSchema, restorableAutomation } from '@dovo/protocol'
import { runtimeAutomationIssues } from '../../jobs/validation.js'
import { recordRoutineChange } from '../../jobs/routine-provenance.js'
import { routineChangeSource, type RoutineActor } from '../../jobs/routine-provenance.js'
import { routineChanges } from '../../jobs/routine-provenance.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
/** A flow plus a sample payload as large as a webhook body. */
const DRY_RUN_BODY_LIMIT = 1024 * 1024
export function jobsRoute(
  request: IncomingMessage,
  path: string,
  owner: () => void,
  actor: RoutineActor,
) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (method === 'POST' && path === '/api/jobs/definition') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        const saved = s.jobs.detail(id)
        const current = s.store.get().automations.find((flow) => flow.id === saved.automationId)
        if (!current) throw new HttpError(404, 'Automation no longer exists')
        return { definition: restorableAutomation(saved.flow, current), expected: current }
      }
      if (method === 'POST' && path === '/api/jobs/restore') {
        const input = decode(
          mutableStruct({ id: idSchema, expected: automationSchema, definition: automationSchema }),
          yield* serviceResult(body(request, DRY_RUN_BODY_LIMIT)),
        )
        const saved = s.jobs.detail(input.id)
        const current = s.store.get().automations.find((flow) => flow.id === saved.automationId)
        if (!current) throw new HttpError(404, 'Automation no longer exists')
        if (!isDeepStrictEqual(current, input.expected))
          throw new HttpError(
            409,
            'Automation changed. Keep your draft and compare it with the current definition before saving.',
          )
        if (input.definition.id !== current.id)
          throw new HttpError(400, 'Restore must keep the automation ID')
        const restored = restorableAutomation(input.definition, current)
        const issues = runtimeAutomationIssues(restored, s.store.get())
        if (issues.length) throw new HttpError(400, issues.join('\n'))
        s.store.transaction(() => {
          s.store.update((workspace) => ({
            ...workspace,
            automations: workspace.automations.map((flow) =>
              flow.id === current.id ? restored : flow,
            ),
          }))
          recordRoutineChange(s.db, current, restored, routineChangeSource(s.store, actor))
        })
        return restored
      }
      if (method === 'POST' && path === '/api/jobs/audit') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            offset: Schema.optional(
              maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isInt())), 0), 1000000),
            ),
            output: Schema.optional(Schema.Boolean),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(s.jobs.audit(input.id, input.offset, input.output))
      }
      if (method === 'POST' && path === '/api/jobs/provenance') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        return { automationId: id, changes: routineChanges(s.db, s.store, id) }
      }
      if (method === 'POST' && path === '/api/jobs/delete') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        s.jobs.remove(id)
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path === '/api/jobs/run') {
        const { id, requestId } = decode(
          mutableStruct({
            id: idSchema,
            requestId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          id: s.jobs.startManual(id, requestId),
        })
      }
      if (method === 'POST' && path === '/api/jobs/dry-run') {
        // Evaluation only: no run, delivery, thread, schedule cursor or notification is written.
        const input = decode(
          automationDryRunRequestSchema,
          yield* serviceResult(body(request, DRY_RUN_BODY_LIMIT)),
        )
        let webhookBlocked: string | undefined
        try {
          s.policy.require('webhookTasks')
        } catch (error) {
          if (!(error instanceof HttpError)) throw error
          webhookBlocked = error.message
        }
        return yield* serviceResult(
          dryRunAutomation(input, { workspace: s.store.get(), webhookBlocked }),
        )
      }
      if (method === 'POST' && path === '/api/jobs/retry') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          id: s.jobs.retry(id),
        })
      }
      if (method === 'POST' && path === '/api/jobs/review') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            allow: Schema.Boolean,
            nodeId: Schema.optional(Schema.String),
            attempt: Schema.optional(Schema.Number),
          }),
          yield* serviceResult(body(request)),
        )
        s.jobs.approve(input.id, input.allow, input)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/jobs/cancel') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        yield* serviceResult(s.jobs.cancel(id))
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/jobs/webhook-secret') {
        s.policy.require('webhookTasks')
        owner()
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        if (!s.store.get().automations.some((f) => f.id === id))
          throw new HttpError(404, 'Automation not found')
        const secret = newSecret()
        s.db
          .prepare(
            'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
          )
          .run(`webhook:${id}`, hashSecret(secret))
        return yield* serviceResult({
          secret,
          path: `/api/webhooks/${encodeURIComponent(id)}`,
        })
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
