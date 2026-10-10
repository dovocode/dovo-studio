import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, deviceHostSchema, deviceHostSettingsResultSchema } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { DeviceHostSettings } from './device-host-settings'
import {
  DeviceHosts,
  splitDeviceId,
  foreignDeviceScope,
  assertForeignDeviceScope,
} from './device-hosts'
import { sshArgs } from './device-host-ssh'
import { validateArtifact, DeviceHostUploads } from './device-host-install'
const host = {
  id: 'mac',
  name: 'Mac',
  sshHost: 'mac.local',
  sshUser: 'developer',
  sshPort: 22,
  identityFile: '/keys/private key',
  runtimeAddress: 'http://127.0.0.1:4317',
  token: 'paired-secret',
  agentAccess: true,
}
afterEach(() => vi.restoreAllMocks())
it('validates key-only SSH options without interpolating identity paths or accepting option injection', () => {
  expect(sshArgs(host)).toContain('BatchMode=yes')
  expect(sshArgs(host)).toContain('PasswordAuthentication=no')
  expect(sshArgs(host)).toContain('StrictHostKeyChecking=yes')
  expect(sshArgs(host)).toContain('/keys/private key')
  expect(sshArgs(host)).toContain('IdentitiesOnly=yes')
  expect(() => decode(deviceHostSchema, { ...host, sshHost: '-oProxyCommand=evil' })).toThrow(Error)
  expect(() => decode(deviceHostSchema, { ...host, sshUser: 'user;evil' })).toThrow(Error)
  expect(() =>
    decode(deviceHostSchema, { ...host, runtimeAddress: 'http://user:secret@remote' }),
  ).toThrow(Error)
  expect(() => decode(deviceHostSchema, { ...host, runtimeAddress: 'ftp://remote' })).toThrow(Error)
  expect(decode(deviceHostSchema, host).runtimeAddress).toBe(host.runtimeAddress)
})
it('persists runtime-private tokens, omits them from public responses and preserves omitted tokens on edit', () => {
  const db = openDatabase(':memory:')
  try {
    const settings = new DeviceHostSettings(db)
    settings.save({ hosts: [host], defaultHostId: host.id })
    expect(JSON.stringify(settings.public())).not.toContain(host.token)
    expect(decode(deviceHostSettingsResultSchema, settings.public()).hosts[0].hasToken).toBe(true)
    const { token: _token, ...publicHost } = host
    settings.save({ hosts: [{ ...publicHost, name: 'Renamed' }], defaultHostId: host.id })
    expect(new DeviceHostSettings(db).get().hosts[0].token).toBe(host.token)
    expect(() => settings.save({ hosts: [host, host] })).toThrow('unique')
    expect(() => settings.save({ hosts: [host], defaultHostId: 'missing' })).toThrow(
      'not configured',
    )
    settings.save({ hosts: [{ ...host, token: '' }] })
    expect(settings.public().hosts[0].hasToken).toBe(false)
    settings.remove(host.id)
    expect(settings.get()).toMatchObject({ hosts: [], enabled: false })
  } finally {
    db.close()
  }
})
it('routes namespaced devices and explicit host selection while preserving ownership boundaries', async () => {
  const db = openDatabase(':memory:')
  const close = vi.fn<(id: string) => Promise<void>>(async () => {})
  const manager = new DeviceHosts(db, close)
  try {
    await manager.save({ enabled: true, hosts: [host] })
    const request = vi.spyOn(manager.client, 'request').mockResolvedValue({ ok: true })
    await manager.action({ taskId: 'foreign', id: 'remote:mac:ios:device', action: 'boot' })
    expect(request).toHaveBeenCalledWith(host, '/api/device-host/action', {
      taskId: 'foreign',
      id: 'ios:device',
      action: 'boot',
      hostId: undefined,
    })
    expect(manager.deviceId('ios:device', 'mac')).toBe('remote:mac:ios:device')
    expect(splitDeviceId('ios:device')).toEqual({ id: 'ios:device', hostId: undefined })
    expect(() => splitDeviceId('remote:mac:ios:device', 'other')).toThrow('does not match')
    const scope = foreignDeviceScope('paired-a', 'foreign')
    expect(() => assertForeignDeviceScope(scope, 'paired-a')).not.toThrow()
    expect(() => assertForeignDeviceScope(scope, 'paired-b')).toThrow('another paired device')
    expect(scope).not.toBe(foreignDeviceScope('paired-a', 'different'))
    await manager.save({ hosts: [{ ...host, agentAccess: false }] })
    expect(close).toHaveBeenCalledWith('mac')
    await expect(
      manager.action({ taskId: 'foreign', id: 'remote:mac:ios:device', action: 'boot' }, true),
    ).rejects.toThrow('Agent access')
  } finally {
    await manager.dispose()
    db.close()
  }
})
it('limits installation to checked task artifacts and rejects symlinks and foreign staging ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-artifact-test-'))
  const uploads = new DeviceHostUploads()
  try {
    const checkout = join(root, 'checkout')
    await mkdir(checkout)
    await writeFile(join(checkout, 'app.apk'), 'apk')
    await writeFile(join(root, 'outside.apk'), 'outside')
    await expect(validateArtifact('app.apk', checkout)).resolves.toMatchObject({
      extension: '.apk',
      directory: false,
    })
    await expect(validateArtifact('../outside.apk', checkout)).rejects.toThrow(
      'inside the task checkout',
    )
    await mkdir(join(checkout, 'native.app'))
    await symlink(join(root, 'outside.apk'), join(checkout, 'native.app', 'escape'))
    await expect(validateArtifact('native.app', checkout)).rejects.toThrow('symlink')
    const staged = await uploads.create('paired-a:task', '.apk')
    await expect(uploads.remove(staged.id, 'paired-b:task')).rejects.toThrow(
      'another paired device or task',
    )
    await uploads.remove(staged.id, 'paired-a:task')
    await expect(uploads.install(staged.id, 'paired-a:task', 'ios:device')).rejects.toThrow(
      'expired',
    )
  } finally {
    await uploads.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('keeps reverse forwards task-owned and bounded, and waits for SSH to confirm the port bind', async () => {
  const { ChildProcess } = await import('node:child_process')
  const { PassThrough } = await import('node:stream')
  const ssh = await import('./device-host-ssh')
  const child = new ChildProcess()
  child.stderr = new PassThrough()
  const ready = ssh.readyReverseForward(child)
  child.stderr.emit(
    'data',
    Buffer.from(
      'debug1: remote forward success for: listen 127.0.0.1:3000, connect 127.0.0.1:3000\n',
    ),
  )
  await expect(ready).resolves.toBeUndefined()
  const failing = new ChildProcess()
  failing.stderr = new PassThrough()
  const failed = ssh.readyReverseForward(failing)
  failing.emit('exit', 255, null)
  await expect(failed).rejects.toThrow('reverse forwarding failed')
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    await manager.save({ enabled: true, hosts: [host] })
    vi.spyOn(manager.client, 'request').mockResolvedValue({
      host: 'B',
      devices: [],
      diagnostics: [],
    })
    vi.spyOn(ssh, 'startSsh').mockReturnValue(child)
    vi.spyOn(ssh, 'readyReverseForward').mockResolvedValue()
    const stopped = vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
    const forward = await manager.forward({
      taskId: 'task-a',
      hostId: 'mac',
      localPort: 3000,
      remotePort: 4000,
      durationSeconds: 1,
    })
    expect(forward.url).toBe('http://127.0.0.1:4000')
    expect(ssh.startSsh).toHaveBeenCalledWith(host, '127.0.0.1:4000:localhost:3000', true, true)
    await expect(manager.stopForward(forward.id, 'task-b')).rejects.toThrow('another task')
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce(), { timeout: 2000 })
    await expect(manager.stopForward(forward.id, 'task-a')).resolves.toEqual({ ok: true })
  } finally {
    await manager.dispose()
    db.close()
  }
})

