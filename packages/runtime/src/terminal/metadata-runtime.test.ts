import { expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import {
  applySnapshotDelta,
  decode,
  syncFrameSchema,
  terminalSchema,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { Terminals } from './terminals.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)

it('publishes PTY metadata and renames through snapshot sync while preserving raw output', async () => {
  const token = 'terminal-metadata-owner-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  let socket: WebSocket | undefined
  const stream = 'plain\x1b]2;Build\x07\x1b]7501;state=working:app=my-agent\x1b\\'
  try {
    const terminal = runtime.services.terminals.createCommand(
      'studio:terminals',
      process.cwd(),
      {
        command: process.execPath,
        args: [
          '-e',
          `process.stdin.on('data', () => process.stdout.write(${JSON.stringify(stream)}))`,
        ],
        env: {},
      },
      'Terminal 1',
    )
    const address = `http://127.0.0.1:${runtime.port}`
    const ticketResponse = await fetch(`${address}/api/sync/ticket?format=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(ticketResponse.status).toBe(200)
    const ticket: { ticket: string } = await ticketResponse.json()
    socket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/sync?ticket=${ticket.ticket}`)
    let snapshot: RuntimeSnapshot | undefined
    socket.on('message', (raw) => {
      if (!Buffer.isBuffer(raw)) return
      const frame = decode(syncFrameSchema, JSON.parse(raw.toString('utf8')))
      if (frame.type === 'snapshot') snapshot = frame.snapshot
      else if (frame.type === 'delta' && snapshot)
        snapshot = applySnapshotDelta(snapshot, frame.delta)
    })
    await once(socket, 'open')
    socket.send(JSON.stringify({ type: 'resume' }))
    const current = () => snapshot?.terminals.find((item) => item.id === terminal.id)
    await waitForRuntime(() => expect(current()?.title).toBe('Terminal 1'))
    expect(current()?.activity).toBeUndefined()
    const live: string[] = []
    const detach = runtime.services.terminals.attach(terminal.id, (data) => live.push(data))
    runtime.services.terminals.input(terminal.id, '\r')
    await waitForRuntime(() =>
      expect(current()).toMatchObject({
        title: 'Build',
        terminalTitle: 'Build',
        activity: { state: 'working', app: 'my-agent' },
      }),
    )
    expect(live.join('')).toContain(stream)
    expect(runtime.services.terminals.get(terminal.id).buffer).toContain(stream)
    const rename = async (title: string | null) => {
      const response = await fetch(`${address}/api/terminals/update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: terminal.id, title }),
      })
      expect(response.status).toBe(200)
      return decode(terminalSchema, await response.json())
    }
    expect(await rename('  My build  ')).toMatchObject({
      title: 'My build',
      customTitle: 'My build',
    })
    runtime.services.terminals.input(terminal.id, '\r')
    await waitForRuntime(() => expect(current()?.title).toBe('My build'))
    expect(await rename(null)).toMatchObject({ title: 'Build', terminalTitle: 'Build' })
    await waitForRuntime(() => expect(current()?.customTitle).toBeUndefined())
    detach()
  } finally {
    socket?.terminate()
    await runtime.close()
  }
})

it.each(['working', 'blocked', 'idle', 'done', 'error'])(
  'handles process exit after an explicit %s report',
  async (state) => {
    const terminals = new Terminals()
    try {
      const info = terminals.createCommand(
        'studio:terminals',
        process.cwd(),
        {
          command: process.execPath,
          args: [
            '-e',
            `process.stdout.write(${JSON.stringify(`\x1b]7501;state=${state}\x07`)}); process.stdin.once('data', () => process.exit(0))`,
          ],
          env: {},
        },
        'Terminal',
      )
      // Establish captured metadata before exit; fast PTYs can exit before output is read.
      await waitForRuntime(() => expect(terminals.get(info.id).info.activity).toEqual({ state }))
      expect(terminals.get(info.id).info.exited).toBe(false)
      terminals.input(info.id, '\r')
      await waitForRuntime(() => expect(terminals.get(info.id).info.exited).toBe(true))
      expect(terminals.get(info.id).info.exitCode).toBe(0)
      expect(terminals.get(info.id).info.activity).toEqual(
        ['done', 'error'].includes(state) ? { state } : undefined,
      )
    } finally {
      await terminals.dispose()
    }
  },
)
