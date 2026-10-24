import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRuntime } from '../index'
import { RemoteBrowsers } from '../previews/browser'
import { SocketTickets } from './support/socket-tickets'
import { decodeBrowserFrame, remoteBrowserMessageSchema } from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.restoreAllMocks()
})
it('checks task ownership and credentials before launching, isolates browser tickets, and detaches on revocation', async () => {
  const open = vi.spyOn(RemoteBrowsers.prototype, 'open').mockResolvedValue()
  const detach = vi.fn<() => void>()
  const attach = vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(detach)
  const input = vi.spyOn(RemoteBrowsers.prototype, 'input').mockResolvedValue()
  const token = 'browser-test-token-with-at-least-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const call = (taskId: string, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        taskId,
      }),
    })
  expect((await call('task', 'wrong')).status).toBe(401)
  expect((await call('missing')).status).toBe(404)
  expect(open).not.toHaveBeenCalled()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Browser',
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
  const deviceToken = 'browser-device-token-with-at-least-32-characters'
  const device = runtime.services.devices.add('Test phone', deviceToken)
  const result = await call('task', deviceToken)
  expect(result.status).toBe(200)
  expect(open).toHaveBeenCalledWith(JSON.stringify(['task', null]), 'task', 'default', undefined)
  const ticket = (await result.json()).ticket
  const url = `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}`
  const socket = new WebSocket(url)
  cleanups.unshift(async () => {
    socket.terminate()
  })
  await once(socket, 'open')
  const replay = new WebSocket(url)
  await expect(once(replay, 'open')).rejects.toThrow('401')
  const terminalTicket = runtime.services.tickets.issue(token, 'task')
  const cross = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${terminalTicket}`)
  await expect(once(cross, 'open')).rejects.toThrow('401')
  socket.send(
    JSON.stringify({
      type: 'text',
      text: 'remote input',
    }),
  )
  await vi.waitFor(() =>
    expect(input).toHaveBeenCalledWith(
      JSON.stringify(['task', null]),
      {
        type: 'text',
        text: 'remote input',
      },
      expect.any(Function),
    ),
  )
  const frames: string[] = []
  socket.on('message', (raw) => {
    const message = decode(
      remoteBrowserMessageSchema,
      JSON.parse(
        (Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw)
        ).toString(),
      ),
    )
    if (message.type === 'frame') frames.push(Buffer.from(message.data, 'base64').toString())
  })
  const buffered = vi
    .spyOn(WebSocket.prototype, 'bufferedAmount', 'get')
    .mockReturnValue(1024 * 1024)
  const publish = attach.mock.calls[0][1]
  publish({
    type: 'frame',
    data: Buffer.from('stale'),
    width: 390,
    height: 844,
  })
  buffered.mockReturnValue(0)
  publish({
    type: 'frame',
    data: Buffer.from('latest'),
    width: 390,
    height: 844,
  })
  await vi.waitFor(() => expect(frames).toEqual(['latest']))
  // The delayed flush must not repaint an older frame after the connection has recovered.
  await new Promise((resolve) => setTimeout(resolve, 75))
  expect(frames).toEqual(['latest'])
  buffered.mockRestore()
  const closed = once(socket, 'close')
  runtime.services.devices.revoke(device)
  expect((await closed)[0]).toBe(1008)
  await vi.waitFor(() => expect(detach).toHaveBeenCalledOnce())
  const binaryTicket = (await (await call('task')).json()).ticket
  const binary = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${binaryTicket}&frames=binary-v1`,
  )
  const received: Array<{
    sequence: number
    text: string
  }> = []
  const legacyMetrics: unknown[] = []
  binary.on('message', (raw, isBinary) => {
    if (!isBinary) {
      legacyMetrics.push(raw)
      return
    }
    const data = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw)
    const frame = decodeBrowserFrame(Uint8Array.from(data).buffer)
    received.push({
      sequence: frame.sequence,
      text: Buffer.from(frame.data).toString(),
    })
  })
  await once(binary, 'open')
  await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
  const publishBinary = attach.mock.calls[1][1]
  for (const text of ['first', 'second', 'old-pending', 'newest'])
    publishBinary({
      type: 'frame',
      width: 390,
      height: 844,
      data: Buffer.from(text),
    })
  await vi.waitFor(() =>
    expect(received).toEqual([
      {
        sequence: 1,
        text: 'first',
      },
      {
        sequence: 2,
        text: 'second',
      },
    ]),
  )
  binary.send(
    JSON.stringify({
      type: 'frameAck',
      sequence: 1,
      decodeMs: 0,
    }),
  )
  await vi.waitFor(() =>
    expect(received.at(-1)).toEqual({
      sequence: 3,
      text: 'newest',
    }),
  )
  expect(received).toHaveLength(3)
  expect(legacyMetrics).toHaveLength(0)
  expect(input).toHaveBeenCalledTimes(1)
  const invalidAck = once(binary, 'close')
  binary.send(
    JSON.stringify({
      type: 'frameAck',
      sequence: 99,
    }),
  )
  expect((await invalidAck)[0]).toBe(1008)
  // An input waiting behind navigation rechecks trust when it eventually executes.
  expect(() => input.mock.calls[0][2]?.()).toThrow(/disconnected|revoked/i)
})
it('rejects expired tickets without keeping bearer credentials reusable', () => {
  const tickets = new SocketTickets()
  const time = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const ticket = tickets.issue('secret', 'task')
  time.mockReturnValue(32000)
  expect(() => tickets.consume(ticket)).toThrow('expired')
  expect(() => tickets.consume(ticket)).toThrow('expired')
})

