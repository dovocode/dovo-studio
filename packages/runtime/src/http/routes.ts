import { conversationPage } from '@dovo/protocol'
import { compactActivityEvents } from '@dovo/protocol'
import { searchTaskMessages } from '@dovo/protocol'
import { recoverableMutation } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { mcpAppRpcSchema } from '@dovo/protocol'
import {
  ARTIFACT_MAX_BYTES,
  artifactCreateSchema,
  artifactUpdateSchema,
  artifactReadSchema,
  artifactScopeSchema,
} from '@dovo/protocol'
import { mutableArray } from '@dovo/protocol'
import { runtimeSnapshot } from './support/runtime-snapshot.js'
import { SCRATCH_PROJECT_ID } from '@dovo/protocol'
import { usageHistory } from './endpoints/usage-history.js'
import { usageLimits } from './endpoints/usage-limits.js'
import { usageResets } from './endpoints/usage-resets.js'
import { PAIRING_PROTOCOL_VERSION } from '@dovo/protocol'
import { routeProgram, serviceResult } from './support/effect.js'
import { uuidSchema } from '@dovo/protocol'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import { previewDevices, previewDeviceAction } from '../previews/devices.js'
import {
  previewActionSchema,
  browserProfilesResultSchema,
  remoteBrowserOpenSchema,
  remoteBrowserInputSchema,
} from '@dovo/protocol'
import { hostname } from 'node:os'
import { trackRequest } from './support/request-activity.js'
import { desktopUpdate } from './desktop-updates.js'
import { serverUpdateStatus, startServerUpdate } from './server-updates.js'
import { defaultShell } from '../terminal/shell.js'
import { agentsRoute } from './endpoints/agents-routes.js'
import { terminalsRoute } from './endpoints/terminals-routes.js'
import { jobsRoute } from './endpoints/jobs-routes.js'
import { scmRoute } from './endpoints/scm-routes.js'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { patchSchema, workspaceSchema } from '@dovo/protocol'
import { RuntimeServices } from '../services.js'
import { HttpError, type RuntimeFailure } from '../errors.js'
import { body } from './support/body.js'
import { hashSecret, equalSecret } from '../auth/devices.js'
import { validateAutomation } from '../jobs/validation.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
// Unauthenticated routes read at most what they need before any credential is checked.
const PAIRING_BODY_LIMIT = 4 * 1024
// A webhook payload is copied into the run record and the task's first message.
const WEBHOOK_BODY_LIMIT = 256 * 1024
export function route(
  request: IncomingMessage,
  url: URL,
  addresses: () => { name: string; address: string }[] = () => [],
  internal = false,
  receipted = false,
): Effect.Effect<unknown, RuntimeFailure, RuntimeServices> {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method,
        path = url.pathname
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
      if (method === 'GET' && path === '/health')
        return yield* serviceResult({
          ok: true,
          service: 'dovo-runtime',
          version: 1,
        })
      if (method === 'POST' && path === '/api/pair/request') {
        const input = decode(
          mutableStruct({
            protocolVersion: Schema.optional(Schema.Number),
            code: Schema.String.pipe(Schema.pattern(/^\d{8}$/)),
            name: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 100),
          }),
          yield* serviceResult(body(request, PAIRING_BODY_LIMIT)),
        )
        if (input.protocolVersion !== PAIRING_PROTOCOL_VERSION)
          throw new HttpError(426, 'Update this app before pairing with this runtime.')
        return yield* serviceResult(
          s.pairing.request(input.code, input.name, request.socket.remoteAddress ?? 'unknown'),
        )
      }
      if (
        method === 'POST' &&
        (path === '/api/pair/claim' || path === '/api/pair/cancel' || path === '/api/pair/confirm')
      ) {
        const input = decode(
          mutableStruct({
            id: idSchema,
            secret: minValue(Schema.String, 20),
          }),
          yield* serviceResult(body(request, PAIRING_BODY_LIMIT)),
        )
        return yield* serviceResult(
          path === '/api/pair/cancel'
            ? s.pairing.cancel(input.id, input.secret)
            : path === '/api/pair/confirm'
              ? s.pairing.confirm(input.id, input.secret)
              : s.pairing.claim(input.id, input.secret),
        )
      }
      const segments = path.split('/').filter(Boolean)
      if (
        method === 'POST' &&
        segments[0] === 'api' &&
        segments[1] === 'webhooks' &&
        segments.length === 3
      ) {
        const id = segments[2],
          row = decode(
            Schema.UndefinedOr(
              mutableStruct({
                value: Schema.String,
              }),
            ),
            s.db.prepare('SELECT value FROM documents WHERE id=?').get(`webhook:${id}`),
          )
        if (!row || !equalSecret(hashSecret(token), row.value))
          throw new HttpError(401, 'Invalid webhook credential')
        const flow = s.store.get().automations.find((f) => f.id === id)
        if (
          !flow?.enabled ||
          !flow.nodes.some((n) => n.data.kind === 'trigger' && n.data.trigger === 'webhook')
        )
          throw new HttpError(409, 'Webhook automation is disabled')
        trackRequest(request, s.activity, id, 'Webhook received')
        const payload = yield* serviceResult(body(request, WEBHOOK_BODY_LIMIT))
        const key = decode(idSchema, request.headers['x-idempotency-key'])
        return yield* serviceResult({
          id: s.jobs.start(id, `webhook:${key}`, payload),
        })
      }
      if (method === 'POST' && path === '/api/mcp-apps/proxy') {
        const input = decode(
          mutableStruct({ method: Schema.String, params: Schema.optional(Schema.Unknown) }),
          yield* serviceResult(body(request, 256 * 1024)),
        )
        return yield* serviceResult(
          s.mcpApps.proxy(token, input.method, input.params).then((result) => ({ result })),
        )
      }
      const device = s.devices.authenticate(token)
      if (method === 'POST' && path.startsWith('/api/artifacts/')) {
        if (!s.preferences.get().enableArtifacts)
          throw new HttpError(403, 'Enable Dovo Artifacts in this computer’s settings first')
        if (path === '/api/artifacts/library')
          return yield* serviceResult({ artifacts: s.artifacts.library() })
        if (path === '/api/artifacts/create' || path === '/api/artifacts/update') {
          if (!device.owner) throw new HttpError(403, 'Artifacts are created by the thread’s agent')
          // JSON can escape each content byte as six characters; metadata stays small.
          const value = yield* serviceResult(body(request, ARTIFACT_MAX_BYTES * 6 + 4096))
          const input = path.endsWith('/create')
            ? decode(artifactCreateSchema, value)
            : decode(artifactUpdateSchema, value)
          return yield* serviceResult({ artifact: s.artifacts.write(input) })
        }
        if (path === '/api/artifacts/list') {
          const { taskId } = decode(artifactScopeSchema, yield* serviceResult(body(request, 4096)))
          return yield* serviceResult({ artifacts: s.artifacts.list(taskId) })
        }
        if (path === '/api/artifacts/read' || path === '/api/artifacts/versions') {
          const { taskId, id, revision } = decode(
            artifactReadSchema,
            yield* serviceResult(body(request, 4096)),
          )
          return yield* serviceResult(
            path.endsWith('/read')
              ? { artifact: s.artifacts.read(taskId, id, revision) }
              : { versions: s.artifacts.versions(taskId, id) },
          )
        }
      }
      if (method === 'POST' && path === '/api/mcp-apps/read') {
        const { taskId, id } = decode(
          mutableStruct({ taskId: uuidSchema, id: uuidSchema }),
          yield* serviceResult(body(request, 4096)),
        )
        return yield* serviceResult({ app: s.mcpApps.read(taskId, id) })
      }
      if (method === 'GET' && path === '/api/mutations/status') return { version: 1 }
      if (!receipted && request.headers['x-dovo-mutation-id'] !== undefined) {
        if (!recoverableMutation(path, method))
          throw new HttpError(400, 'This action does not support mutation recovery.')
        const id = decode(idSchema, request.headers['x-dovo-mutation-id'])
        const input = yield* serviceResult(body(request))
        return yield* serviceResult(
          s.mutations.execute(
            device.id,
            id,
            { method, path, input },
            () =>
              runClientEffect(
                route(request, url, addresses, internal, true).pipe(
                  Effect.provideService(RuntimeServices, s),
                ),
              ),
            ['/api/tasks/message', '/api/tasks/steer'].includes(path),
          ),
        )
      }
      if (method === 'POST' && path === '/api/mcp-apps/rpc') {
        const input = decode(mcpAppRpcSchema, yield* serviceResult(body(request, 256 * 1024)))
        return yield* serviceResult(
          s.mcpApps
            .action(input.taskId, input.id, input.requestId, input.method, input.params, () => {
              s.devices.authenticate(token)
            })
            .then((result) => ({ result })),
        )
      }
      if (method === 'POST' && path === '/api/devices/revoke-self') {
        if (device.owner) throw new HttpError(403, 'The host credential cannot revoke itself')
        s.devices.revoke(device.id)
        return yield* serviceResult({ ok: true })
      }
      if (
        path !== '/api/activity' &&
        path !== '/api/tasks/viewed' &&
        method !== 'GET' &&
        !path.endsWith('/read') &&
        !path.endsWith('/overview') &&
        !path.endsWith('/detail')
      ) {
        trackRequest(
          request,
          s.activity,
          device.id,
          `${method} ${path}`,
          ![
            '/api/tasks/answer',
            '/api/agents/mcp/test',
            '/api/agents/acp/authenticate',
            '/api/live-activities/register',
            '/api/notifications/register',
            '/api/attachments/upload',
            '/api/scm/connections/save',
            '/api/scm/work/pipelines/action',
          ].includes(path),
        )
      }
      if (method === 'GET' && path === '/api/notifications/status')
        return yield* serviceResult(s.pushNotifications.status(device.id))
      if (method === 'POST' && path === '/api/notifications/register')
        return yield* serviceResult(
          s.pushNotifications.register(device.id, yield* serviceResult(body(request))),
        )
      if (method === 'POST' && path === '/api/notifications/remove') {
        s.pushNotifications.remove(device.id)
        return yield* serviceResult({ ok: true })
      }
      if (method === 'GET' && path === '/api/live-activities/status')
        return yield* serviceResult(s.liveActivities.status())
      if (method === 'POST' && path === '/api/live-activities/register')
        return yield* serviceResult(
          s.liveActivities.register(device.id, yield* serviceResult(body(request))),
        )
      if (method === 'POST' && path === '/api/live-activities/remove') {
        const { activityId } = decode(
          mutableStruct({
            activityId: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        s.liveActivities.remove(device.id, activityId)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/previews/devices') {
        const { taskId } = decode(
          mutableStruct({
            taskId: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        s.store.task(taskId)
        return yield* serviceResult(previewDevices())
      }
      if (method === 'POST' && path === '/api/previews/simulator/open') {
        const { taskId, id } = decode(
          mutableStruct({
            taskId: idSchema,
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        s.store.task(taskId)
        const result = yield* serviceResult(s.simulators.open(taskId, id))
        return yield* serviceResult({
          id: result.id,
          ticket: s.simulatorTickets.issue(token, result.id),
          host: hostname(),
          device: result.device,
          screenPoints: yield* serviceResult(s.simulators.screenPoints(result.id)),
        })
      }
      if (method === 'POST' && path === '/api/previews/simulator/close') {
        const { taskId, id } = decode(
          mutableStruct({
            taskId: idSchema,
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        s.store.task(taskId)
        yield* serviceResult(s.simulators.closeDevice(taskId, id))
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/previews/simulator/input') {
        const { taskId, id, input } = decode(
          mutableStruct({ taskId: idSchema, id: idSchema, input: remoteBrowserInputSchema }),
          yield* serviceResult(body(request)),
        )
        s.store.task(taskId)
        if (s.simulators.taskId(id) !== taskId)
          throw new HttpError(403, 'Simulator preview belongs to another task')
        yield* serviceResult(
          s.simulators.input(id, input, () => {
            s.devices.authenticate(token)
            s.store.task(taskId)
            if (s.simulators.taskId(id) !== taskId)
              throw new HttpError(403, 'Simulator preview belongs to another task')
          }),
        )
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path === '/api/previews/browser/profiles/read')
        return yield* serviceResult({ profiles: s.preferences.get().browserProfiles })
      if (method === 'POST' && path === '/api/previews/browser/profiles/save') {
        const { profiles } = decode(
          browserProfilesResultSchema,
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          profiles: s.preferences.save({ browserProfiles: profiles }).browserProfiles,
        })
      }
      if (method === 'POST' && path === '/api/previews/browser/open') {
        const {
          taskId,
          tabId,
          profileId = 'default',
          url,
        } = decode(remoteBrowserOpenSchema, yield* serviceResult(body(request)))
        s.store.task(taskId)
        if (!s.preferences.get().browserProfiles.some((profile) => profile.id === profileId))
          throw new HttpError(404, 'Browser profile is unavailable. Choose another profile.')
        const resourceId = JSON.stringify(
          profileId === 'default' ? [taskId, tabId ?? null] : [taskId, tabId ?? null, profileId],
        )
        yield* serviceResult(s.browsers.open(resourceId, taskId, profileId, url))
        return yield* serviceResult({
          ticket: s.browserTickets.issue(token, resourceId, taskId),
          tabId,
          profileId,
          host: hostname(),
        })
      }
      if (method === 'POST' && path === '/api/previews/browser/close') {
        const {
          taskId,
          tabId,
          profileId = 'default',
        } = decode(remoteBrowserOpenSchema, yield* serviceResult(body(request)))
        s.store.task(taskId)
        yield* serviceResult(
          s.browsers.close(
            JSON.stringify(
              profileId === 'default'
                ? [taskId, tabId ?? null]
                : [taskId, tabId ?? null, profileId],
            ),
          ),
        )
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/previews/action') {
        const input = decode(previewActionSchema, yield* serviceResult(body(request)))
        s.store.task(input.taskId)
        return yield* serviceResult(previewDeviceAction(input))
      }
      if (method === 'POST' && path === '/api/attachments/upload')
        return yield* serviceResult(s.attachments.upload(yield* serviceResult(body(request))))
      if (
        method === 'POST' &&
        ['/api/attachments/read', '/api/attachments/remove'].includes(path)
      ) {
        const input = decode(
          mutableStruct({
            taskId: idSchema,
            id: uuidSchema,
          }),
          yield* serviceResult(body(request)),
        )
        if (path.endsWith('/read'))
          return yield* serviceResult(s.attachments.read(input.taskId, input.id))
        s.attachments.removeDraft(input.taskId, input.id)
        return yield* serviceResult({
          ok: true,
          revision: s.store.version(),
        })
      }
      if (method === 'POST' && path === '/api/activity') {
        const input = decode(
          mutableStruct({
            includeDetails: Schema.optionalWith(Schema.Boolean, { default: () => false }),
            query: Schema.optionalWith(maxValue(Schema.String, 500), {
              default: () => '',
            }),
            kind: Schema.optionalWith(maxValue(Schema.String, 100), {
              default: () => '',
            }),
            scope: Schema.optionalWith(maxValue(Schema.String, 200), {
              default: () => '',
            }),
            offset: Schema.optionalWith(
              minValue(
                Schema.Number.pipe(Schema.finite()).pipe(
                  Schema.int(),
                  Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                ),
                0,
              ),
              {
                default: () => 0,
              },
            ),
          }),
          yield* serviceResult(body(request)),
        )
        const activity = s.activity.list(input.query, input.kind, input.offset, input.scope)
        return yield* serviceResult(
          input.includeDetails
            ? activity
            : {
                events: compactActivityEvents(activity.events),
              },
        )
      }
      if (method === 'POST' && path === '/api/shortcuts/received') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            text: maxValue(Schema.String, 12000),
            title: maxValue(Schema.String, 200),
          }),
          yield* serviceResult(body(request)),
        )
        s.activity.add(
          'submission',
          device.id,
          'iOS Shortcut received',
          input,
          `shortcut:${input.id}`,
        )
        return yield* serviceResult({
          ok: true,
        })
      }
      const owner = () => {
        if (!device.owner) throw new HttpError(403, 'Only the runtime host can manage device trust')
      }
      if (method === 'POST' && path === '/api/sync/ticket') {
        const format = url.searchParams.get('format')
        const tasks = format === '4' ? syncTasks(url) : undefined
        return {
          ticket: s.tickets.issue(
            token,
            format === '4'
              ? 'runtime-sync-4'
              : format === '3'
                ? 'runtime-sync-3'
                : format === '2'
                  ? 'runtime-sync-2'
                  : 'runtime-sync',
            undefined,
            tasks,
            url.searchParams.get('history') === 'paged',
          ),
          ...(format === '4' ? { format: 4 } : {}),
        }
      }
      if (method === 'POST' && path === '/api/tasks/history') {
        const input = decode(
          mutableStruct({ id: idSchema, before: Schema.optional(idSchema) }),
          yield* serviceResult(body(request, 4096)),
        )
        const task = s.store.task(input.id)
        if (input.before && !task.messages.some((message) => message.id === input.before))
          throw new HttpError(409, 'Reload this conversation before loading older messages')
        return conversationPage(task, input.before)
      }
      if (method === 'POST' && path === '/api/tasks/search') {
        const { query, id } = decode(
          mutableStruct({ query: maxValue(Schema.String, 500), id: Schema.optional(idSchema) }),
          yield* serviceResult(body(request, 4096)),
        )
        return searchTaskMessages(id ? [s.store.task(id)] : s.store.publicWorkspace().tasks, query)
      }
      if (method === 'GET' && path === '/api/snapshot') {
        return yield* runtimeSnapshot(
          s,
          device,
          url.searchParams.get('scope') === 'overview',
          url.searchParams.get('scope') === 'threads' ? syncTasks(url) : undefined,
          url.searchParams.get('history') === 'paged',
        )
      }
      if (method === 'POST' && path === '/api/runtime/prepare-restart') {
        owner()
        return yield* serviceResult(s.tasks.prepareRestart())
      }
      if (method === 'POST' && path.startsWith('/api/runtime/network/')) {
        owner()
        if (!s.network) throw new HttpError(404, 'This runtime has no separate external listener')
        if (!internal)
          throw new HttpError(403, 'Change the external listener from the local desktop app')
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.localAddress ?? ''))
          throw new HttpError(403, 'Change the external listener from the local desktop app')
        if (path === '/api/runtime/network/read') return yield* serviceResult(s.network.status())
        if (path === '/api/runtime/network/save') {
          const input = decode(
            mutableStruct({
              enabled: Schema.Boolean,
              host: Schema.String,
              port: Schema.Number,
            }),
            yield* serviceResult(body(request)),
          )
          return yield* serviceResult(s.network.set(input.host, input.port, input.enabled))
        }
      }
      if (path.startsWith('/api/runtime/desktop-update/')) {
        const action = path.slice('/api/runtime/desktop-update/'.length)
        if (method === 'GET' && action === 'status')
          return yield* serviceResult(desktopUpdate('status', undefined, true))
        if (method === 'POST' && (action === 'start' || action === 'restart')) {
          const input = decode(
            mutableStruct({ version: maxValue(minValue(Schema.String, 1), 80) }),
            yield* serviceResult(body(request)),
          )
          return yield* serviceResult(
            desktopUpdate(action === 'start' ? 'download' : 'restart', input.version, true),
          )
        }
      }
      if (method === 'GET' && path === '/api/runtime/update/status')
        return yield* serviceResult(
          process.env.DOVO_RELEASE_DISTRIBUTION === 'desktop'
            ? desktopUpdate('status')
            : serverUpdateStatus(),
        )
      if (
        method === 'POST' &&
        ['/api/runtime/update/start', '/api/runtime/update/restart'].includes(path)
      ) {
        if (
          s.store.publicWorkspace().tasks.some((task) => task.status === 'running') ||
          s.jobs.list().some((run) => run.status === 'running')
        )
          throw new HttpError(
            409,
            'Finish running tasks and automations before updating this computer.',
          )
        const input = decode(
          mutableStruct({ version: maxValue(minValue(Schema.String, 1), 80) }),
          yield* serviceResult(body(request)),
        )
        if (process.env.DOVO_RELEASE_DISTRIBUTION === 'desktop')
          return yield* serviceResult(
            desktopUpdate(path.endsWith('/restart') ? 'restart' : 'download', input.version),
          )
        if (path.endsWith('/restart'))
          throw new HttpError(409, 'Server updates restart automatically after installation')
        return yield* serviceResult(startServerUpdate(input.version))
      }
      if (method === 'POST' && path === '/api/runtime/cancel-restart') {
        owner()
        const input = decode(mutableStruct({ id: uuidSchema }), yield* serviceResult(body(request)))
        return yield* serviceResult(s.tasks.cancelRestart(input.id))
      }
      if (method === 'POST' && path === '/api/runtime/preferences/read')
        return yield* serviceResult(s.preferences.get())
      if (method === 'POST' && path === '/api/runtime/preferences/save') {
        const settings = s.preferences.save(yield* serviceResult(body(request)))
        s.artifacts.prune()
        return yield* serviceResult(settings)
      }
      if (method === 'POST' && path === '/api/commands/read')
        return yield* serviceResult({
          settings: s.commands.get(),
          defaultShell: defaultShell(),
        })
      if (method === 'POST' && path === '/api/commands/save') {
        const input = yield* serviceResult(body(request))
        const checked =
          input !== null && typeof input === 'object' && 'before' in input && 'after' in input
        return yield* serviceResult({
          settings: checked
            ? s.commands.saveChecked(input.before, input.after)
            : s.commands.save(input),
          defaultShell: defaultShell(),
        })
      }
      if (method === 'GET' && path === '/api/extensions')
        return yield* serviceResult({
          extensions: s.agents.host.list(),
        })
      if (method === 'POST' && path === '/api/workspace/import') {
        owner()
        if (
          s.store.get().agents.length ||
          s.store.get().tasks.length ||
          s.store.get().repositories.length ||
          s.store.get().jiraSources?.length
        )
          throw new HttpError(409, 'Runtime already has workspace data')
        const workspace = decode(workspaceSchema, yield* serviceResult(body(request)))
        if (workspace.tasks.some((task) => task.historyBefore || task.historyTotals))
          throw new HttpError(
            400,
            'A paged client snapshot is not a backup. Export the full workspace from its runtime before importing.',
          )
        const scratch = workspace.repositories.some((repo) => repo.id === SCRATCH_PROJECT_ID)
          ? yield* serviceResult(s.scratch.available())
          : undefined
        if (workspace.tasks.some((task) => task.repositoryId === SCRATCH_PROJECT_ID) && !scratch)
          throw new HttpError(409, 'Scratch threads cannot be restored in this Git checkout')
        s.store.update(() => ({
          ...workspace,
          repositories: [
            ...workspace.repositories.filter(
              (repo) => repo.id !== SCRATCH_PROJECT_ID && repo.kind !== 'scratch',
            ),
            ...(scratch ? [scratch] : []),
          ],
        }))
        return yield* serviceResult({ ok: true })
      }
      if (method === 'PATCH' && path === '/api/workspace') {
        const patch = decode(patchSchema, yield* serviceResult(body(request)))
        if (patch.collection === 'repositories' && patch.id === SCRATCH_PROJECT_ID) {
          if (!patch.create || Object.keys(patch.changes).length)
            throw new HttpError(400, 'The scratch workspace is managed by Dovo')
          yield* serviceResult(s.scratch.ensure())
          return { revision: s.store.version(), runtimeInstanceId: s.instanceId }
        }
        if (patch.collection === 'tasks') {
          const candidate =
            patch.create && typeof patch.create === 'object' && 'repositoryId' in patch.create
              ? patch.create.repositoryId
              : patch.changes.repositoryId?.after
          if (candidate === SCRATCH_PROJECT_ID) yield* serviceResult(s.scratch.ensure())
        }
        if (
          patch.collection === 'automations' &&
          (patch.changes.enabled?.after === true ||
            s.store.get().automations.find((f) => f.id === patch.id)?.enabled)
        ) {
          const current = s.store.get().automations.find((f) => f.id === patch.id)
          if (current) {
            const next = {
              ...current,
              ...Object.fromEntries(
                Object.entries(patch.changes).map(([key, value]) => [key, value.after]),
              ),
            }
            validateAutomation(
              decode(workspaceSchema.fields.automations.value, next),
              s.store.get(),
            )
          }
        }
        s.store.patch(patch)
        return yield* serviceResult({
          revision: s.store.version(),
          runtimeInstanceId: s.instanceId,
        })
      }
      if (method === 'POST' && path === '/api/pair/code') {
        owner()
        const input = decode(
          mutableStruct({
            autoApprove: Schema.optionalWith(Schema.Boolean, {
              default: () => false,
            }),
          }),
          yield* serviceResult(body(request)),
        )
        return yield* serviceResult({
          ...s.pairing.createCode(input.autoApprove),
          addresses: addresses(),
        })
      }
      if (method === 'POST' && path === '/api/pair/approve') {
        owner()
        const input = decode(
          mutableStruct({
            id: idSchema,
            allow: Schema.Boolean,
          }),
          yield* serviceResult(body(request)),
        )
        s.pairing.approve(input.id, input.allow)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'POST' && path === '/api/devices/revoke') {
        owner()
        s.devices.revoke(
          decode(
            mutableStruct({
              id: idSchema,
            }),
            yield* serviceResult(body(request)),
          ).id,
        )
        return yield* serviceResult({
          ok: true,
        })
      }
      if (
        method === 'POST' &&
        (path === '/api/usage/history/read' || path === '/api/usage/prices/write')
      )
        return yield* usageHistory(request, path)
      if (method === 'POST' && path === '/api/usage/limits/read') return yield* usageLimits(request)
      if (
        method === 'POST' &&
        (path === '/api/usage/resets/read' || path === '/api/usage/resets/consume')
      )
        return yield* usageResets(request, path)
      if (
        path === '/api/approvals' ||
        path.startsWith('/api/agents/') ||
        path.startsWith('/api/tasks/')
      )
        return yield* agentsRoute(request, path)
      if (path === '/api/terminals' || path.startsWith('/api/terminals/'))
        return yield* terminalsRoute(request, path, token)
      if (path.startsWith('/api/jobs/')) return yield* jobsRoute(request, path, owner)
      if (path.startsWith('/api/scm/')) return yield* scmRoute(request, path)
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}

function syncTasks(url: URL) {
  return decode(mutableArray(idSchema).pipe(Schema.maxItems(8)), url.searchParams.getAll('task'))
}
