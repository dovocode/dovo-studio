import { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRuntime } from '../index'
import * as native from '../previews/simulator-native'
import * as discovery from '../previews/devices'
import { DeviceHostClient } from '../previews/device-host-client'
import * as ssh from '../previews/device-host-ssh'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.restoreAllMocks()
})
it('authenticates taskless foreign sessions, isolates paired device/task ownership and revokes streams', async () => {
  const input = vi.fn<native.NativeSimulator['input']>(async () => {})
  const release = vi.fn<native.NativeSimulator['release']>(async () => {})
  const close = vi.fn<native.NativeSimulator['close']>(async () => {})
  vi.spyOn(native, 'iosSimulator').mockResolvedValue({
    input,
    release,
    close,
    start: () => () => {},
  })
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'B',
    diagnostics: [],
    devices: [
      { id: 'ios:device', name: 'B Simulator', state: 'booted', platform: 'ios', runtime: 'iOS' },
    ],
  })
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'owner-test-token',
    port: 0,
  })
  runtime.services.deviceHosts.settings.save({ enabled: true, hosts: [] })
  cleanups.push(() => runtime.close())
  const tokenA = 'paired-token-a',
    tokenB = 'paired-token-b'
  const deviceA = runtime.services.devices.add('A', tokenA)
  runtime.services.devices.add('B', tokenB)
  const call = (path: string, value: unknown, token = tokenA) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
  expect((await call('/api/device-host/devices', { taskId: 'foreign' }, 'bad')).status).toBe(401)
  expect((await call('/api/previews/devices', { taskId: 'foreign' })).status).toBe(404)
  expect((await call('/api/device-host/devices', { taskId: 'foreign' })).status).toBe(200)
  const opened = await (
    await call('/api/device-host/open', { taskId: 'foreign', id: 'ios:device' })
  ).json()
  expect(opened.id).toBeTruthy()
  expect(
    (
      await call(
        '/api/device-host/input',
        { taskId: 'foreign', id: opened.id, input: { type: 'key', key: 'Home' } },
        tokenB,
      )
    ).status,
  ).toBe(403)
  expect(
    (await call('/api/device-host/close', { taskId: 'another-task', id: opened.id })).status,
  ).toBe(403)
  expect(
    (
      await call('/api/device-host/input', {
        taskId: 'foreign',
        id: opened.id,
        input: { type: 'key', key: 'Home' },
      })
    ).status,
  ).toBe(200)
  expect(input).toHaveBeenCalledOnce()
  const socket = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/device-host/simulator?ticket=${opened.ticket}`,
  )
  await once(socket, 'open')
  const replay = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/device-host/simulator?ticket=${opened.ticket}`,
  )
  await expect(once(replay, 'open')).rejects.toThrow('401')
  const disconnected = once(socket, 'close')
  runtime.services.devices.revoke(deviceA)
  expect((await disconnected)[0]).toBe(1008)
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  expect(
    (
      await call('/api/device-host/input', {
        taskId: 'foreign',
        id: opened.id,
        input: { type: 'key', key: 'Home' },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await call(
        '/api/device-host/action',
        { taskId: 'foreign', id: 'remote:other:ios:device', action: 'boot' },
        tokenB,
      )
    ).status,
  ).toBe(400)
})
it('proxies frames and input to an existing paired runtime and closes its remote session', async () => {
  let publish: Parameters<native.NativeSimulator['start']>[0] | undefined
  const release = vi.fn<native.NativeSimulator['release']>(async () => {})
  const close = vi.fn<native.NativeSimulator['close']>(async () => {})
  const input = vi.fn<native.NativeSimulator['input']>(async () => {})
  vi.spyOn(native, 'iosSimulator').mockResolvedValue({
    screenPoints: () => ({ width: 393, height: 852 }),
    start: (frame) => {
      publish = frame
      return () => {}
    },
    release,
    close,
    input,
  })
  const device = {
    id: 'ios:device',
    name: 'B simulator',
    platform: 'ios' as const,
    state: 'booted' as const,
    runtime: 'iOS',
  }
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'B',
    diagnostics: [],
    devices: [device],
  })
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'owner-test-token',
    port: 0,
  })
  runtime.services.deviceHosts.settings.save({ enabled: true, hosts: [] })
  cleanups.push(() => runtime.close())
  const token = 'paired-runtime-a-token'
  runtime.services.devices.add('Runtime A', token)
  const child = new ChildProcess()
  // Replace only the SSH transport: HTTP, pairing checks, tickets and WebSocket framing remain real.
  vi.spyOn(ssh, 'openTunnel').mockResolvedValue({
    child,
    port: runtime.port,
    address: `http://127.0.0.1:${runtime.port}`,
  })
  const stop = vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
  const client = new DeviceHostClient()
  cleanups.push(() => client.dispose())
  const host = {
    id: 'b',
    name: 'B',
    sshHost: 'b',
    sshUser: 'dev',
    sshPort: 22,
    runtimeAddress: `http://127.0.0.1:${runtime.port}`,
    token,
    agentAccess: true,
  }
  const driver = await client.driver(host, 'foreign-task', device)
  expect(driver.screenPoints?.()).toEqual({ width: 393, height: 852 })
  const frames = vi.fn<Parameters<native.NativeSimulator['start']>[0]>()
  const errors = vi.fn<Parameters<native.NativeSimulator['start']>[1]>()
  const detach = driver.start(frames, errors)
  await vi.waitFor(() => expect(publish).toBeDefined())
  publish!({ type: 'frame', width: 393, height: 852, data: Buffer.from('jpeg') })
  await vi.waitFor(() =>
    expect(frames).toHaveBeenCalledWith({
      type: 'frame',
      width: 393,
      height: 852,
      data: Uint8Array.from(Buffer.from('jpeg')),
    }),
  )
  await driver.input({ type: 'text', text: 'hello' })
  expect(input).toHaveBeenCalledWith({ type: 'text', text: 'hello' })
  detach()
  await driver.release()
  await driver.close()
  expect(close).toHaveBeenCalledOnce()
  expect(errors).not.toHaveBeenCalled()
  await client.dispose()
  expect(stop).toHaveBeenCalledOnce()
})