it('pipelines high-RTT viewers but bounds bytes and contracts when their decoder slows', async () => {
  vi.spyOn(RemoteBrowsers.prototype, 'open').mockResolvedValue()
  const attach = vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(() => {})
  const token = 'adaptive-browser-test-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Browser',
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
  const ticket = runtime.services.browserTickets.issue(token, 'task', 'task')
  const socket = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}&frames=binary-v1&metrics=1`,
  )
  cleanups.unshift(async () => {
    socket.terminate()
  })
  const received: Array<{ sequence: number; size: number; value: number }> = []
  const metrics: number[] = []
  socket.on('message', (raw, binary) => {
    const data = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw)
    if (!binary) {
      const message = decode(remoteBrowserMessageSchema, JSON.parse(data.toString()))
      if (message.type === 'streamStats') metrics.push(message.transportMs)
      return
    }
    const frame = decodeBrowserFrame(Uint8Array.from(data).buffer)
    received.push({ sequence: frame.sequence, size: frame.data.length, value: frame.data[0]! })
  })
  await once(socket, 'open')
  await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce())
  const publish = (value: number, bytes = 1) =>
    attach.mock.calls[0][1]({
      type: 'frame',
      width: 390,
      height: 844,
      data: Buffer.alloc(bytes, value),
    })
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
  publish(1)
  publish(2)
  await vi.waitFor(() => expect(received).toHaveLength(2))
  now.mockReturnValue(1112)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 1, decodeMs: 0 }))
  // A following status is an input-queue barrier after processing the ack.
  const input = vi.spyOn(RemoteBrowsers.prototype, 'input').mockResolvedValue()
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(1))
  expect(metrics).toEqual([112])
  for (let value = 3; value <= 12; value++) publish(value)
  await vi.waitFor(() => expect(received).toHaveLength(4))
  expect(received.at(-1)?.value).toBe(4)
  // Shrink back to two, retaining only the newest pending image. Already sent
  // images cannot be recalled; no more are sent until the window drains.
  now.mockReturnValue(1304)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 2, decodeMs: 80 }))
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 3, decodeMs: 80 }))
  await vi.waitFor(() => expect(received).toHaveLength(5))
  expect(received.at(-1)?.value).toBe(12)
  // Dropped pending frames must not be mistaken for an instant decoder and
  // reopen the window while an actual decode is slow.
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 4, decodeMs: 0, dropped: true }))
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(2))
  expect(metrics).toEqual([112])
  publish(13)
  publish(14)
  await vi.waitFor(() => expect(received).toHaveLength(6))
  expect(received.at(-1)?.value).toBe(13)
  // Restore a fast decoder, then verify the byte budget still wins over the
  // larger frame window. Oversized detail frames travel alone.
  now.mockReturnValue(1416)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 5, decodeMs: 0 }))
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 6, decodeMs: 0 }))
  await vi.waitFor(() => expect(received).toHaveLength(7))
  now.mockReturnValue(1528)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 7, decodeMs: 0 }))
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(3))
  now.mockReturnValue(2416)
  publish(15)
  await vi.waitFor(() => expect(received).toHaveLength(8))
  now.mockReturnValue(2528)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 8, decodeMs: 0 }))
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(4))
  expect(metrics).toHaveLength(2)
  expect(metrics[1]).toBeGreaterThanOrEqual(112)
  expect(metrics[1]).toBeLessThan(130)
  for (let value = 20; value <= 24; value++) publish(value, 100 * 1024)
  await vi.waitFor(() => expect(received).toHaveLength(10))
  expect(received.slice(-2).map((frame) => frame.value)).toEqual([20, 21])
  publish(30, 512 * 1024)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 9, decodeMs: 0 }))
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(5))
  expect(received).toHaveLength(10)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 10, decodeMs: 0 }))
  await vi.waitFor(() => expect(received).toHaveLength(11))
  expect(received.at(-1)).toEqual({ sequence: 11, size: 512 * 1024, value: 30 })
  // A changed network route may have a higher baseline RTT. Aging the old
  // minimum lets it pipeline again instead of remaining in congestion backoff.
  publish(31)
  now.mockReturnValue(20000)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 11, decodeMs: 0 }))
  await vi.waitFor(() => expect(received).toHaveLength(12))
  now.mockReturnValue(20096)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 12, decodeMs: 0 }))
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(6))
  for (let value = 32; value <= 40; value++) publish(value)
  await vi.waitFor(() => expect(received).toHaveLength(16))
  expect(received.slice(-4).map((frame) => frame.value)).toEqual([32, 33, 34, 35])
  for (let value = 41; value <= 43; value++) publish(value)
  now.mockReturnValue(20360)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 13, decodeMs: 0 }))
  await vi.waitFor(() => expect(received).toHaveLength(17))
  // A single scheduling spike keeps the window open. Sustained delay contracts it.
  now.mockReturnValue(20376)
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 14, decodeMs: 0 }))
  socket.send(JSON.stringify({ type: 'status' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(7))
  expect(received).toHaveLength(17)
})

it('does not mistake source pacing for link serialization in a high-RTT window', async () => {
  vi.spyOn(RemoteBrowsers.prototype, 'open').mockResolvedValue()
  const attach = vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(() => {})
  const input = vi.spyOn(RemoteBrowsers.prototype, 'input').mockResolvedValue()
  const token = 'paced-browser-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Browser',
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
  const ticket = runtime.services.browserTickets.issue(token, 'task', 'task')
  const socket = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}&frames=binary-v1`,
  )
  cleanups.unshift(async () => {
    socket.terminate()
  })
  const received: number[] = []
  socket.on('message', (raw, binary) => {
    if (!binary) return
    const data = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw)
    received.push(decodeBrowserFrame(Uint8Array.from(data).buffer).data[0]!)
  })
  await once(socket, 'open')
  await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce())
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const publish = (time: number, value: number) => {
    now.mockReturnValue(time)
    attach.mock.calls[0][1]({ type: 'frame', width: 390, height: 844, data: Buffer.from([value]) })
  }
  const ack = async (time: number, sequence: number) => {
    now.mockReturnValue(time)
    socket.send(JSON.stringify({ type: 'frameAck', sequence, decodeMs: 0 }))
    socket.send(JSON.stringify({ type: 'status' }))
    await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(sequence))
  }
  publish(1000, 1)
  publish(1032, 2)
  await vi.waitFor(() => expect(received).toEqual([1, 2]))
  await ack(1080, 1)
  publish(1080, 3)
  publish(1112, 4)
  await vi.waitFor(() => expect(received).toEqual([1, 2, 3, 4]))
  // Both frames took 80ms to arrive. Their 32ms ACK gap comes entirely
  // from the source; treating it as link capacity would shrink the window.
  await ack(1112, 2)
  publish(1112, 5)
  publish(1128, 6)
  await vi.waitFor(() => expect(received).toEqual([1, 2, 3, 4, 5, 6]))
})

