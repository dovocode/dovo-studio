import { runtimeOperation } from '../../errors.js'
import { linkedCheckoutsSchema } from '@dovo/protocol'
import { settingsScopeSchema, settingsScopes, scopedAgentEntries } from '@dovo/protocol'
import { scopedSettingsRoute } from './scoped-settings-routes.js'
import { decodeResult } from '@dovo/protocol'
import { checkAdapterUpdates } from '../../agents/execution/diagnostics.js'
import { modelPreferencesSchema, agentPresetSchema, mutableArray } from '@dovo/protocol'
import { canChangeTaskCheckout, taskSchema } from '@dovo/protocol'
import { isDeepStrictEqual } from 'node:util'
import { runtimeDefaultsSchema } from '@dovo/protocol'
import { acpRoute } from './acp-routes.js'
import { handoffTask } from '../../scm/tasks/task-handoff.js'
import { uncommittedChanges } from '../../scm/work/change-summary.js'
import { routeProgram, serviceResult } from '../support/effect.js'
import { runtimeSetupSchema, titleGenerationSettingsSchema } from '@dovo/protocol'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { repositoryPath, safeFile } from '../../scm/repositories/paths.js'
import { searchRegistry } from '../../agents/catalogs/registry.js'
import { ModelCatalogCache } from '../../agents/catalogs/model-cache.js'
import { searchSkills, installCatalogSkill } from '../../agents/catalogs/skills.js'
import { importSkill, testMcpServer } from '../../agents/configuration/resources.js'
import { attachmentIdsSchema } from '@dovo/protocol'
import {
  agentDiscoverySchema,
  modelDiscoveryInput,
  modelCatalogSchema,
  questionReplySchema,
} from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { RuntimeServices } from '../../services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
const modelCaches = new WeakMap<object, ModelCatalogCache>()
export function agentsRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const publicDefaults = (value: unknown) =>
        decode(runtimeDefaultsSchema, s.store.publicValue(value))
      const method = request.method
      if (
        method === 'POST' &&
        [
          '/api/agents/settings/read',
          '/api/agents/settings/save',
          '/api/agents/settings/sync',
        ].includes(path)
      )
        return yield* scopedSettingsRoute(request, path)
      if (method === 'POST' && path === '/api/agents/updates') {
        const { checkUpdates } = decode(
          mutableStruct({ checkUpdates: Schema.Boolean }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(
          checkAdapterUpdates(s.commands.get(), {
            checkUpdates,
            agents: s.store.get().agents.map((agent) => s.agents.configure(agent)),
          }),
        )
      }
      if (method === 'POST' && path === '/api/agents/presets/apply') {
        const { presets, retired, modelPreferences, modelPreferencesUpdatedAt } = decode(
          mutableStruct({
            presets: mutableArray(agentPresetSchema),
            retired: Schema.optional(mutableArray(idSchema)),
            modelPreferences: Schema.optional(modelPreferencesSchema),
            modelPreferencesUpdatedAt: Schema.optional(Schema.Number),
          }),
          yield* serviceResult(body(request)),
        )
        s.store.update((workspace) => {
          const agents = workspace.agents.map((agent) =>
            retired?.includes(agent.id)
              ? { ...agent, globalPreset: undefined, serverOverride: undefined }
              : agent,
          )
          for (const preset of presets) {
            const index = agents.findIndex((agent) => agent.id === preset.id)
            const current = agents[index]
            const next = current?.serverOverride
              ? { ...current, globalPreset: preset }
              : { ...preset, globalPreset: preset, serverOverride: false }
            if (index === -1) agents.push(next)
            else agents[index] = next
          }
          return { ...workspace, agents }
        })
        if (
          modelPreferences &&
          modelPreferencesUpdatedAt !== undefined &&
          modelPreferencesUpdatedAt > (s.defaults.get().globalModelPreferencesUpdatedAt ?? 0)
        ) {
          const current = s.defaults.get()
          const overrides = current.modelPreferenceOverrides ?? current.modelPreferences ?? {}
          s.defaults.save(
            {
              ...current,
              globalModelPreferencesUpdatedAt: modelPreferencesUpdatedAt,
              globalModelPreferences: modelPreferences,
              modelPreferenceOverrides: overrides,
              modelPreferences: { ...modelPreferences, ...overrides },
            },
            false,
          )
        }
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path === '/api/agents/presets/reset') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        s.store.update((workspace) => ({
          ...workspace,
          agents: workspace.agents.map((agent) =>
            agent.id === id && agent.globalPreset
              ? { ...agent.globalPreset, globalPreset: agent.globalPreset, serverOverride: false }
              : agent,
          ),
        }))
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path === '/api/agents/remove') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        if (s.titles.read().agentId === id)
          throw new HttpError(
            409,
            'Choose another configuration for titles and dictation before deleting this one',
          )
        s.store.removeAgent(id)
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path === '/api/agents/models/reset') {
        const current = s.defaults.get()
        return yield* serviceResult(
          publicDefaults(
            s.defaults.save(
              {
                ...current,
                modelPreferenceOverrides: {},
                modelPreferences: current.globalModelPreferences ?? {},
              },
              false,
            ),
          ),
        )
      }
      if (method === 'POST' && path === '/api/agents/models/preference') {
        const input = decode(
          mutableStruct({
            key: maxValue(minValue(Schema.String, 1), 1000),
            favorite: Schema.optional(Schema.Boolean),
            disabled: Schema.optional(Schema.Boolean),
            inherit: Schema.optional(Schema.Boolean),
          }),
          yield* serviceResult(body(request)),
        )
        const current = s.defaults.get()
        const preferences = current.modelPreferences ?? {}
        const overrides = { ...(current.modelPreferenceOverrides ?? preferences) }
        if (input.inherit) delete overrides[input.key]
        else
          overrides[input.key] = {
            favorite: input.favorite ?? preferences[input.key]?.favorite ?? false,
            disabled: input.disabled ?? preferences[input.key]?.disabled ?? false,
          }
        return yield* serviceResult(
          publicDefaults(
            s.defaults.save(
              {
                ...current,
                modelPreferenceOverrides: overrides,
                modelPreferences: { ...current.globalModelPreferences, ...overrides },
              },
              false,
            ),
          ),
        )
      }
      if (path.startsWith('/api/agents/acp/')) return yield* acpRoute(request, path)
      if (method === 'POST' && path === '/api/agents/catalogs/mcp')
        return yield* serviceResult(searchRegistry(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/agents/catalogs/skills')
        return yield* serviceResult(searchSkills(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/agents/catalogs/skills/import')
        return yield* serviceResult(
          installCatalogSkill(
            yield* serviceResult(body(request)),
            s.db.name === ':memory:'
              ? join(tmpdir(), 'dovo-catalog-skills')
              : join(dirname(resolve(s.db.name)), 'skills'),
          ),
        )
      if (method === 'POST' && path === '/api/agents/skills/import')
        return yield* serviceResult(importSkill(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/agents/mcp/test')
        return yield* serviceResult(
          testMcpServer(s.store.restoreSecrets(yield* serviceResult(body(request)))),
        )
      if (method === 'POST' && path === '/api/agents/setup/read')
        return yield* serviceResult({
          defaults: publicDefaults(s.defaults.get()),
          titles: s.titles.read(),
        })
      if (method === 'POST' && path === '/api/agents/defaults/save') {
        const input = decode(
          mutableStruct({ before: runtimeDefaultsSchema, after: runtimeDefaultsSchema }),
          s.store.restoreSecrets(yield* serviceResult(body(request))),
        )
        const current = s.defaults.get()
        if (isDeepStrictEqual(current, { ...input.after, configured: true }))
          return yield* serviceResult(s.store.publicValue(current))
        if (!isDeepStrictEqual(current, input.before))
          throw new HttpError(
            409,
            'Runtime defaults changed on another device. Reload settings before saving.',
          )
        if (input.after.harness.acpInstallationId) s.agents.launch(input.after.harness)
        return yield* serviceResult(publicDefaults(s.defaults.save(input.after)))
      }
      if (method === 'POST' && path === '/api/agents/setup/save') {
        const raw = s.store.restoreSecrets(yield* serviceResult(body(request)))
        const checked = raw !== null && typeof raw === 'object' && 'before' in raw && 'after' in raw
        const input = decode(runtimeSetupSchema, checked ? raw.after : raw)
        if (checked) {
          const before = decode(runtimeSetupSchema, raw.before)
          const current = { defaults: s.defaults.get(), titles: s.titles.read() }
          const after = { ...input, defaults: { ...input.defaults, configured: true } }
          if (isDeepStrictEqual(current, after))
            return yield* serviceResult(s.store.publicValue(current))
          if (!isDeepStrictEqual(current, before))
            throw new HttpError(409, 'Agent setup changed on another device. Reload before saving.')
        }
        if (input.defaults.harness.acpInstallationId) s.agents.launch(input.defaults.harness)
        return yield* serviceResult(
          s.db.transaction(() => ({
            defaults: publicDefaults(s.defaults.save(input.defaults)),
            titles: s.titles.save(input.titles),
          }))(),
        )
      }
      if (method === 'POST' && path === '/api/agents/title-settings/read')
        return yield* serviceResult(s.titles.read())
      if (method === 'POST' && path === '/api/agents/title-settings/save') {
        const raw = yield* serviceResult(body(request))
        const checked = raw !== null && typeof raw === 'object' && 'before' in raw && 'after' in raw
        if (checked) {
          const before = decode(titleGenerationSettingsSchema, raw.before)
          const after = decode(titleGenerationSettingsSchema, raw.after)
          const current = s.titles.read()
          if (isDeepStrictEqual(current, after))
            return yield* serviceResult(s.store.publicValue(current))
          if (!isDeepStrictEqual(current, before))
            throw new HttpError(
              409,
              'Title settings changed on another device. Reload before saving.',
            )
          return yield* serviceResult(s.titles.save(after))
        }
        return yield* serviceResult(s.titles.save(raw))
      }
      if (method === 'POST' && path === '/api/tasks/draft-receive') {
        const input = decode(
          mutableStruct({ task: taskSchema, gitIdentity: Schema.String }),
          yield* serviceResult(body(request)),
        )
        const repo = s.store.get().repositories.find((repo) => repo.id === input.task.repositoryId)
        if (
          !repo ||
          !input.gitIdentity ||
          (yield* serviceResult(s.git.repositoryIdentity(repo.path, true))) !== input.gitIdentity
        )
          throw new HttpError(
            409,
            'The destination no longer has the same Git repository. Refresh projects and try again.',
          )
        if (
          !canChangeTaskCheckout(input.task) ||
          input.task.draftAttachments?.length ||
          input.task.workItem ||
          input.task.archivedAt ||
          input.task.worktreeSetupComplete !== undefined
        )
          throw new HttpError(400, 'Only unsent drafts can change machines')
        const existing = s.store.get().tasks.find((task) => task.id === input.task.id)
        if (existing) {
          if (!canChangeTaskCheckout(existing))
            throw new HttpError(409, 'This task already started on the destination machine')
          if (!existing.archivedAt) {
            if (
              existing.draft !== input.task.draft ||
              existing.repositoryId !== input.task.repositoryId
            )
              throw new HttpError(
                409,
                'The destination already has a different draft. It has been preserved.',
              )
            return yield* serviceResult(existing)
          }
          s.store.updateTask(existing.id, () => input.task)
        } else
          s.store.patch({ collection: 'tasks', id: input.task.id, create: input.task, changes: {} })
        return yield* serviceResult(s.store.task(input.task.id))
      }
      if (method === 'POST' && path === '/api/tasks/draft-moved') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            draft: Schema.String,
            repositoryId: idSchema,
            gitIdentity: Schema.String,
          }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(input.id)
        const repo = s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
        if (
          !repo ||
          !input.gitIdentity ||
          (yield* serviceResult(s.git.repositoryIdentity(repo.path, true))) !== input.gitIdentity
        )
          throw new HttpError(
            409,
            'The source Git repository changed. Both drafts have been preserved.',
          )
        if (
          task.draft !== input.draft ||
          task.repositoryId !== input.repositoryId ||
          !!task.draftAttachments?.length ||
          !canChangeTaskCheckout(task)
        )
          throw new HttpError(
            409,
            'The source draft changed or started. It has been preserved; the destination is still an unsent draft.',
          )
        s.store.updateTask(task.id, (current) => ({
          ...current,
          archivedAt: current.archivedAt ?? new Date().toISOString(),
        }))
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path === '/api/tasks/lifecycle') {
        const { id, action } = decode(
          mutableStruct({
            id: idSchema,
            action: Schema.Literal('archive', 'restore', 'delete'),
          }).annotations({
            parseOptions: {
              onExcessProperty: 'error',
            },
          }),
          yield* serviceResult(body(request)),
        )
        // Missing deletes are successful retries after a lost response.
        if (action === 'delete' && !s.store.get().tasks.some((task) => task.id === id))
          return yield* serviceResult({
            ok: true,
          })
        s.tasks.requireIdle(id)
        s.jobs.requireTaskIdle(id)
        if (action !== 'restore') {
          if (s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited))
            throw new HttpError(
              409,
              'Close this thread’s terminals before archiving or deleting it.',
            )
          yield* serviceResult(s.browsers.closeTask(id))
          yield* serviceResult(s.simulators.closeTask(id))
          s.tasks.requireIdle(id)
          s.jobs.requireTaskIdle(id)
        }
        if (action !== 'restore') s.titles.cancelSideChats(id)
        if (action === 'delete') {
          s.db.transaction(() => {
            s.db.prepare('DELETE FROM activity WHERE scope = ?').run(id)
            s.db.prepare('DELETE FROM attachments WHERE task = ?').run(id)
            s.store.update((workspace) => ({
              ...workspace,
              tasks: workspace.tasks.filter((task) => task.id !== id),
            }))
          })()
        } else {
          s.store.updateTask(id, (task) => ({
            ...task,
            archived: action === 'archive',
            archivedAt:
              action === 'archive' ? (task.archivedAt ?? new Date().toISOString()) : undefined,
            snoozedUntil: null,
          }))
        }
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/viewed') {
        const { id, turnId, viewed, expectedRevision } = decode(
          mutableStruct({
            id: idSchema,
            turnId: idSchema,
            viewed: Schema.optionalWith(Schema.Boolean, {
              default: () => true,
            }),
            expectedRevision: Schema.Number.pipe(Schema.finite())
              .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
              .pipe(Schema.nonNegative()),
          }).annotations({
            parseOptions: {
              onExcessProperty: 'error',
            },
          }),
          yield* serviceResult(body(request)),
        )
        s.store.markTaskViewed(id, turnId, expectedRevision, viewed)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/title') {
        const input = yield* serviceResult(body(request))
        const taskInput = decodeResult(mutableStruct({ taskId: idSchema }), input)
        const value = taskInput.success
          ? {
              text:
                s.store
                  .task(taskInput.data.taskId)
                  .messages.find((message) => message.role === 'user')?.text ?? '',
            }
          : input
        return yield* s.titles.generateEffect(value)
      }
      if (method === 'POST' && path === '/api/tasks/side-chat/save')
        return yield* serviceResult(s.titles.saveSideChat(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/tasks/side-chat/ask')
        return yield* s.titles.askSideChatEffect(yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/tasks/aside')
        return yield* s.titles.askEffect(yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/tasks/dictation/cleanup')
        return yield* s.titles.cleanupEffect(yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/tasks/answer') {
        const input = decode(questionReplySchema, yield* serviceResult(body(request)))
        s.questions.respond(input.id, input.answers)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/agents/models') {
        const input = decode(
          mutableStruct({
            ...agentDiscoverySchema.fields,
            refresh: Schema.optional(Schema.Boolean),
          }),
          yield* serviceResult(body(request)),
        )
        const agent = modelDiscoveryInput(s.agents.configure(input))
        const adapter = yield* serviceResult(s.agents.get(agent.provider))
        const models = adapter.models
        if (!models) throw new HttpError(400, 'This integration does not advertise models')
        let cache = modelCaches.get(s.db)
        if (!cache) {
          cache = new ModelCatalogCache()
          modelCaches.set(s.db, cache)
        }
        return yield* serviceResult(
          cache.get(
            JSON.stringify([agent, s.agents.launch(agent)]),
            async () => decode(modelCatalogSchema, await models(agent)),
            input.refresh,
          ),
        )
      }
      if (method === 'POST' && path === '/api/approvals') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            allow: Schema.Boolean,
            remember: Schema.optional(Schema.Boolean),
          }),
          yield* serviceResult(body(request)),
        )
        s.approvals.respond(input.id, input.allow, input.remember)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/agents/probe') {
        const { id, repositoryId, settingsScope } = decode(
          mutableStruct({
            id: idSchema,
            repositoryId: Schema.optional(idSchema),
            settingsScope: Schema.optional(settingsScopeSchema),
          }),
          yield* serviceResult(body(request)),
        )
        const candidates = settingsScope
          ? scopedAgentEntries(
              s.defaults.get(),
              s.store.get().repositories.find((repo) => repo.id === repositoryId),
              s.store.get().agents,
              settingsScopes[settingsScopes.indexOf(settingsScope) + 1],
            ).map((entry) => entry.agent)
          : s.store.agentsFor(repositoryId)
        const agent = candidates.find((a) => a.id === id)
        if (!agent) throw new HttpError(404, 'Agent not found')
        return yield* serviceResult(
          (yield* serviceResult(s.agents.get(agent.provider))).probe(agent),
        )
      }
      if (method === 'POST' && (path === '/api/tasks/message' || path === '/api/tasks/steer')) {
        const input = decode(
          mutableStruct({
            id: idSchema,
            messageId: idSchema,
            text: maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 120000),
            attachmentIds: Schema.optionalWith(attachmentIdsSchema, {
              default: () => [],
            }),
            review: Schema.optional(Schema.Boolean),
            runId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        if (!input.text && !input.attachmentIds.length)
          throw new HttpError(400, 'Add a message or attachment')
        if (path === '/api/tasks/steer') {
          if (!input.runId)
            throw new HttpError(
              409,
              'Update Dovo or refresh this thread before steering its current run',
            )
          return yield* s.tasks.steerEffect(
            input.id,
            input.messageId,
            input.text,
            input.attachmentIds,
            input.runId,
          )
        }
        return yield* s.tasks.sendEffect(
          input.id,
          input.messageId,
          input.text,
          input.attachmentIds,
          input.review,
          true,
        )
      }
      if (method === 'POST' && path === '/api/tasks/queue') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            action: Schema.Literal(
              'edit',
              'remove',
              'restore',
              'steer',
              'up',
              'down',
              'pause',
              'resume',
            ),
            messageId: Schema.optional(idSchema),
            text: Schema.optional(maxValue(Schema.String, 120000)),
            expectedText: Schema.optional(maxValue(Schema.String, 120000)),
            runId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        if (input.action === 'edit') {
          if (!input.messageId || input.text === undefined || input.expectedText === undefined)
            throw new HttpError(
              400,
              'Choose a queued message and provide its new and original text',
            )
          s.tasks.queue.edit(input.id, input.messageId, input.text, input.expectedText)
        } else if (input.action === 'steer') {
          if (!input.runId)
            throw new HttpError(
              409,
              'Update Dovo or refresh this thread before steering its current run',
            )
          const queued = s.store
            .task(input.id)
            .queue?.find((message) => message.id === input.messageId)
          if (!queued) throw new HttpError(409, 'This message already started or was removed')
          yield* s.tasks.steerEffect(
            input.id,
            randomUUID(),
            queued.text,
            queued.attachments?.map((file) => file.id) ?? [],
            input.runId,
          )
          s.tasks.queue.change(input.id, 'remove', queued.id)
        } else if (input.action === 'resume') {
          if (!s.store.task(input.id).queue?.length)
            return yield* serviceResult({
              ok: true,
            })
          if (s.store.task(input.id).status === 'running')
            s.store.updateTask(input.id, (t) => ({
              ...t,
              queuePaused: false,
            }))
          else yield* s.tasks.startEffect(input.id)
        } else s.tasks.queue.change(input.id, input.action, input.messageId)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/feedback')
        return yield* serviceResult(s.tasks.feedback(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/tasks/schedule') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            text: Schema.optional(
              maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 20000),
            ),
            at: Schema.optional(Schema.String),
            removeId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(input.id)
        if (task.archived || task.archivedAt)
          throw new HttpError(409, 'Restore this task before scheduling a follow-up')
        if (input.removeId) {
          s.store.updateTask(input.id, (current) => ({
            ...current,
            scheduledMessages: current.scheduledMessages?.filter(
              (item) => item.id !== input.removeId,
            ),
          }))
          return { ok: true }
        }
        const when = input.at ? Date.parse(input.at) : NaN
        if (!input.text || !Number.isFinite(when) || when <= Date.now())
          throw new HttpError(400, 'Enter a message and a future time')
        if ((task.scheduledMessages?.length ?? 0) >= 50)
          throw new HttpError(409, 'Too many scheduled follow-ups')
        const scheduled = {
          id: crypto.randomUUID(),
          text: input.text,
          at: new Date(when).toISOString(),
        }
        s.store.updateTask(input.id, (current) => ({
          ...current,
          scheduledMessages: [...(current.scheduledMessages ?? []), scheduled],
        }))
        return { ok: true, id: scheduled.id }
      }
      if (method === 'POST' && path === '/api/tasks/start-after') {
        const input = decode(
          mutableStruct({ id: idSchema, sourceId: Schema.NullOr(idSchema) }),
          yield* serviceResult(body(request)),
        )
        const target = s.store.task(input.id)
        if (target.status !== 'draft' || target.turns?.length || target.archivedAt)
          throw new HttpError(409, 'Only an unsent draft can be chained')
        if (!input.sourceId) {
          s.store.updateTask(input.id, (current) => ({ ...current, startAfter: undefined }))
          return { ok: true }
        }
        if (input.sourceId === input.id)
          throw new HttpError(400, 'A task cannot start after itself')
        const source = s.store.task(input.sourceId)
        let cursor = source
        const seen = new Set([input.id])
        while (cursor.startAfter) {
          if (seen.has(cursor.id)) throw new HttpError(400, 'Task chain would form a cycle')
          seen.add(cursor.id)
          cursor = s.store.task(cursor.startAfter.taskId)
        }
        if (
          !target.messages.some((message) => message.role === 'user' && message.text.trim()) &&
          !target.draft.trim()
        )
          throw new HttpError(400, 'Write the next task’s request before chaining it')
        s.store.updateTask(input.id, (current) => ({
          ...current,
          startAfter: {
            taskId: source.id,
            messageId: crypto.randomUUID(),
            text: current.messages.some((message) => message.role === 'user' && message.text.trim())
              ? ''
              : current.draft.trim(),
          },
        }))
        return { ok: true }
      }
      if (method === 'POST' && path === '/api/tasks/message/bookmark') {
        const input = decode(
          mutableStruct({ id: idSchema, messageId: idSchema, bookmarked: Schema.Boolean }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(input.id)
        if (
          !task.messages.some(
            (message) => message.id === input.messageId && message.role === 'assistant',
          )
        )
          throw new HttpError(404, 'Reply not found')
        s.store.updateTask(input.id, (current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === input.messageId ? { ...message, bookmarked: input.bookmarked } : message,
          ),
        }))
        return { ok: true }
      }
      if (method === 'POST' && path === '/api/tasks/commit-message') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        const cwd = yield* serviceResult(s.checkouts.directory(id))
        if (
          s.store.get().repositories.find((repo) => repo.id === s.store.task(id).repositoryId)?.kind
        )
          throw new HttpError(400, 'This project does not use Git')
        const diff = yield* serviceResult(uncommittedChanges(s.git, cwd))
        if (!diff.trim()) throw new HttpError(409, 'There are no uncommitted changes to describe.')
        return yield* s.titles.commitMessageEffect({ id, diff })
      }
      if (method === 'POST' && path === '/api/tasks/commit') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            message: Schema.optional(
              maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 4000),
            ),
            push: Schema.optionalWith(Schema.Boolean, { default: () => false }),
          }),
          yield* serviceResult(body(request)),
        )
        if (
          s.store.get().repositories.find((repo) => repo.id === s.store.task(input.id).repositoryId)
            ?.kind
        )
          throw new HttpError(400, 'This project does not use Git')
        if (s.store.task(input.id).status === 'running')
          throw new HttpError(409, 'Wait for the agent to finish before committing.')
        const cwd = yield* serviceResult(s.checkouts.directory(input.id))
        let message = input.message
        if (!message) {
          const diff = yield* serviceResult(uncommittedChanges(s.git, cwd))
          if (!diff.trim()) throw new HttpError(409, 'There are no uncommitted changes to commit.')
          message = (yield* s.titles.commitMessageEffect({ id: input.id, diff })).message
        }
        const commitMessage = message
        // Everything in the checkout, like "Commit all" in other Git tools.
        const commit = yield* serviceResult(
          s.tasks.withCheckoutMutation(cwd, async () => {
            if (s.store.task(input.id).status === 'running')
              throw new HttpError(409, 'Wait for the agent to finish before committing.')
            await s.git.command(cwd, ['add', '-A', '--', '.'])
            return s.git.commit(cwd, commitMessage)
          }),
        )
        const files = yield* serviceResult(s.git.changes(cwd).catch(() => undefined))
        if (files) s.store.updateTask(input.id, (task) => ({ ...task, files }))
        s.activity.add('task', input.id, `Committed ${commit.slice(0, 8)}`, { commit })
        let pushError: string | undefined
        if (input.push)
          yield* serviceResult(
            s.git.push(cwd).catch((error: unknown) => {
              pushError = error instanceof Error ? error.message : String(error)
            }),
          )
        return { commit, ...(pushError ? { pushError } : {}) }
      }
      if (method === 'POST' && path === '/api/tasks/retry') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            turnId: idSchema,
            model: Schema.optional(maxValue(Schema.String, 200)),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* s.tasks.retryTurnEffect(input.id, input.turnId, input.model)
      }
      if (method === 'POST' && path === '/api/tasks/fork') {
        const input = decode(
          mutableStruct({ id: idSchema, turnId: idSchema }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(s.tasks.fork(input.id, input.turnId))
      }
      if (method === 'POST' && path === '/api/tasks/worktree-thread') {
        const input = decode(
          mutableStruct({ id: idSchema, mode: Schema.Literal('reuse', 'fork') }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(s.tasks.newWorktreeThread(input.id, input.mode))
      }
      if (method === 'POST' && path === '/api/tasks/handoff') {
        const input = decode(
          mutableStruct({ id: idSchema, target: Schema.Literal('worktree', 'main') }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(handoffTask(s, input.id, input.target))
      }
      if (method === 'POST' && path === '/api/tasks/checkouts/save') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            before: linkedCheckoutsSchema,
            links: linkedCheckoutsSchema,
          }),
          yield* serviceResult(body(request)),
        )
        s.tasks.requireIdle(input.id)
        return yield* runtimeOperation(() =>
          s.checkouts.linked.save(input.id, input.before, input.links),
        )
      }
      if (method === 'POST' && path === '/api/tasks/checkouts/changes') {
        const input = decode(
          mutableStruct({ id: idSchema, checkoutId: idSchema, turnId: Schema.optional(idSchema) }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(input.id)
        if (input.turnId) {
          const checkpoint = task.turns
            ?.find((turn) => turn.id === input.turnId)
            ?.checkpoint?.linked?.find((item) => item.checkoutId === input.checkoutId)
          if (!checkpoint) throw new HttpError(404, 'Linked checkpoint not found')
          return { files: checkpoint.files }
        }
        const cwd = yield* serviceResult(s.checkouts.selectedDirectory(input.id, input.checkoutId))
        return { files: yield* serviceResult(s.git.changes(cwd)) }
      }
      if (method === 'POST' && path === '/api/tasks/file/preview') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            path: maxValue(minValue(Schema.String, 1), 4000),
            turnId: Schema.optional(idSchema),
            checkoutId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(
          s.tasks.filePreview(input.id, input.path, input.turnId, input.checkoutId),
        )
      }
      if (method === 'POST' && path === '/api/tasks/file/restore') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            path: maxValue(minValue(Schema.String, 1), 4000),
            turnId: Schema.optional(idSchema),
            checkoutId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(
          s.tasks.restoreFile(input.id, input.path, input.turnId, input.checkoutId),
        )
      }
      if (method === 'POST' && path === '/api/tasks/turn/restore') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            turnId: idSchema,
            direction: Schema.Literal('undo', 'redo'),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(s.tasks.restoreTurn(input.id, input.turnId, input.direction))
      }
      if (method === 'POST' && path === '/api/tasks/files') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            query: maxValue(Schema.String, 200),
          }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(input.id)
        const repo = s.store.get().repositories.find((item) => item.id === task.repositoryId)
        if (!repo) throw new HttpError(404, 'Repository not found')
        // A draft has no worktree yet; its files match the project it will start from.
        const cwd =
          canChangeTaskCheckout(task) && repo.kind !== 'scratch'
            ? repo.path
            : yield* serviceResult(s.checkouts.directory(input.id))
        return {
          files: yield* serviceResult(s.projectFiles.search(cwd, input.query, 8, !!repo.kind)),
        }
      }
      if (
        method === 'POST' &&
        (path === '/api/tasks/files/list' ||
          path === '/api/tasks/files/read' ||
          path === '/api/tasks/files/write')
      ) {
        const input = decode(
          mutableStruct({
            id: idSchema,
            path: Schema.optional(maxValue(minValue(Schema.String, 1), 4000)),
            contents: Schema.optional(maxValue(Schema.String, 1024 * 1024)),
            expectedContents: Schema.optional(maxValue(Schema.String, 1024 * 1024)),
          }),
          yield* serviceResult(body(request)),
        )
        const task = s.store.task(input.id)
        const repo = s.store.get().repositories.find((item) => item.id === task.repositoryId)
        if (!repo) throw new HttpError(404, 'Repository not found')
        const cwd =
          canChangeTaskCheckout(task) && repo.kind !== 'scratch'
            ? repo.path
            : yield* serviceResult(s.checkouts.directory(input.id))
        if (path === '/api/tasks/files/list')
          return { files: yield* serviceResult(s.projectFiles.all(cwd, !!repo.kind)) }
        if (!input.path) throw new HttpError(400, 'File path is required')
        const filename = yield* serviceResult(
          safeFile(yield* serviceResult(repositoryPath(cwd)), input.path),
        )
        const details = yield* serviceResult(stat(filename))
        if (!details.isFile() || details.size > 1024 * 1024)
          throw new HttpError(413, 'Only text files up to 1 MB can be previewed')
        const contents = yield* serviceResult(readFile(filename, 'utf8'))
        if (contents.includes('\0')) throw new HttpError(415, 'Binary files cannot be previewed')
        if (path === '/api/tasks/files/write') {
          if (input.contents === undefined || input.expectedContents === undefined)
            throw new HttpError(400, 'File contents and original contents are required')
          if (input.contents.includes('\0'))
            throw new HttpError(415, 'Binary files cannot be edited')
          if (Buffer.byteLength(input.contents, 'utf8') > 1024 * 1024)
            throw new HttpError(413, 'Only text files up to 1 MB can be edited')
          if (contents !== input.expectedContents)
            throw new HttpError(409, 'File changed on disk. Reload it before saving.')
          yield* serviceResult(writeFile(filename, input.contents, 'utf8'))
          return { path: input.path, contents: input.contents }
        }
        return { path: input.path, contents }
      }
      if (method === 'POST' && path === '/api/tasks/feedback/remove') {
        const input = decode(
          mutableStruct({ id: idSchema, messageId: idSchema }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult(s.tasks.removeFeedback(input.id, input.messageId))
      }
      if (method === 'POST' && path === '/api/tasks/run') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        yield* s.tasks.startEffect(id)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/cancel') {
        const input = decode(
          mutableStruct({ id: idSchema, runId: Schema.optional(idSchema) }),
          yield* serviceResult(body(request)),
        )
        if (!input.runId)
          throw new HttpError(
            409,
            'Update Dovo or refresh this thread before stopping its current run',
          )
        s.tasks.cancel(input.id, input.runId)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/new-session') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        if (s.store.task(id).status === 'running')
          throw new HttpError(409, 'Cancel the active turn first')
        s.store.updateTask(id, (t) => ({
          ...t,
          sessionId: undefined,
          sessionAgentId: undefined,
          consumedMessageIds: undefined,
          contextUsage: undefined,
        }))
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/tasks/compact') {
        const { id } = decode(mutableStruct({ id: idSchema }), yield* serviceResult(body(request)))
        const task = s.store.task(id)
        if (!task.sessionId) throw new HttpError(409, 'Run the agent before compacting its session')
        s.tasks.requireIdle(id)
        if (task.queue?.length) throw new HttpError(409, 'Finish queued messages before compacting')
        return yield* s.tasks.sendEffect(id, randomUUID(), '/compact')
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