it('routes runtime A discovery/actions/previews to paired runtime B without creating a foreign task', async () => {
  const input = vi.fn<native.NativeSimulator['input']>(async () => {})
  const close = vi.fn<native.NativeSimulator['close']>(async () => {})
  const driver: native.NativeSimulator = {
    input,
    close,
    release: async () => {},
    start: () => () => {},
  }
  vi.spyOn(native, 'iosSimulator').mockResolvedValue(driver)
  const action = vi.spyOn(discovery, 'previewDeviceAction').mockResolvedValue({ ok: true })
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'native',
    diagnostics: [],
    devices: [
      { id: 'ios:device', name: 'Simulator', state: 'booted', platform: 'ios', runtime: 'iOS' },
    ],
  })
  const remote = await startRuntime({ databasePath: ':memory:', ownerToken: 'owner-b', port: 0 })
  const local = await startRuntime({ databasePath: ':memory:', ownerToken: 'owner-a', port: 0 })
  cleanups.push(
    () => local.close(),
    () => remote.close(),
  )
  remote.services.deviceHosts.settings.save({ enabled: true, hosts: [] })
  const pairedToken = 'paired-a-on-b'
  remote.services.devices.add('Runtime A', pairedToken)
  const openTunnel = vi.spyOn(ssh, 'openTunnel').mockResolvedValue({
    child: new ChildProcess(),
    port: remote.port,
    address: `http://127.0.0.1:${remote.port}`,
  })
  vi.spyOn(ssh, 'stopSsh').mockResolvedValue()
  local.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'local-task',
        title: 'Test',
        repositoryId: '',
        agentId: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  const call = (path: string, value: unknown) =>
    fetch(`http://127.0.0.1:${local.port}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-a', 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
  const host = {
    id: 'b',
    name: 'Runtime B',
    sshHost: 'b.local',
    sshUser: 'developer',
    sshPort: 22,
    runtimeAddress: `http://127.0.0.1:${remote.port}`,
    token: pairedToken,
    agentAccess: true,
  }
  const saved = await call('/api/device-hosts', {
    revision: 0,
    enabled: true,
    hosts: [host],
    defaultHostId: 'b',
  })
  expect(saved.status).toBe(200)
  const publicSettings = await saved.json()
  expect(publicSettings.hosts[0]).toMatchObject({ hasToken: true, id: 'b' })
  expect(JSON.stringify(publicSettings)).not.toContain(pairedToken)
  const listed = await (await call('/api/previews/devices', { taskId: 'local-task' })).json()
  expect(listed.devices.map((device: { id: string }) => device.id)).toEqual([
    'ios:device',
    'remote:b:ios:device',
  ])
  expect(listed.devices[1]).toMatchObject({ hostId: 'b', hostName: 'Runtime B' })
  expect(
    (
      await call('/api/previews/action', {
        taskId: 'local-task',
        id: 'remote:b:ios:device',
        action: 'boot',
      })
    ).status,
  ).toBe(200)
  expect(action).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'ios:device', taskId: expect.stringContaining('device-host:') }),
  )
  const opened = await (
    await call('/api/previews/simulator/open', {
      taskId: 'local-task',
      id: 'ios:device',
      hostId: 'b',
    })
  ).json()
  expect(opened.device.id).toBe('remote:b:ios:device')
  expect(
    (
      await call('/api/previews/simulator/input', {
        taskId: 'local-task',
        id: opened.id,
        input: { type: 'text', text: 'cross runtime' },
      })
    ).status,
  ).toBe(200)
  expect(input).toHaveBeenCalledWith({ type: 'text', text: 'cross runtime' })
  expect(remote.services.store.get().tasks).toEqual([])
  expect(openTunnel).toHaveBeenCalledOnce()
  expect((await call('/api/device-hosts/remove', { id: 'b' })).status).toBe(200)
  expect(close).toHaveBeenCalledOnce()
  expect(
    (
      await call('/api/previews/simulator/input', {
        taskId: 'local-task',
        id: opened.id,
        input: { type: 'key', key: 'Home' },
      })
    ).status,
  ).toBe(404)
})

