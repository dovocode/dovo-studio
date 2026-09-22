import { afterEach, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRuntime } from '../index'
import * as native from '../previews/simulator-native'
import * as discovery from '../previews/devices'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.restoreAllMocks()
})
it('authorizes task/device access, isolates tickets and releases input when a viewing device is revoked', async () => {
  const stop = vi.fn<() => void>(),
    release = vi.fn<native.NativeSimulator['release']>(async () => {}),
    close = vi.fn<native.NativeSimulator['close']>(async () => {}),
    input = vi.fn<native.NativeSimulator['input']>(async () => {})
  const driver: native.NativeSimulator = {
    start: vi.fn<native.NativeSimulator['start']>(() => stop),
    release,
    close,
    input,
  }
  const create = vi.spyOn(native, 'iosSimulator').mockResolvedValue(driver)
  const list = vi.spyOn(discovery, 'previewDevices').mockResolvedValue({
    host: 'qa',
    diagnostics: [],
    devices: [{ id: 'ios:qa', name: 'QA', platform: 'ios', state: 'booted', runtime: 'iOS' }],
  })
  const token = 'simulator-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const call = (taskId: string, id = 'ios:qa', credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/simulator/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, id }),
    })
  expect((await call('task', 'ios:qa', 'bad')).status).toBe(401)
  expect((await call('missing')).status).toBe(404)
  expect(list).not.toHaveBeenCalled()
  runtime.services.store.update((w) => ({
    ...w,
    tasks: [
      {
        id: 'task',
        title: 'QA',
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
  expect((await call('task', 'ios:not-discovered')).status).toBe(404)
  expect(create).not.toHaveBeenCalled()
  const deviceToken = 'simulator-viewer-token-at-least-thirty-two-characters'
  const deviceId = runtime.services.devices.add('QA viewer', deviceToken)
  const opened = await (await call('task', 'ios:qa', deviceToken)).json()
  const url = `ws://127.0.0.1:${runtime.port}/ws/simulator?ticket=${opened.ticket}`
  const socket = new WebSocket(url)
  await once(socket, 'open')
  const replay = new WebSocket(url)
  await expect(once(replay, 'open')).rejects.toThrow('401')
  const cross = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/simulator?ticket=${runtime.services.browserTickets.issue(token, 'task')}`,
  )
  await expect(once(cross, 'open')).rejects.toThrow('401')
  socket.send(JSON.stringify({ type: 'key', key: 'Home' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledWith({ type: 'key', key: 'Home' }))
  const disconnected = once(socket, 'close')
  runtime.services.devices.revoke(deviceId)
  expect((await disconnected)[0]).toBe(1008)
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  expect(stop).toHaveBeenCalledOnce()
  await runtime.services.simulators.closeDevice('task', 'ios:qa')
  expect(close).toHaveBeenCalledOnce()
})
