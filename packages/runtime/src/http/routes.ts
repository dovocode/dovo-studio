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
import { z } from 'zod'
import { patchSchema, workspaceSchema } from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
import { hashSecret, equalSecret } from '../auth/devices.js'
import { validateAutomation } from '../jobs/validation.js'
const idSchema = z.string().min(1).max(200)
export async function route(request: IncomingMessage, url: URL, s: Services): Promise<unknown> {
  const method = request.method,
    path = url.pathname
  const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
  if (method === 'GET' && path === '/health')
    return { ok: true, service: 'dovo-runtime', version: 1 }
  if (method === 'POST' && path === '/api/pair/request') {
    const input = z
      .object({ code: z.string().regex(/^\d{8}$/), name: z.string().trim().min(1).max(100) })
      .parse(await body(request))
    return s.pairing.request(input.code, input.name, request.socket.remoteAddress ?? 'unknown')
  }
  if (method === 'POST' && path === '/api/pair/claim') {
    const input = z.object({ id: idSchema, secret: z.string().min(20) }).parse(await body(request))
    return s.pairing.claim(input.id, input.secret)
  }
  const segments = path.split('/').filter(Boolean)
  if (
    method === 'POST' &&
    segments[0] === 'api' &&
    segments[1] === 'webhooks' &&
    segments.length === 3
  ) {
    const id = segments[2],
      row = z
        .object({ value: z.string() })
        .optional()
        .parse(s.db.prepare('SELECT value FROM documents WHERE id=?').get(`webhook:${id}`))
    if (!row || !equalSecret(hashSecret(token), row.value))
      throw new HttpError(401, 'Invalid webhook credential')
    const flow = s.store.get().automations.find((f) => f.id === id)
    if (
      !flow?.enabled ||
      !flow.nodes.some((n) => n.data.kind === 'trigger' && n.data.trigger === 'webhook')
    )
      throw new HttpError(409, 'Webhook automation is disabled')
    trackRequest(request, s.activity, id, 'Webhook received')
    const payload = await body(request)
    const key = idSchema.parse(request.headers['x-idempotency-key'])
    return { id: s.jobs.start(id, `webhook:${key}`, payload) }
  }
  const device = s.devices.authenticate(token)
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
        '/api/live-activities/register',
        '/api/attachments/upload',
        '/api/scm/connections/save',
        '/api/scm/work/pipelines/action',
      ].includes(path),
    )
  }
  if (method === 'GET' && path === '/api/live-activities/status') return s.liveActivities.status()
  if (method === 'POST' && path === '/api/live-activities/register')
    return s.liveActivities.register(device.id, await body(request))
  if (method === 'POST' && path === '/api/live-activities/remove') {
    const { activityId } = z.object({ activityId: idSchema }).parse(await body(request))
    s.liveActivities.remove(device.id, activityId)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/previews/devices') {
    const { taskId } = z.object({ taskId: idSchema }).parse(await body(request))
    s.store.task(taskId)
    return previewDevices()
  }
  if (method === 'POST' && path === '/api/previews/simulator/open') {
    const { taskId, id } = z.object({ taskId: idSchema, id: idSchema }).parse(await body(request))
    s.store.task(taskId)
    const result = await s.simulators.open(taskId, id)
    return {
      ticket: s.simulatorTickets.issue(token, result.id),
      host: hostname(),
      device: result.device,
    }
  }
  if (method === 'POST' && path === '/api/previews/simulator/close') {
    const { taskId, id } = z.object({ taskId: idSchema, id: idSchema }).parse(await body(request))
    s.store.task(taskId)
    await s.simulators.closeDevice(taskId, id)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/previews/browser/open') {
    const { taskId } = remoteBrowserOpenSchema.parse(await body(request))
    s.store.task(taskId)
    await s.browsers.open(taskId)
    return { ticket: s.browserTickets.issue(token, taskId), host: hostname() }
  }
  if (method === 'POST' && path === '/api/previews/browser/close') {
    const { taskId } = remoteBrowserOpenSchema.parse(await body(request))
    s.store.task(taskId)
    await s.browsers.close(taskId)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/previews/action') {
    const input = previewActionSchema.parse(await body(request))
    s.store.task(input.taskId)
    return previewDeviceAction(input)
  }
  if (method === 'POST' && path === '/api/attachments/upload')
    return s.attachments.upload(await body(request))
  if (method === 'POST' && ['/api/attachments/read', '/api/attachments/remove'].includes(path)) {
    const input = z.object({ taskId: idSchema, id: z.uuid() }).parse(await body(request))
    if (path.endsWith('/read')) return s.attachments.read(input.taskId, input.id)
    s.attachments.removeDraft(input.taskId, input.id)
    return { ok: true, revision: s.store.version() }
  }
  if (method === 'POST' && path === '/api/activity') {
    const input = z
      .object({
        query: z.string().max(500).default(''),
        kind: z.string().max(100).default(''),
        scope: z.string().max(200).default(''),
        offset: z.number().int().min(0).default(0),
      })
      .parse(await body(request))
    return s.activity.list(input.query, input.kind, input.offset, input.scope)
  }
  if (method === 'POST' && path === '/api/shortcuts/received') {
    const input = z
      .object({ id: idSchema, text: z.string().max(12000), title: z.string().max(200) })
      .parse(await body(request))
    s.activity.add('submission', device.id, 'iOS Shortcut received', input, `shortcut:${input.id}`)
    return { ok: true }
  }
  const owner = () => {
    if (!device.owner) throw new HttpError(403, 'Only the runtime host can manage device trust')
  }
  if (method === 'GET' && path === '/api/snapshot')
    return {
      runtimeHost: hostname(),
      revision: s.store.version(),
      workspace: s.store.get(),
      approvals: s.approvals.list(),
      questions: s.questions.list(),
      terminals: s.terminals.list(),
      runs: s.jobs.list(),
      devices: device.owner ? s.devices.list() : s.devices.list().filter((d) => d.id === device.id),
      pendingDevices: device.owner ? s.pairing.pending() : [],
      owner: device.owner,
    }
  if (method === 'POST' && path === '/api/commands/read')
    return { settings: s.commands.get(), defaultShell: defaultShell() }
  if (method === 'POST' && path === '/api/commands/save')
    return { settings: s.commands.save(await body(request)), defaultShell: defaultShell() }
  if (method === 'GET' && path === '/api/extensions') return { extensions: s.agents.host.list() }
  if (method === 'POST' && path === '/api/workspace/import') {
    owner()
    if (
      s.store.get().agents.length ||
      s.store.get().tasks.length ||
      s.store.get().repositories.length ||
      s.store.get().jiraSources?.length
    )
      throw new HttpError(409, 'Runtime already has workspace data')
    const workspace = workspaceSchema.parse(await body(request))
    s.store.update(() => workspace)
    return { ok: true }
  }
  if (method === 'PATCH' && path === '/api/workspace') {
    const patch = patchSchema.parse(await body(request))
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
        validateAutomation(workspaceSchema.shape.automations.element.parse(next), s.store.get())
      }
    }
    s.store.patch(patch)
    return { revision: s.store.version() }
  }
  if (method === 'POST' && path === '/api/pair/code') {
    owner()
    const input = z.object({ autoApprove: z.boolean().default(false) }).parse(await body(request))
    return s.pairing.createCode(input.autoApprove)
  }
  if (method === 'POST' && path === '/api/pair/approve') {
    owner()
    const input = z.object({ id: idSchema, allow: z.boolean() }).parse(await body(request))
    s.pairing.approve(input.id, input.allow)
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/devices/revoke') {
    owner()
    s.devices.revoke(z.object({ id: idSchema }).parse(await body(request)).id)
    return { ok: true }
  }
  if (
    path === '/api/approvals' ||
    path.startsWith('/api/agents/') ||
    path.startsWith('/api/tasks/')
  )
    return agentsRoute(request, path, s)
  if (path === '/api/terminals' || path.startsWith('/api/terminals/'))
    return terminalsRoute(request, path, s, token)
  if (path.startsWith('/api/jobs/')) return jobsRoute(request, path, s, owner)
  if (path.startsWith('/api/scm/')) return scmRoute(request, path, s)
  throw new HttpError(404, 'Endpoint not found')
}
