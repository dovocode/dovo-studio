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
import { createHash } from 'node:crypto'
import { automationSchema, restorableAutomation } from '@dovo/protocol'
import {
  botPaused,
  botPausedMessage,
  routineSourceQuote,
  routineSuggestionAutomation,
  routineSuggestionSaveSchema,
} from '@dovo/protocol'
import { dryRunScenariosCommandSchema } from '@dovo/protocol'
import { automationRunSubjectSchema } from '@dovo/protocol'
import { defaultTaskHarness, SCRATCH_PROJECT_ID, type Task } from '@dovo/protocol'
import { runtimeAutomationIssues } from '../../jobs/validation.js'
import { recordRoutineChange } from '../../jobs/routine-provenance.js'
import {
  isOwnerMessage,
  routineChangeSource,
  type RoutineActor,
} from '../../jobs/routine-provenance.js'
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
      if (method === 'POST' && path === '/api/jobs/explain') {
        if (actor.kind !== 'person')
          throw new HttpError(403, 'Open diagnosis drafts from a paired client.')
        const { id, attempt, taskId } = decode(
          mutableStruct({
            id: idSchema,
            attempt: Schema.Int.check(Schema.isGreaterThan(0)),
            taskId: idSchema,
          }),
          yield* serviceResult(body(request, 4096)),
        )
        const origin = `explain-automation:${JSON.stringify([id, attempt])}`
        return s.store.transaction(() => {
          const previous = s.store.get().tasks.find((task) => task.id === taskId)
          if (previous?.origin === origin) return { taskId }
          if (previous || s.store.wasTaskDeleted(taskId))
            throw new HttpError(409, 'This thread ID is no longer available.')
          const { title, text } = s.jobs.explain(id, attempt)
          const defaults = s.store.taskDefaults(SCRATCH_PROJECT_ID)
          const task: Task = {
            id: taskId,
            origin,
            title,
            repositoryId: SCRATCH_PROJECT_ID,
            agentId: '',
            harness: {
              ...(defaults.harness ?? defaultTaskHarness('codex')),
              permission: 'read-only',
            },
            execution: 'main',
            status: 'draft',
            createdAt: new Date().toISOString(),
            draft: text,
            messages: [],
            files: [],
            example: false,
          }
          s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, task] }))
          return { taskId }
        })
      }
      if (method === 'POST' && path === '/api/jobs/scenarios') {
        if (actor.kind !== 'person')
          throw new HttpError(403, 'Manage Dry run scenarios from a paired client.')
        const command = decode(
          dryRunScenariosCommandSchema,
          yield* serviceResult(body(request, 131_072)),
        )
        return s.jobs.scenarios(command)
      }
      if (method === 'POST' && path === '/api/jobs/from-message') {
        if (actor.kind !== 'person')
          throw new HttpError(403, 'Save routine suggestions from a paired client.')
        const input = decode(
          routineSuggestionSaveSchema,
          yield* serviceResult(body(request, 65_536)),
        )
        const key = `routine-from-message:${input.id}`
        const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
        return s.store.transaction(() => {
          const previous = s.db.prepare('SELECT value FROM documents WHERE id=?').pluck().get(key)
          const workspace = s.store.get()
          const existing = workspace.automations.some((flow) => flow.id === input.id)
          if (previous === fingerprint) {
            if (!existing) throw new HttpError(410, 'This routine was deleted.')
            return { id: input.id }
          }
          if (previous !== undefined || existing)
            throw new HttpError(409, 'This suggestion ID belongs to another routine.')
          const bot = workspace.tasks.find(
            (task) => task.id === input.taskId && task.bot && !task.archivedAt && !task.replica,
          )
          if (!bot) throw new HttpError(404, 'This Bot is no longer available.')
          if (botPaused(bot)) throw new HttpError(409, botPausedMessage)
          const message = s.store.taskMessage(bot.id, input.messageId)
          if (!isOwnerMessage(message))
            throw new HttpError(400, 'Choose one of your own Bot messages.')
          const flow = routineSuggestionAutomation(input.id, bot.id, input.draft)
          const issue = runtimeAutomationIssues(flow, workspace)[0]
          if (issue) throw new HttpError(400, issue)
          s.store.update((workspace) => ({
            ...workspace,
            automations: [...workspace.automations, flow],
          }))
          recordRoutineChange(s.db, undefined, flow, {
            kind: 'owner',
            taskId: bot.id,
            messageId: message.id,
            ...routineSourceQuote(message.text),
            cited: true,
          })
          s.db.prepare('INSERT INTO documents VALUES (?, ?)').run(key, fingerprint)
          return { id: flow.id }
        })
      }
      if (method === 'POST' && path === '/api/jobs/detail') {
        const { id, automationId } = decode(
          mutableStruct({ id: idSchema, automationId: idSchema }),
          yield* serviceResult(body(request)),
        )
        return s.jobs.summary(id, automationId)
      }
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
        const { id, requestId, subject } = decode(
          mutableStruct({
            id: idSchema,
            requestId: Schema.optional(idSchema),
            subject: Schema.optional(automationRunSubjectSchema),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          id: s.jobs.startManual(id, requestId, subject),
        })
      }
      if (method === 'POST' && path === '/api/jobs/runs-by-subject') {
        const { subject } = decode(
          mutableStruct({ subject: automationRunSubjectSchema }),
          yield* serviceResult(body(request, 8192)),
        )
        return { runs: s.jobs.list(undefined, subject) }
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
            reason: Schema.optional(maxValue(Schema.String, 4000)),
          }),
          yield* serviceResult(body(request)),
        )
        s.jobs.approve(input.id, input.allow, {
          ...input,
          answeredBy: actor.kind === 'person' ? (actor.deviceName ?? 'Studio owner') : undefined,
        })
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
      if (method === 'POST' && (path === '/api/jobs/pause' || path === '/api/jobs/resume')) {
        if (actor.kind !== 'person')
          throw new HttpError(403, 'Use a paired client or Studio Automations to control this run.')
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        if (path === '/api/jobs/pause') s.jobs.pause(id)
        else s.jobs.resume(id)
        return yield* serviceResult({ ok: true })
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