it('requires explicit phone network exposure and verifies the destination bind', async () => {
  const ssh = await import('./device-host-ssh')
  const { ChildProcess } = await import('node:child_process')
  const child = new ChildProcess()
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    await manager.save({ enabled: true, hosts: [host] })
    const request = vi
      .spyOn(manager.client, 'request')
      .mockResolvedValue({ host: 'B', devices: [], diagnostics: [] })
    vi.spyOn(ssh, 'startSsh').mockReturnValue(child)
    vi.spyOn(ssh, 'readyReverseForward').mockResolvedValue()
    vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
    const result = await manager.forward({
      taskId: 'task',
      hostId: 'mac',
      localPort: 8081,
      remotePort: 8081,
      exposeToNetwork: true,
    })
    expect(ssh.startSsh).toHaveBeenCalledWith(host, '0.0.0.0:8081:localhost:8081', true, true)
    expect(request).toHaveBeenCalledWith(
      host,
      '/api/device-host/forward/check',
      {
        taskId: 'task',
        port: 8081,
      },
      expect.any(AbortSignal),
    )
    expect(result.url).toBe('http://mac.local:8081')
    await manager.stopForward(result.id, 'task')
  } finally {
    await manager.dispose()
    db.close()
  }
})

it('cancels staged installs when Device Hub is disabled before transfer', async () => {
  const staging = await import('./device-artifact-staging')
  const root = await mkdtemp(join(tmpdir(), 'dovo-cancel-install-'))
  await writeFile(join(root, 'app.apk'), 'apk')
  const artifact = await staging.stageDeviceArtifact('app.apk', root)
  let resolveStage: (value: typeof artifact) => void = () => {
    throw new Error('Stage is not pending')
  }
  const pendingStage = new Promise<typeof artifact>((resolve) => {
    resolveStage = resolve
  })
  vi.spyOn(staging, 'stageDeviceArtifact').mockReturnValue(pendingStage)
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    await manager.save({ enabled: true, hosts: [host] })
    const request = vi.spyOn(manager.client, 'request').mockResolvedValue({ ok: true })
    const install = manager.install(
      { taskId: 'task', id: 'remote:mac:android:avd', artifactPath: 'app.apk' },
      root,
    )
    const outcome = install.catch((error: unknown) => error)
    await manager.save({ ...manager.settings.get(), enabled: false })
    resolveStage(artifact)
    await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('cancelled') })
    expect(request).not.toHaveBeenCalled()
    await expect(stat(artifact.file)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await manager.dispose()
    db.close()
    await artifact.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('aborts artifact transfer on task cleanup and never sends the install command', async () => {
  const ssh = await import('./device-host-ssh')
  const root = await mkdtemp(join(tmpdir(), 'dovo-cancel-transfer-'))
  await writeFile(join(root, 'app.apk'), 'apk')
  let resolveCopy: () => void = () => {
    throw new Error('Transfer not pending')
  }
  const pendingCopy = new Promise<void>((resolve) => {
    resolveCopy = resolve
  })
  const copy = vi.spyOn(ssh, 'copyArtifact').mockReturnValue(pendingCopy)
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    await manager.save({ enabled: true, hosts: [host] })
    const request = vi
      .spyOn(manager.client, 'request')
      .mockImplementation(async (_host, path) =>
        path === '/api/device-host/upload'
          ? { id: 'upload', path: '/tmp/dovo-device-host-test/artifact.apk' }
          : { ok: true },
      )
    const install = manager.install(
      { taskId: 'task', id: 'remote:mac:android:avd', artifactPath: 'app.apk' },
      root,
    )
    const outcome = install.catch((error: unknown) => error)
    await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce())
    const signal = copy.mock.calls[0][4]
    expect(signal?.aborted).toBe(false)
    await manager.closeTask('task')
    expect(signal?.aborted).toBe(true)
    resolveCopy()
    await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('cancelled') })
    expect(request.mock.calls.map((call) => call[1])).not.toContain('/api/device-host/install')
    // Cancelled work must not reopen SSH solely for best-effort cleanup; destination staging expires.
    expect(request.mock.calls.map((call) => call[1])).not.toContain(
      '/api/device-host/upload/remove',
    )
  } finally {
    await manager.dispose()
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('accepts safe temporary staging paths with spaces/dots and rejects escapes', async () => {
  const { deviceArtifactDestination } = await import('./device-host-ssh')
  expect(deviceArtifactDestination('/tmp/custom.folder/dovo-device-host-abc/artifact.app')).toBe(
    '/tmp/custom.folder/dovo-device-host-abc/artifact.app',
  )
  expect(
    deviceArtifactDestination(
      'C:\\Users\\Developer Name\\AppData\\Local\\Temp\\dovo-device-host-abc\\artifact.apk',
    ),
  ).toBe('C:/Users/Developer Name/AppData/Local/Temp/dovo-device-host-abc/artifact.apk')
  for (const path of [
    '/tmp/../dovo-device-host-abc/artifact.apk',
    '/tmp/dovo-device-host-abc/file.apk',
    '/tmp/dovo-device-host-abc/artifact.apk;command',
    'relative/dovo-device-host-abc/artifact.apk',
  ])
    expect(() => deviceArtifactDestination(path)).toThrow('unsafe')
})

it('rejects connection edits that would silently lose pairing and preserves the revision', () => {
  const db = openDatabase(':memory:')
  try {
    const settings = new DeviceHostSettings(db)
    settings.save({ hosts: [host] })
    const before = settings.public()
    expect(() =>
      settings.save({ ...before, hosts: [{ ...before.hosts[0], sshPort: 2222 }] }),
    ).toThrow('Select a paired destination')
    expect(settings.public()).toEqual(before)
    settings.save({
      ...before,
      hosts: [{ ...before.hosts[0], sshPort: 2222, token: 'new-pairing' }],
    })
    expect(settings.get().hosts[0].token).toBe('new-pairing')
  } finally {
    db.close()
  }
})

it('allows saving connection-ready hosts without a live-preview device', async () => {
  const ssh = await import('./device-host-ssh')
  const { DeviceHostClient } = await import('./device-host-client')
  vi.spyOn(ssh, 'testSsh').mockResolvedValue()
  vi.spyOn(DeviceHostClient.prototype, 'request').mockResolvedValue({
    host: 'B',
    diagnostics: [],
    devices: [],
  })
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    const result = await manager.test(host)
    expect(result.ok).toBe(true)
    expect(result.checks).toContainEqual(expect.objectContaining({ name: 'devices', ok: false }))
    const missing = await manager.test({ ...host, token: undefined })
    expect(missing.ok).toBe(false)
    expect(missing.checks).toContainEqual(expect.objectContaining({ name: 'pairing', ok: false }))
  } finally {
    await manager.dispose()
    db.close()
  }
})

