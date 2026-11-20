import { expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'
vi.setConfig(runtimeIntegration)

// A real PTY program, not a login shell, so no user shell or agent settings load. For each key it
// reads, it asks the TTY for its grid. Node's cached stdout size waits for SIGWINCH, which can run
// after the key under load.
const reporter = `
const { execFileSync } = require('node:child_process')
const size = () => {
  const [rows, cols] = execFileSync('stty', ['size'], { stdio: ['inherit', 'pipe', 'ignore'] })
    .toString().trim().split(' ')
  return cols + 'x' + rows
}
process.stdin.setRawMode(true)
process.stdin.on('data', (data) => process.stdout.write('size:input-' + data + ':' + size() + '\\n'))
process.stdout.write('size:start:' + size() + '\\n')
`

it('lets the typing viewer control the grid of a terminal watched by several sockets', async () => {
  const f = await fixture(),
    runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    })
  const sockets: WebSocket[] = []
  try {
    const s = runtime.services,
      token = 'test-device-token-with-at-least-32-characters'
    s.devices.add('Phone', token)
    const terminal = s.terminals.createCommand(
      'task',
      f.directory,
      { command: process.execPath, args: ['-e', reporter], env: {} },
      'Grid reporter',
    )
    await waitForRuntime(() => expect(s.terminals.get(terminal.id).buffer).toContain('size:start'))
    const grid = () => {
      const process = s.terminals.get(terminal.id).process
      if (
        !process ||
        !('cols' in process) ||
        typeof process.cols !== 'number' ||
        !('rows' in process) ||
        typeof process.rows !== 'number'
      ) {
        throw new Error('The grid reporter requires a native PTY with numeric dimensions.')
      }
      return `${process.cols}x${process.rows}`
    }
    // The old JSON stream and the binary stream share one runtime handler.
    const connect = async (binary: boolean) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${runtime.port}/ws/terminal?ticket=${s.tickets.issue(token, terminal.id)}${binary ? '&stream=binary-v1' : ''}`,
      )
      sockets.push(socket)
      await once(socket, 'open')
      return socket
    }
    const send = (socket: WebSocket, message: object) =>
      new Promise<void>((resolve, reject) =>
        socket.send(JSON.stringify(message), (error) => (error ? reject(error) : resolve())),
      )
    const resize = (socket: WebSocket, cols: number, rows: number) =>
      send(socket, { type: 'resize', cols, rows })
    const type = async (socket: WebSocket, key: string) => {
      await send(socket, { type: 'input', data: key })
      let line = ''
      await waitForRuntime(() => {
        line = s.terminals
          .get(terminal.id)
          .buffer.match(new RegExp(`size:input-${key}:(\\S+)`))![1]!
      })
      return line
    }
    // A round trip proves the server handled every earlier message from this socket.
    const settle = async (socket: WebSocket) => {
      const nonce = `n${Math.random().toString(36).slice(2)}`
      const pong = new Promise<void>((resolve) => {
        const listener = (data: Buffer) => {
          if (data.includes(nonce)) {
            socket.off('message', listener)
            resolve()
          }
        }
        socket.on('message', listener)
      })
      await send(socket, { type: 'ping', nonce })
      await pong
    }

    // One client works as before.
    const desktop = await connect(false)
    await resize(desktop, 120, 40)
    await waitForRuntime(() => expect(grid()).toBe('120x40'))

    // Opening a phone that observes leaves the desktop grid alone.
    const phone = await connect(true)
    await resize(phone, 50, 30)
    await settle(phone)
    expect(grid()).toBe('120x40')
    expect(await type(desktop, 'd')).toBe('120x40')

    // Typing hands size control to the phone before its key reaches the program.
    expect(await type(phone, 'p')).toBe('50x30')
    expect(grid()).toBe('50x30')
    // The desktop now observes, so its resize waits.
    await resize(desktop, 130, 45)
    await settle(desktop)
    expect(grid()).toBe('50x30')

    // When the active phone leaves, the remaining desktop takes over with its last size.
    phone.close()
    await waitForRuntime(() => expect(grid()).toBe('130x45'))

    // A reconnecting phone observes until the desktop drops.
    const reconnected = await connect(true)
    await resize(reconnected, 60, 20)
    await settle(reconnected)
    expect(grid()).toBe('130x45')
    desktop.terminate()
    await waitForRuntime(() => expect(grid()).toBe('60x20'))

    // A lone viewer resizes directly again.
    await resize(reconnected, 70, 25)
    await waitForRuntime(() => expect(grid()).toBe('70x25'))
    expect(await type(reconnected, 'r')).toBe('70x25')
  } finally {
    for (const socket of sockets) socket.terminate()
    await runtime.close()
    await f.cleanup()
  }
})
