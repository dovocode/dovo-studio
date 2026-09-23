import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRuntime } from '../index'
import { RemoteBrowsers } from '../previews/browser'
import { SocketTickets } from './socket-tickets'
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
  expect(open).toHaveBeenCalledWith('task')
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
      'task',
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
  binary.on('message', (raw, isBinary) => {
    if (!isBinary) return
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
    }),
  )
  await vi.waitFor(() =>
    expect(received.at(-1)).toEqual({
      sequence: 3,
      text: 'newest',
    }),
  )
  expect(received).toHaveLength(3)
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