it('stops forwards and tunnels even when host preview cleanup fails, and keeps renames harmless', async () => {
  const ssh = await import('./device-host-ssh')
  const { ChildProcess } = await import('node:child_process')
  const close = vi
    .fn<(id: string) => Promise<void>>()
    .mockRejectedValue(new Error('Preview unavailable'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, close)
  try {
    await manager.save({ enabled: true, hosts: [host] })
    vi.spyOn(manager.client, 'request').mockResolvedValue({ ok: true })
    vi.spyOn(ssh, 'startSsh').mockReturnValue(new ChildProcess())
    vi.spyOn(ssh, 'readyReverseForward').mockResolvedValue()
    const stop = vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
    const tunnel = vi.spyOn(manager.client, 'closeHost').mockResolvedValue()
    await manager.forward({ taskId: 'task', hostId: host.id, localPort: 3000, remotePort: 4000 })
    await manager.save({ ...manager.settings.get(), hosts: [{ ...host, name: 'Renamed' }] })
    expect(stop).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    await manager.remove(host.id)
    expect(stop).toHaveBeenCalledOnce()
    expect(tunnel).toHaveBeenCalledWith(host.id)
  } finally {
    await manager.dispose()
    db.close()
  }
})

it('reserves forward slots before startup and cancels starting SSH children when disabled', async () => {
  const ssh = await import('./device-host-ssh')
  const { ChildProcess } = await import('node:child_process')
  let ready = () => {}
  const gate = new Promise<void>((resolve) => {
    ready = resolve
  })
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    await manager.save({ enabled: true, hosts: [host] })
    vi.spyOn(manager.client, 'request').mockResolvedValue({ ok: true })
    vi.spyOn(ssh, 'startSsh').mockImplementation(() => new ChildProcess())
    vi.spyOn(ssh, 'readyReverseForward').mockImplementation(() => gate)
    const stop = vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
    const attempts = Array.from({ length: 21 }, (_, index) =>
      manager.forward({
        taskId: 'task',
        hostId: host.id,
        localPort: 3000,
        remotePort: 4000 + index,
      }),
    )
    const completed = Promise.allSettled(attempts)
    await vi.waitFor(() => expect(ssh.startSsh).toHaveBeenCalledTimes(20))
    await manager.save({ ...manager.settings.get(), enabled: false })
    expect(stop).toHaveBeenCalledTimes(20)
    ready()
    const results = await completed
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    const last = results[20]
    expect(last.status).toBe('rejected')
    expect(last).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining('maximum 20') }),
    })
  } finally {
    ready()
    await manager.dispose()
    db.close()
  }
})

