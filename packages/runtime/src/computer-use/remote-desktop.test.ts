import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import sharp from 'sharp'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  decode,
  remoteDesktopRequestSchema,
  runtimePreferencesSchema,
  taskSchema,
} from '@dovo/protocol'
import { RemoteDesktop, type DesktopDriver } from './remote-desktop.js'
import { startRuntime } from '../index.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture() {
  const png = await sharp({
    create: { width: 200, height: 100, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer()
  let enabled = true
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const call = vi.fn<DesktopDriver['call']>(
    async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
      calls.push({ name, args })
      return name === 'get_desktop_state'
        ? {
            content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }],
            structuredContent: { capture_id: 'native-capture' },
          }
        : { content: [] }
    },
  )
  const close = vi.fn<DesktopDriver['close']>(async () => {})
  const connect = vi.fn<() => Promise<DesktopDriver>>(async () => ({ call, close }))
  const isLocked = vi.fn<() => Promise<boolean>>(async () => false)
  const desktop = new RemoteDesktop(
    () => enabled,
    () => '',
    () => {},
    () => {},
    connect,
    isLocked,
  )
  cleanup.push(() => desktop.dispose())
  const id = randomUUID()
  const request = (value: unknown, device = 'device') =>
    desktop.request(decode(remoteDesktopRequestSchema, value), device, device, () => {})
  const start = () => request({ action: 'start', id })
  return {
    desktop,
    id,
    request,
    start,
    calls,
    call,
    close,
    connect,
    isLocked,
    disable: () => {
      enabled = false
    },
  }
}
it('defaults off and blocks native capture while disabled', async () => {
  expect(decode(runtimePreferencesSchema, {}).enableRemoteDesktop).toBe(false)
  const f = await fixture()
  f.disable()
  await expect(f.start()).rejects.toThrow('disabled')
  expect(f.connect).not.toHaveBeenCalled()
})
it('starts view-only, binds pixels to a native capture and never accepts another viewer’s input', async () => {
  const f = await fixture()
  const started = await f.start()
  expect(started.session?.control).toBe(false)
  expect(started.frame?.width).toBe(200)
  const input = {
    action: 'input',
    id: f.id,
    requestId: randomUUID(),
    frameId: started.frame!.id,
    input: { type: 'click', x: 150, y: 50, button: 'right', count: 2 },
  }
  await expect(f.request(input)).rejects.toThrow('Enable control')
  await expect(
    f.request({ action: 'control', id: f.id, enabled: true }, 'another'),
  ).rejects.toThrow('another device')
  await f.request({ action: 'control', id: f.id, enabled: true })
  await f.request(input)
  expect(f.calls.find((call) => call.name === 'click')?.args).toMatchObject({
    target: { kind: 'desktop', display_id: 'primary' },
    capture_id: 'native-capture',
    x: 150,
    y: 50,
    button: 'right',
    count: 2,
  })
  await expect(f.request(input)).rejects.toThrow('already attempted')
  expect(f.calls.filter((call) => call.name === 'click')).toHaveLength(1)
})
it('preserves key modifiers, maps native drag/move and returns a new frame after input', async () => {
  const f = await fixture()
  let response = await f.start()
  await f.request({ action: 'control', id: f.id, enabled: true })
  for (const input of [
    { type: 'key', key: 'a', modifiers: ['ctrl'] },
    { type: 'drag', x: 1, y: 2, toX: 30, toY: 40 },
    { type: 'move', x: 3, y: 4 },
    { type: 'text', text: 'Hallo world' },
    { type: 'scroll', direction: 'down', amount: 3 },
  ]) {
    response = await f.request({
      action: 'input',
      id: f.id,
      requestId: randomUUID(),
      frameId: response.frame!.id,
      input,
    })
    expect(response.frame?.image).toMatch(/^data:image\/jpeg;base64,/)
  }
  expect(f.calls.find((call) => call.name === 'press_key')?.args).toMatchObject({
    key: 'a',
    modifiers: ['ctrl'],
  })
  expect(f.calls.find((call) => call.name === 'drag')?.args).toMatchObject({
    from_x: 1,
    from_y: 2,
    to_x: 30,
    to_y: 40,
  })
  expect(f.calls.find((call) => call.name === 'move_cursor')?.args).toMatchObject({ x: 3, y: 4 })
})
it('rejects stale/outside coordinates and drops native input after flag revocation', async () => {
  const f = await fixture()
  const first = await f.start()
  await f.request({ action: 'control', id: f.id, enabled: true })
  const next = await f.request({ action: 'frame', id: f.id })
  const action = {
    action: 'input',
    id: f.id,
    requestId: randomUUID(),
    frameId: first.frame!.id,
    input: { type: 'click', x: 1, y: 2, button: 'left', count: 1 },
  }
  await expect(f.request(action)).rejects.toThrow('stale')
  await expect(
    f.request({ ...action, frameId: next.frame!.id, input: { ...action.input, x: 200 } }),
  ).rejects.toThrow('outside')
  f.disable()
  await expect(f.request({ ...action, frameId: next.frame!.id })).rejects.toThrow('disabled')
  expect(f.calls.some((call) => call.name === 'click')).toBe(false)
})
it('reserves a single session during slow connection and confirms stop before a late start can return', async () => {
  const f = await fixture()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  f.connect.mockImplementationOnce(async () => {
    await blocked
    return { call: f.call, close: f.close }
  })
  const starting = f.start()
  await Promise.resolve()
  await Promise.resolve()
  await expect(f.request({ action: 'start', id: randomUUID() }, 'other')).rejects.toThrow(
    'Another desktop',
  )
  const stopped = f.request({ action: 'stop', id: f.id })
  release()
  await expect(starting).rejects.toThrow('ended')
  await stopped
  expect(f.desktop.status()).toBeNull()
  expect(f.close).toHaveBeenCalledOnce()
})
it('rechecks credentials after asynchronous driver connection', async () => {
  const f = await fixture()
  let authorized = true
  f.connect.mockImplementationOnce(async () => {
    authorized = false
    return { call: f.call, close: f.close }
  })
  await expect(
    f.desktop.request({ action: 'start', id: f.id }, 'device', 'Device', () => {
      if (!authorized) throw Error('Revoked device')
    }),
  ).rejects.toThrow('Revoked')
  expect(f.calls.some((call) => call.name === 'get_desktop_state')).toBe(false)
})
it('expires abandoned sessions and allows any paired human client to stop sharing', async () => {
  vi.useFakeTimers()
  const f = await fixture()
  await f.start()
  await f.request({ action: 'stop', id: f.id }, 'local-host')
  expect(f.desktop.status()).toBeNull()
  await f.start()
  await vi.advanceTimersByTimeAsync(31000)
  expect(f.desktop.status()).toBeNull()
  expect(f.close).toHaveBeenCalledTimes(2)
})
it('serves paired HTTP clients, advertises capability, enforces the flag and never records typed text', async () => {
  const token = 'remote-desktop-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  const f = await fixture()
  await runtime.services.remoteDesktop.dispose()
  runtime.services.remoteDesktop = new RemoteDesktop(
    () => runtime.services.preferences.get().enableRemoteDesktop,
    () => '',
    () => {},
    () => {},
    f.connect,
    f.isLocked,
  )
  const post = async (body: unknown, credential = token, path = '/api/remote-desktop') =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect((await post({ action: 'start', id: f.id }, 'invalid')).status).toBe(401)
  expect((await post({ action: 'start', id: f.id })).status).toBe(403)
  await post({ enableRemoteDesktop: true }, token, '/api/runtime/preferences/save')
  const taskId = randomUUID(),
    runId = randomUUID()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      decode(taskSchema, {
        id: taskId,
        activeRunId: runId,
        repositoryId: '',
        agentId: '',
        title: 'Agent denied desktop',
        status: 'running',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      }),
    ],
  }))
  const agentToken = runtime.services.runCredentials.issue(
    {
      taskId,
      runId,
      permissions: { provider: 'codex', permission: 'ask' },
      readOnly: false,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
    },
    new AbortController().signal,
  )
  expect((await post({ action: 'start', id: f.id }, agentToken)).status).toBe(403)
  expect((await post({ id: f.id }, agentToken, '/api/remote-desktop/unlock-ticket')).status).toBe(
    403,
  )

  expect((await post({ action: 'start', id: f.id })).status).toBe(200)
  const frame = await post({ action: 'frame', id: f.id }).then((response) => response.json())
  await post({ action: 'control', id: f.id, enabled: true })
  const result = await post({
    action: 'input',
    id: f.id,
    requestId: randomUUID(),
    frameId: frame.frame.id,
    input: { type: 'text', text: 'never record this private input' },
  })
  expect(result.status).toBe(200)
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(
    'never record this',
  )
  // The unlock route remains paired-human-only and its tickets cannot outlive the session.
  f.isLocked.mockResolvedValue(true)
  await post({ action: 'frame', id: f.id })
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  expect((await post({ id: f.id }, 'invalid', '/api/remote-desktop/unlock-ticket')).status).toBe(
    401,
  )
  expect(
    (
      await fetch(`http://127.0.0.1:${runtime.port}/api/remote-desktop/unlock-ticket`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-dovo-agent-access': '1',
        },
        body: JSON.stringify({ id: f.id }),
      })
    ).status,
  ).toBe(403)
  const ticket = await post({ id: f.id }, token, '/api/remote-desktop/unlock-ticket').then(
    (response) => response.json(),
  )
  expect(typeof ticket.ticket).toBe('string')
  await post({ enableRemoteDesktop: false }, token, '/api/runtime/preferences/save')
  const denied = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/remote-desktop/unlock?ticket=${encodeURIComponent(ticket.ticket)}`,
  )
  await expect(once(denied, 'open')).rejects.toThrow('401')
  expect(() => runtime.services.tickets.consume(ticket.ticket)).toThrow('expired')
  expect(runtime.services.remoteDesktop.status()).toBeNull()
  expect(f.close).toHaveBeenCalledOnce()
})

it('does not confirm Stop until in-flight native input has finished', async () => {
  const f = await fixture()
  const started = await f.start()
  await f.request({ action: 'control', id: f.id, enabled: true })
  let finish!: () => void
  const blocked = new Promise<void>((resolve) => {
    finish = resolve
  })
  const original = f.call.getMockImplementation()!
  f.call.mockImplementation(async (name, args) => {
    if (name === 'type_text') await blocked
    return original(name, args)
  })
  const sending = f.request({
    action: 'input',
    id: f.id,
    requestId: randomUUID(),
    frameId: started.frame!.id,
    input: { type: 'text', text: 'one action' },
  })
  await Promise.resolve()
  await Promise.resolve()
  let confirmed = false
  const stop = f.request({ action: 'stop', id: f.id }).then(() => {
    confirmed = true
  })
  await Promise.resolve()
  expect(confirmed).toBe(false)
  expect(f.desktop.status()).toBeNull()
  finish()
  await expect(sending).rejects.toThrow('ended')
  await stop
  expect(confirmed).toBe(true)
  expect(f.close).toHaveBeenCalledOnce()
})
it('retries a failed start without leaking a reservation or launching duplicate drivers', async () => {
  const f = await fixture()
  f.connect.mockRejectedValueOnce(new Error('Driver unavailable'))
  await expect(f.start()).rejects.toThrow('Driver unavailable')
  expect(f.desktop.status()).toBeNull()
  const first = await f.start()
  const retry = await f.start()
  expect(first.session?.id).toBe(retry.session?.id)
  expect(f.connect).toHaveBeenCalledTimes(2)
})

it('waits for unlock without capturing black images and resumes the same session view-only', async () => {
  const f = await fixture()
  f.isLocked.mockResolvedValue(true)
  const waiting = await f.start()
  expect(waiting).toMatchObject({ session: { id: f.id, locked: true, control: false } })
  expect(waiting.frame).toBeUndefined()
  await f.request({ action: 'frame', id: f.id })
  await f.request({ action: 'control', id: f.id, enabled: true })
  expect(f.desktop.status()?.control).toBe(false)
  expect(f.call).not.toHaveBeenCalled()
  f.isLocked.mockResolvedValue(false)
  const resumed = await f.request({ action: 'frame', id: f.id })
  expect(resumed.frame?.width).toBe(200)
  expect(resumed.session).toMatchObject({ id: f.id, control: false })
  expect(resumed.session?.locked).not.toBe(true)
  expect(f.connect).toHaveBeenCalledOnce()
})

it('discards stale frames and suspends control when the host locks before queued input', async () => {
  const f = await fixture()
  const first = await f.start()
  await f.request({ action: 'control', id: f.id, enabled: true })
  f.isLocked.mockResolvedValue(true)
  const waiting = await f.request({
    action: 'input',
    id: f.id,
    requestId: randomUUID(),
    frameId: first.frame!.id,
    input: { type: 'text', text: 'do not replay after unlock' },
  })
  expect(waiting.session).toMatchObject({ locked: true, control: false })
  expect(waiting.frame).toBeUndefined()
  expect(f.calls.some((call) => call.name === 'type_text')).toBe(false)
  f.isLocked.mockResolvedValue(false)
  const resumed = await f.request({ action: 'frame', id: f.id })
  expect(resumed.frame?.id).not.toBe(first.frame?.id)
  expect(resumed.session?.control).toBe(false)
  expect(f.calls.some((call) => call.name === 'type_text')).toBe(false)
})

it('does not return a capture if the Mac locks while capture is in flight', async () => {
  const f = await fixture()
  const original = f.call.getMockImplementation()!
  f.call.mockImplementation(async (name, args) => {
    const result = await original(name, args)
    if (name === 'get_desktop_state') f.isLocked.mockResolvedValue(true)
    return result
  })
  const waiting = await f.start()
  expect(waiting.session?.locked).toBe(true)
  expect(waiting.frame).toBeUndefined()
  await f.request({ action: 'stop', id: f.id })
  expect(f.desktop.status()).toBeNull()
  expect(f.close).toHaveBeenCalledOnce()
})

it('rechecks revoked credentials after the lock-state probe', async () => {
  const f = await fixture()
  let authorized = true
  f.isLocked.mockImplementation(async () => {
    authorized = false
    return true
  })
  await expect(
    f.desktop.request({ action: 'start', id: f.id }, 'device', 'Device', () => {
      if (!authorized) throw Error('Revoked device')
    }),
  ).rejects.toThrow('Revoked')
  expect(f.calls.map((call) => call.name)).toEqual(['end_session'])
  expect(f.desktop.status()).toBeNull()
})

it('binds unlock to the locked session and viewer, and detaches it on completion or stop', async () => {
  const f = await fixture()
  await f.start()
  expect(() => f.desktop.authorizeUnlock(f.id, 'device', () => {})).toThrow('no longer locked')
  f.isLocked.mockResolvedValue(true)
  await f.request({ action: 'frame', id: f.id })
  expect(() => f.desktop.authorizeUnlock(f.id, 'another', () => {})).toThrow('another device')
  expect(() =>
    f.desktop.authorizeUnlock(f.id, 'device', () => {
      throw Error('revoked')
    }),
  ).toThrow('revoked')
  let detach = () => {}
  const close = vi.fn<() => void>(() => detach())
  detach = f.desktop.attachUnlock(f.id, 'device', () => {}, close)
  expect(f.desktop.status()).toMatchObject({ unlocking: true, control: false })
  expect(() =>
    f.desktop.attachUnlock(
      f.id,
      'device',
      () => {},
      () => {},
    ),
  ).toThrow('already active')
  f.isLocked.mockResolvedValue(false)
  await f.request({ action: 'frame', id: f.id })
  expect(close).toHaveBeenCalledOnce()
  expect(f.desktop.status()).toMatchObject({ control: false })
  expect(f.desktop.status()?.unlocking).not.toBe(true)
  f.isLocked.mockResolvedValue(true)
  await f.request({ action: 'frame', id: f.id })
  detach = f.desktop.attachUnlock(f.id, 'device', () => {}, close)
  await f.request({ action: 'stop', id: f.id }, 'host')
  expect(close).toHaveBeenCalledTimes(2)
  expect(() => f.desktop.authorizeUnlock(f.id, 'device', () => {})).toThrow('ended')
})

it('retains authenticated unlock while the first unlocked capture is slow or fails', async () => {
  const f = await fixture()
  f.isLocked.mockResolvedValue(true)
  await f.start()
  let detach = () => {}
  const close = vi.fn<() => void>(() => detach())
  detach = f.desktop.attachUnlock(f.id, 'device', () => {}, close)
  const original = f.call.getMockImplementation()!
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  f.call.mockImplementationOnce(async () => {
    await held
    throw Error('WindowServer capture is not ready')
  })
  f.isLocked.mockResolvedValue(false)
  const capture = f.request({ action: 'frame', id: f.id })
  await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
  expect(f.desktop.status()).toMatchObject({ unlocking: true, control: false })
  expect(() => f.desktop.authorizeUnlock(f.id, 'device', () => {})).not.toThrow()
  expect(() => f.desktop.authorizeUnlock(f.id, 'another', () => {})).toThrow('another device')
  expect(close).not.toHaveBeenCalled()
  release()
  await expect(capture).rejects.toThrow('WindowServer capture is not ready')
  expect(close).not.toHaveBeenCalled()
  f.call.mockImplementation(original)
  const resumed = await f.request({ action: 'frame', id: f.id })
  expect(resumed.frame).toBeDefined()
  expect(close).toHaveBeenCalledOnce()
  expect(resumed.session?.unlocking).not.toBe(true)
})
