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

it('opens a paired shared-browser session without a thread, preserves its host/profile and requires credentials for selections', async () => {
  const { STUDIO_BROWSER_SCOPE } = await import('@dovo/protocol')
  const open = vi.spyOn(RemoteBrowsers.prototype, 'open').mockResolvedValue()
  const selection = vi
    .spyOn(RemoteBrowsers.prototype, 'selection')
    .mockResolvedValue({ text: 'Selected text', url: 'http://lan.local/', title: 'LAN' })
  const close = vi.spyOn(RemoteBrowsers.prototype, 'close').mockResolvedValue()
  const input = vi
    .spyOn(RemoteBrowsers.prototype, 'input')
    .mockImplementation(async (_id, _input, authorize) => {
      authorize?.()
    })
  vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(() => {})
  const token = 'shared-browser-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.preferences.save({
    browserProfiles: [
      { id: 'default', name: 'Default' },
      { id: 'work', name: 'Work' },
    ],
  })
  const call = (action: string, credential = token, taskId = STUDIO_BROWSER_SCOPE) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        tabId: 'shared-tab',
        profileId: 'work',
        url: 'http://lan.local/',
      }),
    })
  expect((await call('open', 'wrong')).status).toBe(401)
  expect((await call('selection', 'wrong')).status).toBe(401)
  expect((await call('open', token, 'missing-thread')).status).toBe(404)
  const opened = await call('open')
  expect(opened.status).toBe(200)
  const resourceId = JSON.stringify([STUDIO_BROWSER_SCOPE, 'shared-tab', 'work'])
  expect(open).toHaveBeenCalledWith(resourceId, STUDIO_BROWSER_SCOPE, 'work', 'http://lan.local/')
  const { ticket } = await opened.json()
  const socket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}`)
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'key', key: 'ArrowDown' }))
  await vi.waitFor(() => expect(input).toHaveBeenCalled())
  socket.close()
  expect(await (await call('selection')).json()).toMatchObject({
    text: 'Selected text',
    url: 'http://lan.local/',
  })
  expect(selection).toHaveBeenCalledWith(resourceId)
  expect((await call('selection', token, 'missing-thread')).status).toBe(404)
  expect((await call('close')).status).toBe(200)
  expect(close).toHaveBeenCalledWith(resourceId)
})

// These fixtures exercise RemoteBrowsers itself without starting Chromium. The injected
// sessions deliberately implement only the page surface under test; clear their maps
// before disposal rather than relying on dispose's allSettled to hide incomplete mocks.
function browserFixture() {
  const browsers = new RemoteBrowsers('/runtime/browser.profiles')
  const sessions = new Map<string, Promise<ReturnType<typeof selectionSession>>>()
  const owners = new Map<string, string>()
  Object.defineProperty(browsers, 'sessions', { value: sessions })
  Object.defineProperty(browsers, 'owners', { value: owners })
  cleanups.push(async () => {
    sessions.clear()
    owners.clear()
    await browsers.dispose()
  })
  return { browsers, sessions, owners }
}
function selectionFrame(focused: boolean, text: unknown) {
  return {
    evaluate: vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(focused)
      .mockResolvedValue(text),
    isDetached: vi.fn<() => boolean>(() => false),
  }
}
function selectionSession() {
  const main = selectionFrame(true, 'Main selection')
  const page = {
    isClosed: () => false,
    frames: () => [main],
    mainFrame: () => main,
    evaluate: vi.fn<() => Promise<unknown>>().mockResolvedValue('Main selection'),
    url: () => 'http://lan.local/',
    title: vi.fn<() => Promise<string>>(async () => 'LAN page'),
    close: vi.fn<() => Promise<void>>(async () => {}),
  }
  return {
    page,
    logs: [{ time: 'now', kind: 'console', message: 'Private' }],
    release: vi.fn<() => Promise<void>>(async () => {}),
  }
}

it.each([true, false])(
  'only expires agent-inspected tabs without a viewer (viewer: %s)',
  async (viewing) => {
    vi.useFakeTimers()
    try {
      const { browsers, sessions } = browserFixture()
      const session = {
        ...selectionSession(),
        queue: Promise.resolve(),
        queued: 0,
        listeners: new Set(viewing ? [() => {}] : []),
        page: {
          ...selectionSession().page,
          locator: () => ({ ariaSnapshot: async () => 'Page' }),
          screenshot: async () => Buffer.from('image'),
        },
      }
      sessions.set('thread', Promise.resolve(session))
      const close = vi.spyOn(browsers, 'close').mockResolvedValue()
      Object.defineProperty(browsers, 'scheduleSharpFrame', { value: () => {} })
      await browsers.agentCommand('task', { action: 'snapshot' }, () => {}, 'thread')
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(close).toHaveBeenCalledTimes(viewing ? 0 : 1)
    } finally {
      vi.useRealTimers()
    }
  },
)

it('hides shared workspace browser sessions and rejects Studio access before any close mutation', async () => {
  const { STUDIO_BROWSER_SCOPE } = await import('@dovo/protocol')
  const { browsers, sessions, owners } = browserFixture()
  const shared = selectionSession()
  const thread = selectionSession()
  sessions.set('shared', Promise.resolve(shared))
  owners.set('shared', STUDIO_BROWSER_SCOPE)
  sessions.set('thread', Promise.resolve(thread))
  owners.set('thread', 'task')
  expect(await browsers.studioList()).toEqual([
    { id: 'thread', taskId: 'task', url: 'http://lan.local/', title: 'LAN page' },
  ])
  expect(shared.page.title).not.toHaveBeenCalled()
  await expect(browsers.studioLogs('shared')).rejects.toMatchObject({ status: 403 })
  expect(await browsers.studioLogs('thread')).toEqual({ entries: thread.logs })
  const close = vi.spyOn(browsers, 'close')
  const authorize = vi.fn<() => void>()
  for (const action of ['snapshot', 'close'] as const)
    await expect(
      browsers.agentCommand('task', { action }, authorize, 'shared'),
    ).rejects.toMatchObject({ status: 403 })
  expect(authorize).toHaveBeenCalledTimes(2)
  expect(close).not.toHaveBeenCalled()
  expect(shared.page.close).not.toHaveBeenCalled()
  expect(shared.release).not.toHaveBeenCalled()
  expect(sessions.has('shared')).toBe(true)
  expect(owners.get('shared')).toBe(STUDIO_BROWSER_SCOPE)
})

it('clamps selection results at the runtime boundary and treats nonstrings as empty', async () => {
  const { browsers, sessions } = browserFixture()
  for (const value of ['x'.repeat(40000), { text: 'untrusted object' }, null, 123]) {
    const session = selectionSession()
    const frame = selectionFrame(true, value)
    session.page.frames = () => [frame]
    session.page.mainFrame = () => frame
    session.page.evaluate.mockResolvedValue(value)
    sessions.set('selection', Promise.resolve(session))
    expect(await browsers.selection('selection')).toEqual({
      text: typeof value === 'string' ? value.slice(0, 32000) : '',
      title: 'LAN page',
      url: 'http://lan.local/',
    })
  }
})

it('falls back to the main frame when no frame reports focus', async () => {
  const { browsers, sessions } = browserFixture()
  const session = selectionSession()
  const child = selectionFrame(false, 'Child selection')
  const main = selectionFrame(false, 'Main selection')
  session.page.frames = () => [child, main]
  session.page.mainFrame = () => main
  sessions.set('selection', Promise.resolve(session))
  expect(await browsers.selection('selection')).toEqual({
    text: 'Main selection',
    title: 'LAN page',
    url: 'http://lan.local/',
  })
})

it('bounds the entire selection operation, including frame evaluation and title lookup, to three seconds', async () => {
  vi.useFakeTimers()
  try {
    const { browsers, sessions } = browserFixture()
    for (const blocked of ['frame', 'title'] as const) {
      const session = selectionSession()
      if (blocked === 'frame') {
        const frame = selectionFrame(true, '')
        frame.evaluate.mockReset().mockReturnValue(new Promise(() => {}))
        session.page.frames = () => [frame]
      } else {
        // Spend part of the same deadline finding focus before title lookup stalls.
        const frame = selectionFrame(true, 'Main selection')
        frame.evaluate
          .mockReset()
          .mockImplementationOnce(
            () => new Promise((resolve) => setTimeout(() => resolve(true), 2000)),
          )
          .mockResolvedValue('Main selection')
        session.page.frames = () => [frame]
        session.page.title.mockReturnValue(new Promise(() => {}))
      }
      sessions.set('selection', Promise.resolve(session))
      const result = browsers.selection('selection')
      const outcome = result.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      await vi.advanceTimersByTimeAsync(3000)
      expect(await outcome).toMatchObject({ error: { status: 504 } })
      expect(vi.getTimerCount()).toBe(0)
    }
  } finally {
    vi.useRealTimers()
  }
})

it('keeps same-named shared and thread profiles in separate persistent directories and contexts', async () => {
  const { browsers } = browserFixture()
  const context = () => ({
    pages: () => [],
    route: vi.fn<() => Promise<void>>(async () => {}),
    close: vi.fn<() => Promise<void>>(async () => {}),
  })
  const threadContext = context()
  const workspaceContext = context()
  const launchPersistentContext = vi
    .fn<(directory: string) => Promise<ReturnType<typeof context>>>()
    .mockResolvedValueOnce(threadContext)
    .mockResolvedValueOnce(workspaceContext)
  Object.defineProperty(browsers, 'executable', {
    value: async () => ({
      chromium: { launchPersistentContext },
      executablePath: '/managed/chromium',
    }),
  })
  const thread = await browsers['profile']('work')
  const shared = await browsers['profile']('work', false, true)
  const sharedAgain = await browsers['profile']('work', false, true)
  try {
    expect(launchPersistentContext.mock.calls.map(([directory]) => directory)).toEqual([
      '/runtime/browser.profiles/work',
      '/runtime/browser.profiles/browser-workspace.profiles/work',
    ])
    expect(thread.context).toBe(threadContext)
    expect(shared.context).toBe(workspaceContext)
    expect(shared.context).not.toBe(thread.context)
    expect(sharedAgain.context).toBe(shared.context)
    await shared.release()
    expect(workspaceContext.close).not.toHaveBeenCalled()
    await sharedAgain.release()
    expect(workspaceContext.close).toHaveBeenCalledOnce()
    expect(threadContext.close).not.toHaveBeenCalled()
  } finally {
    await Promise.all([thread.release(), shared.release(), sharedAgain.release()])
  }
  expect(threadContext.close).toHaveBeenCalledOnce()
  expect(workspaceContext.close).toHaveBeenCalledOnce()
  expect(browsers['profiles'].size).toBe(0)
})

it('routes shared ownership into the workspace profile namespace when opening a tab', async () => {
  const { STUDIO_BROWSER_SCOPE } = await import('@dovo/protocol')
  const { browsers } = browserFixture()
  const session = { ...selectionSession(), listeners: new Set([() => {}]) }
  const create = vi.fn<(...args: Parameters<RemoteBrowsers['create']>) => Promise<typeof session>>(
    async () => session,
  )
  Object.defineProperty(browsers, 'create', { value: create })
  await browsers.open('shared', STUDIO_BROWSER_SCOPE, 'work', 'http://lan.local/')
  await browsers.open('thread', 'task', 'work', 'http://lan.local/')
  expect(create.mock.calls).toEqual([
    ['shared', 'work', 'http://lan.local/', false, true],
    ['thread', 'work', 'http://lan.local/', false, false],
  ])
})

it('ignores text evaluation failures only for frames that detached after the focus probe', async () => {
  const { browsers, sessions } = browserFixture()
  const session = selectionSession()
  const child = selectionFrame(true, '')
  const main = selectionFrame(true, 'Main selection')
  const failure = new Error('Selection evaluation failed')
  child.evaluate.mockReset().mockResolvedValueOnce(true).mockRejectedValue(failure)
  child.isDetached.mockReturnValue(true)
  session.page.frames = () => [child, main]
  session.page.mainFrame = () => main
  sessions.set('selection', Promise.resolve(session))
  expect(await browsers.selection('selection')).toEqual({
    text: 'Main selection',
    title: 'LAN page',
    url: 'http://lan.local/',
  })
  expect(child.isDetached).toHaveBeenCalledOnce()
  expect(main.evaluate).toHaveBeenCalledTimes(2)

  child.evaluate.mockReset().mockResolvedValueOnce(true).mockRejectedValue(failure)
  child.isDetached.mockReturnValue(false)
  main.evaluate.mockReset().mockResolvedValueOnce(true).mockResolvedValue('Main selection')
  await expect(browsers.selection('selection')).rejects.toBe(failure)
  // A live-frame error must not silently fall through to another page's selection.
  expect(main.evaluate).toHaveBeenCalledTimes(1)
  expect(session.page.title).toHaveBeenCalledOnce()
})

it('acknowledges scoped file transfers, hides internal errors and rechecks ownership after queued IO', async () => {
  const { randomUUID } = await import('node:crypto')
  const { STUDIO_BROWSER_SCOPE } = await import('@dovo/protocol')
  vi.spyOn(RemoteBrowsers.prototype, 'attach').mockResolvedValue(() => {})
  const disconnect = vi.spyOn(RemoteBrowsers.prototype, 'disconnectUploads').mockResolvedValue()
  const token = 'browser-upload-test-owner-token-with-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const deviceToken = 'browser-upload-test-device-token-with-32-characters'
  const device = runtime.services.devices.add('Upload phone', deviceToken)
  const ticket = runtime.services.browserTickets.issue(
    deviceToken,
    'upload-tab',
    STUDIO_BROWSER_SCOPE,
  )
  const socket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/browser?ticket=${ticket}`)
  cleanups.unshift(async () => {
    socket.terminate()
  })
  const messages: unknown[] = []
  socket.on('message', (raw) => {
    const bytes = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw)
    messages.push(JSON.parse(bytes.toString()))
  })
  await once(socket, 'open')
  let delivered = 0
  const upload = vi
    .spyOn(RemoteBrowsers.prototype, 'upload')
    .mockImplementation(async (_id, _command, authorize) => {
      authorize()
      delivered++
    })
  const chooserId = randomUUID()
  const first = {
    type: 'fileUploadStart',
    requestId: randomUUID(),
    chooserId,
    name: 'fixture.csv',
    mimeType: 'text/csv',
    size: 3,
  }
  socket.send(JSON.stringify(first))
  await vi.waitFor(() =>
    expect(messages).toContainEqual({ type: 'fileUploadAck', requestId: first.requestId }),
  )
  expect(upload).toHaveBeenCalledWith('upload-tab', first, expect.any(Function))
  expect(delivered).toBe(1)
  upload.mockImplementationOnce(async () => {
    throw new Error('/private/runtime/upload/fixture.csv')
  })
  const failed = { ...first, requestId: randomUUID() }
  socket.send(JSON.stringify(failed))
  await vi.waitFor(() =>
    expect(messages).toContainEqual({
      type: 'fileUploadAck',
      requestId: failed.requestId,
      error: 'Could not transfer the selected file. Open the upload control and try again.',
    }),
  )
  expect(JSON.stringify(messages)).not.toContain('/private/runtime/')
  let finishIO: () => void = () => {
    throw new Error('Upload IO was not initialized')
  }
  const io = new Promise<void>((resolve) => {
    finishIO = resolve
  })
  upload.mockImplementationOnce(async (_id, _command, authorize) => {
    await io
    authorize()
    delivered++
  })
  socket.send(JSON.stringify({ ...first, requestId: randomUUID() }))
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3))
  const closed = once(socket, 'close')
  runtime.services.devices.revoke(device)
  await closed
  finishIO()
  await vi.waitFor(() =>
    expect(disconnect).toHaveBeenCalledWith('upload-tab', upload.mock.calls[2][2]),
  )
  expect(delivered).toBe(1)
})