it('bounds a high-RTT window by frame delivery spacing on a narrow link', async () => {
  vi.spyOn(RemoteBrowsers.prototype, 'open').mockResolvedValue()
  const attach = vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(() => {})
  const input = vi.spyOn(RemoteBrowsers.prototype, 'input').mockResolvedValue()
  const token = 'serialized-browser-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Browser',
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
  const ticket = runtime.services.browserTickets.issue(token, 'task', 'task')
  const socket = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}&frames=binary-v1`,
  )
  cleanups.unshift(async () => {
    socket.terminate()
  })
  const received: number[] = []
  socket.on('message', (raw, binary) => {
    if (!binary) return
    const data = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw)
    received.push(decodeBrowserFrame(Uint8Array.from(data).buffer).data[0]!)
  })
  await once(socket, 'open')
  await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce())
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const publish = (time: number, value: number) => {
    now.mockReturnValue(time)
    attach.mock.calls[0][1]({
      type: 'frame',
      width: 390,
      height: 844,
      data: Buffer.alloc(24 * 1024, value),
    })
  }
  let barriers = 0
  const ack = async (time: number, sequence: number) => {
    now.mockReturnValue(time)
    socket.send(JSON.stringify({ type: 'frameAck', sequence, decodeMs: 0 }))
    socket.send(JSON.stringify({ type: 'status' }))
    barriers++
    await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(barriers))
  }
  publish(1000, 1)
  publish(1016, 2)
  await vi.waitFor(() => expect(received).toEqual([1, 2]))
  await ack(1180, 1)
  publish(1180, 3)
  publish(1196, 4)
  await vi.waitFor(() => expect(received).toHaveLength(4))
  // Frames sent 16ms apart arrive 98ms apart: raising the window from
  // their higher RTT would add queueing instead of useful throughput.
  await ack(1278, 2)
  publish(1278, 5)
  publish(1294, 6)
  socket.send(JSON.stringify({ type: 'status' }))
  barriers++
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(barriers))
  expect(received).toEqual([1, 2, 3, 4])
  await ack(1360, 3)
  await vi.waitFor(() => expect(received).toEqual([1, 2, 3, 4, 6]))
  await ack(1458, 4)
  await ack(1540, 5)
  // A recovered route must not keep a stale bandwidth estimate indefinitely.
  publish(12000, 7)
  await vi.waitFor(() => expect(received).toHaveLength(6))
  await ack(12080, 6)
  publish(12080, 8)
  publish(12096, 9)
  publish(12112, 10)
  await vi.waitFor(() => expect(received.slice(-3)).toEqual([8, 9, 10]))
})

it('isolates remote tabs, binds their tickets to the task, and closes only the requested tab', async () => {
  const open = vi.spyOn(RemoteBrowsers.prototype, 'open').mockResolvedValue()
  const close = vi.spyOn(RemoteBrowsers.prototype, 'close').mockResolvedValue()
  const attach = vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(() => {})
  const visibility = vi.spyOn(RemoteBrowsers.prototype, 'visibility').mockResolvedValue()
  const token = 'browser-tabs-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'task',
        title: 'Browser',
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
  const call = (action: string, taskId: string, tabId: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, tabId }),
    })
  const first = await call('open', 'task', 'first')
  const second = await call('open', 'task', 'second')
  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  expect(open.mock.calls).toEqual([
    [JSON.stringify(['task', 'first']), 'task', 'default', undefined],
    [JSON.stringify(['task', 'second']), 'task', 'default', undefined],
  ])
  const ticket = (await first.json()).ticket
  expect((await second.json()).tabId).toBe('second')
  const socket = new WebSocket(
    `ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}&frames=binary-v1`,
  )
  cleanups.unshift(async () => {
    socket.terminate()
  })
  await once(socket, 'open')
  await vi.waitFor(() =>
    expect(attach).toHaveBeenCalledWith(JSON.stringify(['task', 'first']), expect.any(Function)),
  )
  socket.send(JSON.stringify({ type: 'visibility', visible: false }))
  await vi.waitFor(() =>
    expect(visibility).toHaveBeenCalledWith(
      JSON.stringify(['task', 'first']),
      expect.any(Function),
      false,
    ),
  )
  const frameReceived = once(socket, 'message')
  attach.mock.calls[0][1]({ type: 'frame', width: 390, height: 844, data: Buffer.from('frame') })
  await frameReceived
  const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 20000)
  await new Promise((resolve) => setTimeout(resolve, 2100))
  expect(socket.readyState).toBe(WebSocket.OPEN)
  socket.send(JSON.stringify({ type: 'visibility', visible: true }))
  await vi.waitFor(() =>
    expect(visibility).toHaveBeenLastCalledWith(
      JSON.stringify(['task', 'first']),
      expect.any(Function),
      true,
    ),
  )
  clock.mockRestore()
  socket.send(JSON.stringify({ type: 'frameAck', sequence: 1 }))
  expect((await call('close', 'missing', 'first')).status).toBe(404)
  expect(close).not.toHaveBeenCalled()
  expect((await call('close', 'task', 'first')).status).toBe(200)
  expect(close).toHaveBeenCalledWith(JSON.stringify(['task', 'first']))
  const catalog = (action: string, profiles?: Array<{ id: string; name: string }>) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/profiles/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(profiles ? { profiles } : {}),
    })
  expect((await (await catalog('read')).json()).profiles).toEqual([
    { id: 'default', name: 'Default' },
  ])
  const profiles = [
    { id: 'default', name: 'Default' },
    { id: 'work', name: 'Remote Work' },
  ]
  expect((await catalog('save', profiles)).status).toBe(200)
  expect((await (await catalog('read')).json()).profiles).toEqual(profiles)
  expect((await catalog('save', [{ id: '../outside', name: 'Bad' }])).status).toBe(400)
  const openProfile = (profileId: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task',
        tabId: 'first',
        profileId,
        url: 'http://localhost:3000',
      }),
    })
  const count = open.mock.calls.length
  expect((await openProfile('missing')).status).toBe(404)
  expect(open).toHaveBeenCalledTimes(count)
  const work = await openProfile('work')
  expect(work.status).toBe(200)
  expect((await work.json()).profileId).toBe('work')
  expect(open).toHaveBeenLastCalledWith(
    JSON.stringify(['task', 'first', 'work']),
    'task',
    'work',
    'http://localhost:3000',
  )
})