it('defaults Device Hub off, requires destination opt-in and disables helpers without stopping devices', async () => {
  const closed = vi.fn<native.NativeSimulator['close']>(async () => {})
  const create = vi.spyOn(native, 'iosSimulator').mockResolvedValue({
    input: async () => {},
    close: closed,
    release: async () => {},
    start: () => () => {},
  })
  const devices = vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'B',
    diagnostics: [],
    devices: [
      { id: 'ios:device', name: 'Simulator', platform: 'ios', state: 'booted', runtime: 'iOS' },
    ],
  })
  const action = vi.spyOn(discovery, 'previewDeviceAction')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: 'hub-owner', port: 0 })
  cleanups.push(() => runtime.close())
  const token = 'paired-device-token'
  runtime.services.devices.add('A', token)
  const call = (path: string, value: unknown, agent = false) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(agent ? { 'X-Dovo-Agent-Access': '1' } : {}),
      },
      body: JSON.stringify(value),
    })
  expect(runtime.services.deviceHosts.settings.public()).toMatchObject({
    enabled: false,
    revision: 0,
  })
  expect((await call('/api/device-host/devices', { taskId: 'foreign' })).status).toBe(403)
  expect(
    (await call('/api/device-host/open', { taskId: 'foreign', id: 'ios:device' })).status,
  ).toBe(403)
  expect(devices).not.toHaveBeenCalled()
  expect((await call('/api/device-hosts', { hosts: [], enabled: true }, true)).status).toBe(403)
  const host = {
    id: 'b',
    name: 'B',
    sshHost: 'b',
    sshUser: 'dev',
    sshPort: 22,
    runtimeAddress: 'http://127.0.0.1:4317',
    token: 'remote-secret',
    agentAccess: false,
  }
  const enabled = await (
    await call('/api/device-hosts', { enabled: true, hosts: [host], revision: 0 })
  ).json()
  expect(enabled.enabled).toBe(true)
  const opened = await (
    await call('/api/device-host/open', { taskId: 'foreign', id: 'ios:device' })
  ).json()
  expect(opened.id).toBeTruthy()
  expect(create).toHaveBeenCalledOnce()
  expect((await call('/api/device-hosts', { ...enabled, enabled: false })).status).toBe(200)
  expect(closed).toHaveBeenCalledOnce()
  expect(action).not.toHaveBeenCalled()
  const disabled = runtime.services.deviceHosts.settings.public()
  expect(disabled).toMatchObject({ enabled: false, hosts: [{ id: 'b', hasToken: true }] })
  expect((await call('/api/device-host/devices', { taskId: 'foreign' })).status).toBe(403)
  expect((await call('/api/device-hosts', { ...enabled, enabled: true })).status).toBe(409)
  expect((await call('/api/device-hosts', { ...disabled, enabled: true })).status).toBe(200)
  expect(
    (await call('/api/device-host/open', { taskId: 'foreign', id: 'ios:device' })).status,
  ).toBe(200)
  expect(create).toHaveBeenCalledTimes(2)
})

