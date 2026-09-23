import { RUNTIME_PROTOCOL_VERSION, PAIRING_PROTOCOL_VERSION } from '@dovo/protocol'
import { routeProgram, serviceResult } from './effect.js'
import { uuidSchema } from '@dovo/protocol'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import { previewDevices, previewDeviceAction } from '../previews/devices.js'
import { previewActionSchema, remoteBrowserOpenSchema } from '@dovo/protocol'
import { hostname } from 'node:os'
import { trackRequest } from './request-activity.js'
import { defaultShell } from '../terminal/shell.js'
import { agentsRoute } from './agents-routes.js'
import { terminalsRoute } from './terminals-routes.js'
import { jobsRoute } from './jobs-routes.js'
import { scmRoute } from './scm-routes.js'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import { patchSchema, workspaceSchema } from '@dovo/protocol'
import { RuntimeServices } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
import { hashSecret, equalSecret } from '../auth/devices.js'
import { validateAutomation } from '../jobs/validation.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
export function route(
  request: IncomingMessage,
  url: URL,
  addresses: () => { name: string; address: string }[] = () => [],
) {
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
          yield* serviceResult(body(request)),
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
          yield* serviceResult(body(request)),
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
        const payload = yield* serviceResult(body(request))
        const key = decode(idSchema, request.headers['x-idempotency-key'])
        return yield* serviceResult({
          id: s.jobs.start(id, `webhook:${key}`, payload),
        })
      }
      const device = s.devices.authenticate(token)
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
            '/api/live-activities/register',
            '/api/attachments/upload',
            '/api/scm/connections/save',
            '/api/scm/work/pipelines/action',
          ].includes(path),
        )
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
          ticket: s.simulatorTickets.issue(token, result.id),
          host: hostname(),
          device: result.device,
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
      if (method === 'POST' && path === '/api/previews/browser/open') {
        const { taskId } = decode(remoteBrowserOpenSchema, yield* serviceResult(body(request)))
        s.store.task(taskId)
        yield* serviceResult(s.browsers.open(taskId))
        return yield* serviceResult({
          ticket: s.browserTickets.issue(token, taskId),
          host: hostname(),
        })
      }
      if (method === 'POST' && path === '/api/previews/browser/close') {
        const { taskId } = decode(remoteBrowserOpenSchema, yield* serviceResult(body(request)))
        s.store.task(taskId)
        yield* serviceResult(s.browsers.close(taskId))
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
        return yield* serviceResult(
          s.activity.list(input.query, input.kind, input.offset, input.scope),
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
      if (method === 'GET' && path === '/api/snapshot')
        return yield* serviceResult({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          runtimeHost: hostname(),
          revision: s.store.version(),
          workspace: s.store.publicWorkspace(),
          approvals: s.approvals.list(),
          questions: s.questions.list(),
          terminals: s.terminals.list(),
          runs: s.jobs.list(),
          devices: device.owner
            ? s.devices.list()
            : s.devices.list().filter((d) => d.id === device.id),
          pendingDevices: device.owner ? s.pairing.pending() : [],
          owner: device.owner,
        })
      if (method === 'POST' && path === '/api/runtime/prepare-restart') {
        owner()
        return yield* serviceResult(s.tasks.prepareRestart())
      }
      if (method === 'POST' && path === '/api/runtime/cancel-restart') {
        owner()
        const input = decode(mutableStruct({ id: uuidSchema }), yield* serviceResult(body(request)))
        return yield* serviceResult(s.tasks.cancelRestart(input.id))
      }
      if (method === 'POST' && path === '/api/runtime/preferences/read')
        return yield* serviceResult(s.preferences.get())
      if (method === 'POST' && path === '/api/runtime/preferences/save')
        return yield* serviceResult(s.preferences.save(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/commands/read')
        return yield* serviceResult({
          settings: s.commands.get(),
          defaultShell: defaultShell(),
        })
      if (method === 'POST' && path === '/api/commands/save')
        return yield* serviceResult({
          settings: s.commands.save(yield* serviceResult(body(request))),
          defaultShell: defaultShell(),
        })
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
        s.store.update(() => workspace)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (method === 'PATCH' && path === '/api/workspace') {
        const patch = decode(patchSchema, yield* serviceResult(body(request)))
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
