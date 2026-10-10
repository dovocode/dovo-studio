import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  deviceHostSchema,
  previewDevicesSchema,
  previewResultSchema,
  type DeviceHost,
  type DeviceHostTestResult,
  type PreviewDevice,
  type previewActionSchema,
  type deviceHostForwardSchema,
  type deviceHostInstallSchema,
} from '@dovo/protocol'
import {
  DeviceHostSettings,
  savedDeviceHostToken,
  sameDeviceHostConnection,
} from './device-host-settings.js'
import { DeviceHostClient } from './device-host-client.js'
import { testSsh, startSsh, stopSsh, readyReverseForward, copyArtifact } from './device-host-ssh.js'
import { previewDevices, previewDeviceAction } from './devices.js'
import { installNative } from './device-host-install.js'
import { stageDeviceArtifact } from './device-artifact-staging.js'
import { HttpError } from '../errors.js'
import type { NativeSimulator } from './simulator-native.js'
export function remoteDeviceId(hostId: string, id: string) {
  return `remote:${hostId}:${id}`
}
export function splitDeviceId(id: string, hostId?: string) {
  if (id.startsWith('remote:')) {
    const match = /^remote:([a-zA-Z0-9_-]+):(.+)$/.exec(id)
    if (!match || (hostId && hostId !== match[1]))
      throw new HttpError(400, 'Device host does not match the device ID')
    return { hostId: match[1], id: match[2] }
  }
  return { hostId, id }
}
export function foreignDeviceScope(deviceId: string, taskId: string) {
  return `device-host:${JSON.stringify([deviceId, taskId])}`
}
export function assertForeignDeviceScope(scope: string, deviceId: string) {
  if (!scope.startsWith('device-host:'))
    throw new HttpError(403, 'Preview is not a device host session')
  const value: unknown = JSON.parse(scope.slice('device-host:'.length))
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value[0] !== deviceId ||
    typeof value[1] !== 'string'
  )
    throw new HttpError(403, 'Preview belongs to another paired device')
}
function sameHostAccess(a: DeviceHost, b: DeviceHost) {
  return (
    sameDeviceHostConnection(a, b) &&
    a.identityFile === b.identityFile &&
    a.token === b.token &&
    a.agentAccess === b.agentAccess
  )
}
async function cleanupAll(operations: Promise<unknown>[]) {
  const results = await Promise.allSettled(operations)
  for (const result of results)
    if (result.status === 'rejected') console.warn('Device Hub cleanup failed', result.reason)
}
type PendingForward = {
  taskId: string
  hostId: string
  controller: AbortController
  child?: ReturnType<typeof startSsh>
}
type Forward = {
  taskId: string
  hostId: string
  child: ReturnType<typeof startSsh>
  timer: ReturnType<typeof setTimeout>
  url: string
  expiresAt: string
  localPort: number
  remotePort: number
  exposeToNetwork: boolean
}
export class DeviceHosts {
  readonly settings: DeviceHostSettings
  readonly client = new DeviceHostClient()
  private forwards = new Map<string, Forward>()
  private pendingForwards = new Map<string, PendingForward>()
  private installs = new Map<
    string,
    { taskId: string; hostId?: string; controller: AbortController }
  >()
  private disposed = false
  private epoch = 0
  private taskEpochs = new Map<string, number>()
  private hostEpochs = new Map<string, number>()
  constructor(
    db: Database.Database,
    private closeHostSessions: (id: string) => Promise<void>,
    private closeAllSessions: () => Promise<void> = async () => {},
    private cancelIncomingInstalls: () => void = () => {},
  ) {
    this.settings = new DeviceHostSettings(db)
  }
  assertEnabled() {
    if (!this.settings.get().enabled)
      throw new HttpError(403, 'Enable Device Hub on this runtime first')
  }
  host(id: string, agent = false): DeviceHost {
    const host = this.settings.get().hosts.find((host) => host.id === id)
    if (!host) throw new HttpError(404, 'Device host is not configured')
    if (agent && !host.agentAccess)
      throw new HttpError(403, 'Agent access is disabled for this device host')
    return host
  }
  assertAgentDevice(id: string, hostId?: string) {
    const selected = splitDeviceId(id, hostId)
    if (selected.hostId) this.host(selected.hostId, true)
  }
  deviceId(id: string, hostId?: string) {
    const selected = splitDeviceId(id, hostId)
    return selected.hostId ? remoteDeviceId(selected.hostId, selected.id) : selected.id
  }
  async save(value: unknown) {
    const before = this.settings.get()
    const result = this.settings.save(value)
    const after = this.settings.get()
    if (before.enabled && !after.enabled) {
      this.epoch++
      for (const operation of this.installs.values()) operation.controller.abort()
      this.cancelIncomingInstalls()
      await cleanupAll([
        this.closeAllSessions(),
        this.cancelPendingForwards(() => true),
        ...[...this.forwards].map(([id, entry]) => this.stopForward(id, entry.taskId)),
      ])
      await cleanupAll(before.hosts.map((host) => this.client.closeHost(host.id)))
    }
    await Promise.all(
      before.hosts
        .filter(
          (host) =>
            !after.hosts.some((entry) => entry.id === host.id && sameHostAccess(host, entry)),
        )
        .map((host) => this.closeHost(host.id)),
    )
    return result
  }
  async remove(id: string) {
    const result = this.settings.remove(id)
    await this.closeHost(id)
    return result
  }
  async list(taskId = 'discovery', hostId?: string, agent = false) {
    this.assertEnabled()
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    const result = hostId
      ? { host: '', devices: [] as PreviewDevice[], diagnostics: [] as string[] }
      : await previewDevices()
    const hosts = hostId
      ? [this.host(hostId, agent)]
      : this.settings.get().hosts.filter((host) => !agent || host.agentAccess)
    const remote = await Promise.all(
      hosts.map(async (host) => {
        try {
          const value = decode(
            previewDevicesSchema,
            await this.client.request(host, '/api/device-host/devices', { taskId }),
          )
          return {
            devices: value.devices.map((device) => ({
              ...device,
              id: remoteDeviceId(host.id, device.id),
              hostId: host.id,
              hostName: host.name,
            })),
            diagnostics: value.diagnostics.map((message) => `${host.name}: ${message}`),
          }
        } catch (error) {
          if (hostId) throw error
          return {
            devices: [],
            diagnostics: [
              `${host.name}: ${error instanceof HttpError ? error.message : 'Device host discovery failed'}`,
            ],
          }
        }
      }),
    )
    for (const value of remote) {
      result.devices.push(...value.devices)
      result.diagnostics.push(...value.diagnostics)
    }
    if (hostId) result.host = this.host(hostId, agent).name
    return result
  }
  async action(input: Schema.Schema.Type<typeof previewActionSchema>, agent = false) {
    this.assertEnabled()
    const selected = splitDeviceId(input.id, input.hostId)
    if (!selected.hostId) return previewDeviceAction(input)
    return decode(
      previewResultSchema,
      await this.client.request(this.host(selected.hostId, agent), '/api/device-host/action', {
        ...input,
        id: selected.id,
        hostId: undefined,
      }),
    )
  }
  async driver(taskId: string, device: PreviewDevice): Promise<NativeSimulator | undefined> {
    this.assertEnabled()
    const selected = splitDeviceId(device.id, device.hostId)
    if (!selected.hostId) return undefined
    return this.client.driver(this.host(selected.hostId), taskId, { ...device, id: selected.id })
  }
  async test(value: unknown): Promise<DeviceHostTestResult> {
    const candidate = decode(deviceHostSchema, value)
    const host = {
      ...candidate,
      token: savedDeviceHostToken(
        candidate,
        this.settings.get().hosts.find((host) => host.id === candidate.id),
      ),
    }
    const checks: DeviceHostTestResult['checks'] = []
    const client = new DeviceHostClient()
    try {
      await testSsh(host)
      checks.push({
        name: 'ssh',
        ok: true,
        message: 'SSH key authentication succeeded; no remote configuration changed.',
      })
      if (!host.token) {
        checks.push({
          name: 'pairing',
          ok: false,
          message: 'A paired runtime device token is required.',
        })
        return { ok: false, checks }
      }
      const result = decode(
        previewDevicesSchema,
        await client.request(host, '/api/device-host/devices', { taskId: 'readiness' }),
      )
      checks.push({
        name: 'runtime',
        ok: true,
        message: 'Existing runtime is reachable and accepted the pairing token through SSH.',
      })
      checks.push({
        name: 'devices',
        ok: result.devices.some((device) => device.liveSupported !== false),
        message: result.devices.length
          ? `${result.devices.length} device(s) discovered. ${result.diagnostics.join(' ')}`
          : result.diagnostics.join(' ') || 'No native devices discovered.',
      })
      return {
        ok: checks.filter((check) => check.name !== 'devices').every((check) => check.ok),
        checks,
      }
    } catch (error) {
      checks.push({
        name: checks.length ? 'runtime' : 'ssh',
        ok: false,
        message:
          error instanceof HttpError
            ? error.message
            : 'Readiness check failed. Verify the existing runtime version and device tools.',
      })
      return { ok: false, checks }
    } finally {
      await client.dispose()
    }
  }
  async install(
    input: Schema.Schema.Type<typeof deviceHostInstallSchema>,
    checkoutRoot: string,
    agent = false,
    signal?: AbortSignal,
  ) {
    this.assertEnabled()
    const selected = splitDeviceId(input.id, input.hostId)
    const epoch = this.epoch,
      taskEpoch = this.taskEpochs.get(input.taskId),
      hostEpoch = selected.hostId ? this.hostEpochs.get(selected.hostId) : undefined
    const host = selected.hostId ? this.host(selected.hostId, agent) : undefined
    const controller = new AbortController(),
      operationId = randomUUID()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    this.installs.set(operationId, { taskId: input.taskId, hostId: selected.hostId, controller })
    const assertCurrent = () => {
      if (
        controller.signal.aborted ||
        this.disposed ||
        this.epoch !== epoch ||
        this.taskEpochs.get(input.taskId) !== taskEpoch ||
        (selected.hostId && this.hostEpochs.get(selected.hostId) !== hostEpoch)
      )
        throw new HttpError(409, 'App installation was cancelled by device or task cleanup')
      this.assertEnabled()
      if (host && !sameHostAccess(this.host(host.id, agent), host))
        throw new HttpError(409, 'Device host changed during app installation')
    }
    try {
      const artifact = await stageDeviceArtifact(input.artifactPath, checkoutRoot)
      try {
        assertCurrent()
        if (!host)
          return await installNative(selected.id, artifact.file, assertCurrent, controller.signal)
        const upload = decode(
          mutableStruct({ id: Schema.String, path: Schema.String }),
          await this.client.request(
            host,
            '/api/device-host/upload',
            { taskId: input.taskId, extension: artifact.extension },
            controller.signal,
          ),
        )
        try {
          assertCurrent()
          await copyArtifact(
            host,
            artifact.file,
            upload.path,
            artifact.directory,
            controller.signal,
          )
          assertCurrent()
          return decode(
            previewResultSchema,
            await this.client.request(
              host,
              '/api/device-host/install',
              { taskId: input.taskId, id: selected.id, uploadId: upload.id },
              controller.signal,
            ),
          )
        } finally {
          // Never revive an obsolete connection or kill a replacement tunnel during cleanup.
          const current = this.settings.get()
          if (
            current.enabled &&
            !controller.signal.aborted &&
            !this.disposed &&
            current.hosts.some((saved) => saved.id === host.id && sameHostAccess(saved, host))
          ) {
            try {
              await this.client.request(host, '/api/device-host/upload/remove', {
                taskId: input.taskId,
                id: upload.id,
              })
            } catch (error) {
              console.warn(
                'Remote artifact cleanup failed',
                error instanceof HttpError ? error.message : 'Device host unavailable',
              )
            }
          }
        }
      } finally {
        await artifact.dispose()
      }
    } catch (error) {
      if (controller.signal.aborted)
        throw new HttpError(409, 'App installation was cancelled by device or task cleanup')
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      this.installs.delete(operationId)
    }
  }