it('checks requested phone-network forwarding with paired authentication and a bounded port', async () => {
  const { createServer } = await import('node:net')
  const { networkInterfaces } = await import('node:os')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'network-forward-owner',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test port unavailable')
  const call = (port: number, token = 'network-forward-owner') =>
    fetch(`http://127.0.0.1:${runtime.port}/api/device-host/forward/check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'foreign-task', port }),
    })
  expect((await call(address.port, 'bad')).status).toBe(401)
  expect((await call(address.port)).status).toBe(403)
  runtime.services.deviceHosts.settings.save({ enabled: true, hosts: [] })
  expect((await call(0)).status).toBe(400)
  const hasNetwork = Object.values(networkInterfaces()).some((entries) =>
    entries?.some((entry) => !entry.internal && entry.family === 'IPv4'),
  )
  expect((await call(address.port)).status).toBe(hasNetwork ? 200 : 409)
})

it('opens local previews without waiting for remote discovery', async () => {
  vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'A',
    diagnostics: [],
    devices: [
      {
        id: 'ios:local',
        name: 'Local',
        platform: 'ios',
        state: 'booted',
        runtime: 'iOS',
      },
    ],
  })
  vi.spyOn(native, 'iosSimulator').mockResolvedValue({
    input: async () => {},
    release: async () => {},
    close: async () => {},
    start: () => () => {},
  })
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'local-preview-owner',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  runtime.services.deviceHosts.settings.save({ enabled: true, hosts: [] })
  const remote = vi
    .spyOn(runtime.services.deviceHosts, 'list')
    .mockRejectedValue(new Error('Unreachable remote host'))
  await expect(runtime.services.simulators.open('task', 'ios:local')).resolves.toMatchObject({
    device: { id: 'ios:local' },
  })
  expect(remote).not.toHaveBeenCalled()
})

it.skipIf(process.platform === 'win32')(
  'cancels incoming native installation when the destination hub is disabled',
  async () => {
    const { mkdtemp, writeFile, stat, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'dovo-native-cancel-'))
    const marker = join(root, 'started'),
      adb = join(root, 'adb')
    await writeFile(adb, '#!/bin/sh\nprintf ready > "$DOVO_TEST_INSTALL_MARKER"\nexec sleep 30\n', {
      mode: 0o700,
    })
    vi.stubEnv('DOVO_TEST_INSTALL_MARKER', marker)
    vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
      host: 'B',
      diagnostics: [],
      devices: [
        {
          id: 'physical-android:serial',
          name: 'Phone',
          kind: 'physical',
          platform: 'android',
          state: 'booted',
          runtime: 'serial',
        },
      ],
    })
    vi.spyOn(discovery, 'androidTool').mockResolvedValue(adb)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'cancel-owner',
      port: 0,
    })
    runtime.services.deviceHosts.settings.save({ enabled: true, hosts: [] })
    const token = 'cancel-paired'
    runtime.services.devices.add('source', token)
    const call = (path: string, value: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })
    try {
      const upload = await (
        await call('/api/device-host/upload', { taskId: 'foreign', extension: '.apk' })
      ).json()
      await writeFile(upload.path, 'APK')
      const installing = call('/api/device-host/install', {
        taskId: 'foreign',
        id: 'physical-android:serial',
        uploadId: upload.id,
      })
      await vi.waitFor(async () => expect((await stat(marker)).isFile()).toBe(true), {
        timeout: 3000,
      })
      await runtime.services.deviceHosts.save({
        ...runtime.services.deviceHosts.settings.get(),
        enabled: false,
      })
      const response = await installing
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('cancelled') })
      await expect(stat(upload.path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await runtime.close()
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
)