it('notifies cleanup when provisional pairing expires', async () => {
  const { Devices } = await import('../auth/devices')
  const db = openDatabase(':memory:')
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const revoked = vi.fn<(id: string) => void>()
  try {
    const devices = new Devices(db, 'owner', revoked)
    const id = devices.add('provisional', 'temporary-token', 100)
    expect(devices.authenticate('temporary-token').id).toBe(id)
    now += 101
    expect(() => devices.authenticate('temporary-token')).toThrow('authentication required')
    expect(revoked).toHaveBeenCalledExactlyOnceWith(id)
  } finally {
    db.close()
  }
})

it('supports older device hosts without lightweight readiness and lists task-owned forwards', async () => {
  const ssh = await import('./device-host-ssh')
  const { HttpError } = await import('../errors')
  const { ChildProcess } = await import('node:child_process')
  const db = openDatabase(':memory:')
  const manager = new DeviceHosts(db, async () => {})
  try {
    await manager.save({ enabled: true, hosts: [{ ...host, agentAccess: false }] })
    const request = vi
      .spyOn(manager.client, 'request')
      .mockRejectedValueOnce(new HttpError(404, 'Device host endpoint not found'))
      .mockResolvedValue({ host: 'B', devices: [], diagnostics: [] })
    vi.spyOn(ssh, 'startSsh').mockReturnValue(new ChildProcess())
    vi.spyOn(ssh, 'readyReverseForward').mockResolvedValue()
    vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
    const forward = await manager.forward({
      taskId: 'task',
      hostId: host.id,
      localPort: 3000,
      remotePort: 4000,
    })
    expect(request.mock.calls.map((call) => call[1])).toEqual([
      '/api/device-host/ready',
      '/api/device-host/devices',
    ])
    expect(manager.listForwards('task').forwards).toMatchObject([
      { id: forward.id, hostId: host.id, localPort: 3000, remotePort: 4000 },
    ])
    expect(manager.listForwards('other-task').forwards).toEqual([])
    expect(manager.listForwards('task', true).forwards).toEqual([])
    await expect(manager.stopForward(forward.id, 'task', true)).rejects.toThrow(
      'Agent access is disabled',
    )
    await manager.stopForward(forward.id, 'task')
    expect(manager.listForwards('task').forwards).toEqual([])
  } finally {
    await manager.dispose()
    db.close()
  }
})