  async forward(
    input: Schema.Schema.Type<typeof deviceHostForwardSchema>,
    agent = false,
    signal?: AbortSignal,
  ) {
    this.assertEnabled()
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    if (this.forwards.size + this.pendingForwards.size >= 20)
      throw new HttpError(409, 'Stop an unused dev server forward first (maximum 20)')
    const epoch = this.epoch,
      taskEpoch = this.taskEpochs.get(input.taskId),
      hostEpoch = this.hostEpochs.get(input.hostId),
      host = this.host(input.hostId, agent),
      id = randomUUID(),
      controller = new AbortController()
    const operation: PendingForward = { taskId: input.taskId, hostId: input.hostId, controller }
    this.pendingForwards.set(id, operation)
    const abort = () => {
      controller.abort()
      if (operation.child) operation.child.kill('SIGTERM')
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const assertCurrent = () => {
      this.assertEnabled()
      if (
        controller.signal.aborted ||
        this.disposed ||
        this.epoch !== epoch ||
        this.taskEpochs.get(input.taskId) !== taskEpoch ||
        this.hostEpochs.get(input.hostId) !== hostEpoch ||
        !sameHostAccess(this.host(input.hostId, agent), host)
      )
        throw new HttpError(409, 'Dev server forwarding was cancelled by cleanup')
    }
    let registered = false
    try {
      if (!host.token)
        throw new HttpError(409, 'Pair this device host before forwarding a dev server')
      assertCurrent()
      // A pairing check should not run simulator/native-tool discovery.
      try {
        await this.client.request(
          host,
          '/api/device-host/ready',
          { taskId: input.taskId },
          controller.signal,
        )
      } catch (error) {
        // Earlier Device Hub runtimes expose discovery but not the lightweight readiness endpoint.
        if (!(error instanceof HttpError) || error.status !== 404) throw error
        assertCurrent()
        await this.client.request(
          host,
          '/api/device-host/devices',
          { taskId: input.taskId },
          controller.signal,
        )
      }
      assertCurrent()
      const child = (operation.child = startSsh(
        host,
        `${input.exposeToNetwork ? '0.0.0.0' : '127.0.0.1'}:${input.remotePort}:localhost:${input.localPort}`,
        true,
        true,
      ))
      await readyReverseForward(child)
      if (input.exposeToNetwork)
        await this.client.request(
          host,
          '/api/device-host/forward/check',
          {
            taskId: input.taskId,
            port: input.remotePort,
          },
          controller.signal,
        )
      assertCurrent()
      if (child.exitCode !== null || child.signalCode !== null)
        throw new HttpError(502, 'SSH forwarding stopped during startup')
      const duration = input.durationSeconds ?? 600
      const timer = setTimeout(() => {
        void this.stopForward(id, input.taskId).catch((error) =>
          console.warn('Dev server forward cleanup failed', error),
        )
      }, duration * 1000)
      timer.unref()
      const url = `http://${input.exposeToNetwork ? (host.sshHost.includes(':') ? `[${host.sshHost}]` : host.sshHost) : '127.0.0.1'}:${input.remotePort}`
      const expiresAt = new Date(Date.now() + duration * 1000).toISOString()
      this.forwards.set(id, {
        taskId: input.taskId,
        hostId: input.hostId,
        child,
        timer,
        url,
        expiresAt,
        localPort: input.localPort,
        remotePort: input.remotePort,
        exposeToNetwork: input.exposeToNetwork ?? false,
      })
      child.once('exit', () => {
        clearTimeout(timer)
        this.forwards.delete(id)
      })
      // Check again after registering so an already emitted exit cannot leave a stale entry.
      if (child.exitCode !== null || child.signalCode !== null) {
        await this.stopForward(id, input.taskId)
        throw new HttpError(502, 'SSH forwarding stopped during startup')
      }
      registered = true
      return { ok: true as const, id, url, expiresAt }
    } catch (error) {
      if (controller.signal.aborted)
        throw new HttpError(409, 'Dev server forwarding was cancelled by cleanup')
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      this.pendingForwards.delete(id)
      if (!registered && operation.child) await stopSsh(operation.child)
    }
  }
  private async cancelPendingForwards(predicate: (operation: PendingForward) => boolean) {
    await cleanupAll(
      [...this.pendingForwards.values()].filter(predicate).map(async (operation) => {
        operation.controller.abort()
        if (operation.child) await stopSsh(operation.child)
      }),
    )
  }
  listForwards(taskId: string, agent = false) {
    return {
      forwards: [...this.forwards]
        .filter(
          ([, entry]) =>
            entry.taskId === taskId &&
            (!agent ||
              this.settings
                .get()
                .hosts.some((host) => host.id === entry.hostId && host.agentAccess)),
        )
        .map(([id, entry]) => ({
          ok: true as const,
          id,
          hostId: entry.hostId,
          url: entry.url,
          expiresAt: entry.expiresAt,
          localPort: entry.localPort,
          remotePort: entry.remotePort,
          exposeToNetwork: entry.exposeToNetwork,
        })),
    }
  }
  async stopForward(id: string, taskId: string, agent = false) {
    const entry = this.forwards.get(id)
    if (!entry) return { ok: true as const }
    if (entry.taskId !== taskId)
      throw new HttpError(403, 'Dev server forward belongs to another task')
    if (agent) this.host(entry.hostId, true)
    this.forwards.delete(id)
    clearTimeout(entry.timer)
    await stopSsh(entry.child)
    return { ok: true as const }
  }
  async closeTask(taskId: string) {
    for (const operation of this.installs.values())
      if (operation.taskId === taskId) operation.controller.abort()
    this.taskEpochs.set(taskId, (this.taskEpochs.get(taskId) ?? 0) + 1)
    await this.cancelPendingForwards((operation) => operation.taskId === taskId)
    await cleanupAll(
      [...this.forwards]
        .filter(([, entry]) => entry.taskId === taskId)
        .map(([id]) => this.stopForward(id, taskId)),
    )
  }
  private async closeHost(id: string) {
    for (const operation of this.installs.values())
      if (operation.hostId === id) operation.controller.abort()
    this.hostEpochs.set(id, (this.hostEpochs.get(id) ?? 0) + 1)
    await cleanupAll([
      this.closeHostSessions(id),
      this.cancelPendingForwards((operation) => operation.hostId === id),
      ...[...this.forwards]
        .filter(([, entry]) => entry.hostId === id)
        .map(([key, entry]) => this.stopForward(key, entry.taskId)),
    ])
    await cleanupAll([this.client.closeHost(id)])
  }
  async dispose() {
    this.disposed = true
    for (const operation of this.installs.values()) operation.controller.abort()
    this.epoch++
    this.cancelIncomingInstalls()
    await cleanupAll([
      this.cancelPendingForwards(() => true),
      ...[...this.forwards].map(([id, entry]) => this.stopForward(id, entry.taskId)),
      this.closeAllSessions(),
    ])
    await this.client.dispose()
  }
}
