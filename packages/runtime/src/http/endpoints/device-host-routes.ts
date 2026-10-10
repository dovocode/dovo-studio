import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { IncomingMessage } from 'node:http'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  minValue,
  maxValue,
  previewActionSchema,
  remoteBrowserInputSchema,
  deviceHostInstallSchema,
  deviceHostForwardSchema,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { body } from '../support/body.js'
import { HttpError } from '../../errors.js'
import { previewDevices, previewDeviceAction } from '../../previews/devices.js'
import { foreignDeviceScope } from '../../previews/device-hosts.js'
const id = maxValue(minValue(Schema.String, 1), 200)
const scopeSchema = mutableStruct({ taskId: id })
const sessionSchema = mutableStruct({ taskId: id, id })
export async function deviceHostRoute(
  request: IncomingMessage,
  path: string,
  s: Services,
  token: string,
  pairedDeviceId: string,
) {
  const method = request.method
  const agent = request.headers['x-dovo-agent-access'] === '1'
  if (
    agent &&
    ((path === '/api/device-hosts' && method !== 'GET') ||
      ['/api/device-hosts/test', '/api/device-hosts/remove'].includes(path))
  )
    throw new HttpError(403, 'Device host configuration is managed by the paired client')
  if (
    path.startsWith('/api/device-host/') &&
    ![
      '/api/device-host/close',
      '/api/device-host/release',
      '/api/device-host/upload/remove',
    ].includes(path)
  )
    if (!s.deviceHosts.settings.get().enabled)
      throw new HttpError(
        403,
        'Enable Device Hub on the destination computer in Settings → Computers → Device previews',
      )
  if (path === '/api/device-hosts') {
    if (method === 'GET') return s.deviceHosts.settings.public()
    if (method === 'POST') {
      const value = await body(request, 128 * 1024)
      if (
        !value ||
        typeof value !== 'object' ||
        !('revision' in value) ||
        value.revision === undefined
      )
        throw new HttpError(409, 'Refresh device host settings before saving')
      return s.deviceHosts.save(value)
    }
  }
  if (method !== 'POST') throw new HttpError(405, 'Device host operation requires POST')
  if (path === '/api/device-hosts/test') return s.deviceHosts.test(await body(request, 16384))
  if (path === '/api/device-hosts/remove')
    return s.deviceHosts.remove(decode(mutableStruct({ id }), await body(request, 4096)).id)
  if (path === '/api/device-hosts/install') {
    const input = decode(deviceHostInstallSchema, await body(request, 8192))
    s.deviceHosts.assertEnabled()
    s.store.task(input.taskId)
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.socket.once('close', abort)
    try {
      return await s.deviceHosts.install(
        input,
        await s.checkouts.directory(input.taskId),
        agent,
        controller.signal,
      )
    } finally {
      request.socket.off('close', abort)
    }
  }
  if (path === '/api/device-hosts/forward') {
    const input = decode(deviceHostForwardSchema, await body(request, 8192))
    s.store.task(input.taskId)
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.socket.once('close', abort)
    try {
      return await s.deviceHosts.forward(input, agent, controller.signal)
    } finally {
      request.socket.off('close', abort)
    }
  }
  if (path === '/api/device-hosts/forwards') {
    const input = decode(scopeSchema, await body(request, 4096))
    s.store.task(input.taskId)
    return s.deviceHosts.listForwards(input.taskId, agent)
  }
  if (path === '/api/device-hosts/forward/stop') {
    const input = decode(sessionSchema, await body(request, 8192))
    s.store.task(input.taskId)
    return s.deviceHosts.stopForward(input.id, input.taskId, agent)
  }
  if (path === '/api/device-host/forward/check') {
    const input = decode(
      mutableStruct({
        taskId: id,
        port: Schema.Number.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
        ),
      }),
      await body(request, 4096),
    )
    const addresses = Object.values(networkInterfaces()).flatMap(
      (entries) =>
        entries
          ?.filter((entry) => !entry.internal && entry.family === 'IPv4')
          .map((entry) => entry.address) ?? [],
    )
    const reachable = await Promise.all(
      addresses.map(
        (address) =>
          new Promise<boolean>((resolve) => {
            const socket = connect({ host: address, port: input.port })
            const done = (value: boolean) => {
              socket.destroy()
              resolve(value)
            }
            socket.setTimeout(1000)
            socket.once('connect', () => done(true))
            socket.once('error', () => done(false))
            socket.once('timeout', () => done(false))
          }),
      ),
    )
    if (!reachable.some(Boolean))
      throw new HttpError(
        409,
        'The forwarded port is not reachable on the destination network. Configure GatewayPorts clientspecified in the destination SSH server and check its firewall, or use a directly reachable development-server URL.',
      )
    return { ok: true }
  }
  if (path === '/api/device-host/ready') {
    decode(scopeSchema, await body(request, 4096))
    return { ok: true }
  }
  if (path === '/api/device-host/devices') {
    decode(scopeSchema, await body(request, 4096))
    // Only local discovery; never recursively traverse this runtime's own device hosts.
    return previewDevices()
  }
  if (path === '/api/device-host/action') {
    const input = decode(previewActionSchema, await body(request, 8192))
    if (input.hostId || input.id.startsWith('remote:'))
      throw new HttpError(400, 'Device host endpoint accepts only local devices')
    return previewDeviceAction({
      ...input,
      taskId: foreignDeviceScope(pairedDeviceId, input.taskId),
    })
  }
  if (path === '/api/device-host/open') {
    const input = decode(sessionSchema, await body(request, 4096))
    if (input.id.startsWith('remote:'))
      throw new HttpError(400, 'Device host endpoint accepts only local devices')
    const opened = await s.hostSimulators.open(
      foreignDeviceScope(pairedDeviceId, input.taskId),
      input.id,
      pairedDeviceId,
    )
    return {
      ...opened,
      ticket: s.deviceHostTickets.issue(token, opened.id),
      screenPoints: await s.hostSimulators.screenPoints(opened.id),
    }
  }
  if (
    ['/api/device-host/input', '/api/device-host/close', '/api/device-host/release'].includes(path)
  ) {
    const input = decode(
      mutableStruct({ ...sessionSchema.fields, input: Schema.optional(remoteBrowserInputSchema) }),
      await body(request, 128 * 1024),
    )
    const scope = foreignDeviceScope(pairedDeviceId, input.taskId)
    const authorize = () => {
      s.devices.authenticate(token)
      if (s.hostSimulators.taskId(input.id, pairedDeviceId) !== scope)
        throw new HttpError(403, 'Device host session belongs to another paired device or task')
    }
    try {
      authorize()
    } catch (error) {
      if (path.endsWith('/close') && error instanceof HttpError && error.status === 404)
        return { ok: true }
      throw error
    }
    if (path.endsWith('/input')) {
      if (!input.input) throw new HttpError(400, 'Device input is required')
      await s.hostSimulators.input(input.id, input.input, authorize)
    } else if (path.endsWith('/release')) await s.hostSimulators.release(input.id)
    else await s.hostSimulators.close(input.id)
    return { ok: true }
  }
  if (path === '/api/device-host/upload') {
    const input = decode(
      mutableStruct({ taskId: id, extension: Schema.Literals(['.apk', '.app']) }),
      await body(request, 4096),
    )
    return s.deviceHostUploads.create(
      foreignDeviceScope(pairedDeviceId, input.taskId),
      input.extension,
    )
  }
  if (path === '/api/device-host/upload/remove') {
    const input = decode(sessionSchema, await body(request, 4096))
    await s.deviceHostUploads.remove(input.id, foreignDeviceScope(pairedDeviceId, input.taskId))
    return { ok: true }
  }
  if (path === '/api/device-host/install') {
    const input = decode(
      mutableStruct({ ...sessionSchema.fields, uploadId: id }),
      await body(request, 4096),
    )
    if (input.id.startsWith('remote:'))
      throw new HttpError(400, 'Device host endpoint accepts only local devices')
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.socket.once('close', abort)
    const authorization = setInterval(() => {
      try {
        s.devices.authenticate(token)
        s.deviceHosts.assertEnabled()
      } catch {
        controller.abort()
      }
    }, 1000)
    authorization.unref()
    try {
      return await s.deviceHostUploads.install(
        input.uploadId,
        foreignDeviceScope(pairedDeviceId, input.taskId),
        input.id,
        () => {
          s.devices.authenticate(token)
          s.deviceHosts.assertEnabled()
        },
        controller.signal,
      )
    } finally {
      clearInterval(authorization)
      request.socket.off('close', abort)
    }
  }
  throw new HttpError(404, 'Device host endpoint not found')
}
