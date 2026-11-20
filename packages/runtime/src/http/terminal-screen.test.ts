import { once } from 'node:events'
import { decode, decodeTerminalStreamFrame, taskSchema } from '@dovo/protocol'
import headless from '@xterm/headless'
import { WebSocket } from 'ws'
import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)

const ownerToken = 'terminal-screen-owner-token-with-at-least-32-characters'
const deviceToken = 'terminal-screen-device-token-with-at-least-32-characters'
const request = (port: number, token: string, input: unknown) =>
  fetch(`http://127.0.0.1:${port}/api/terminals/screen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

// ConPTY translates Windows console writes before forwarding them to a PTY client.
it.skipIf(process.platform === 'win32')(
  'replays an alternate screen after the PTY history rolls over',
  async () => {
    const f = await fixture()
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
    const display = new headless.Terminal({ cols: 80, rows: 12, allowProposedApi: true })
    const sockets: WebSocket[] = []
    try {
      const { terminals, devices, tickets } = runtime.services
      devices.add('Screen client', deviceToken)
      const { id } = terminals.createCommand(
        'screen-thread',
        f.directory,
        {
          command: process.execPath,
          args: [
            '-e',
            String.raw`
        process.stdin.setRawMode(true);
        process.stdin.on('data', (input) => {
          if (input.toString() === 'q') process.stdout.write('\x1b[?1049l');
        });
        process.stdout.write('original primary screen\r\n');
        process.stdout.write('\x1b[?1049h\x1b[2J\x1b[Hheader that rolls out of raw history');
        process.stdout.write('\x1b[3;1Htext erased in place\r\x1b[2K');
        process.stdout.write('\x1b[0m'.repeat(270000), () => {
          process.stdout.write('\x1b[');
          setTimeout(() => process.stdout.write('6;9Hactive screen ready'), 25);
        });
      `,
          ],
          env: {},
        },
        'Full-screen test',
      )
      terminals.resize(id, 80, 12)
      await waitForRuntime(() => expect(terminals.get(id).buffer).toContain('active screen ready'))
      expect(terminals.get(id).buffer).not.toContain('header that rolls out of raw history')
      const response = await request(runtime.port, deviceToken, { id, lines: 24 })
      expect(response.status).toBe(200)
      const screen = await response.json()
      expect(screen).toMatchObject({
        id,
        cols: 80,
        rows: 12,
        buffer: 'alternate',
        cursor: { row: 5, column: 27 },
        truncated: false,
        text: expect.stringContaining('header that rolls out of raw history'),
      })
      expect(screen.text.split('\n')).toHaveLength(12)
      expect(screen.text).not.toContain('text erased in place')
      expect(screen.text).not.toContain('original primary screen')

      const connect = (binary: boolean) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${runtime.port}/ws/terminal?ticket=${tickets.issue(deviceToken, id)}${binary ? '&stream=binary-v1' : ''}`,
        )
        sockets.push(socket)
        return socket
      }
      const legacy = connect(false)
      const [legacyData, legacyBinary] = await once(legacy, 'message')
      expect(legacyBinary).toBe(false)
      expect(legacyData.toString()).toBe(terminals.get(id).buffer)

      const current = connect(true)
      const frames: string[] = []
      current.on('message', (data) => {
        if (!Buffer.isBuffer(data)) return
        const frame = decodeTerminalStreamFrame(data)
        frames.push(frame.type)
        if (frame.type === 'data')
          display.write(frame.data, () => {
            if (current.readyState === WebSocket.OPEN)
              current.send(JSON.stringify({ type: 'ack', bytes: frame.data.length }))
          })
      })
      await waitForRuntime(() => {
        expect(frames.at(-1)).toBe('replayEnd')
        expect(display.buffer.active.type).toBe('alternate')
        expect(display.buffer.active.getLine(0)?.translateToString(true)).toBe(
          'header that rolls out of raw history',
        )
        expect(display.buffer.active.getLine(5)?.translateToString(true)).toBe(
          '        active screen ready',
        )
        expect({
          row: display.buffer.active.cursorY,
          column: display.buffer.active.cursorX,
        }).toEqual(screen.cursor)
      })
      expect(frames[0]).toBe('replayStart')
      terminals.input(id, 'q')
      await waitForRuntime(() => {
        expect(display.buffer.active.type).toBe('normal')
        expect(display.buffer.active.getLine(0)?.translateToString(true)).toBe(
          'original primary screen',
        )
      })
      expect(await (await request(runtime.port, deviceToken, { id })).json()).toMatchObject({
        buffer: 'normal',
        text: expect.stringContaining('original primary screen'),
      })
    } finally {
      for (const socket of sockets) socket.terminate()
      display.dispose()
      await runtime.close()
      await f.cleanup()
    }
  },
)

it('advertises screen reads and limits run credentials to terminals the run owns', async () => {
  const f = await fixture()
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const s = runtime.services
    const task = decode(taskSchema, {
      id: 'screen-task',
      title: 'Screen task',
      repositoryId: 'repo',
      agentId: 'agent',
      activeRunId: 'screen-run',
      status: 'running',
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: '',
      example: false,
    })
    s.store.update(() => ({ ...f.workspace, tasks: [task] }))
    s.devices.add('Screen client', deviceToken)
    const open = (taskId: string) =>
      s.terminals.createCommand(
        taskId,
        f.directory,
        {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          env: {},
        },
        'Terminal',
      ).id
    const id = open(task.id)
    const other = open('other-thread')
    expect((await request(runtime.port, 'not-a-paired-device', { id })).status).toBe(401)
    expect((await request(runtime.port, deviceToken, { id, lines: 0 })).status).toBe(400)
    expect((await request(runtime.port, deviceToken, { id: 'missing' })).status).toBe(404)
    expect((await request(runtime.port, deviceToken, { id, lines: 1 })).status).toBe(200)
    const credential = s.runCredentials.issue(
      {
        taskId: task.id,
        runId: 'screen-run',
        readOnly: false,
        permissions: { provider: 'codex', permission: 'ask' },
        artifacts: false,
        pipelineWatching: false,
        pullRequestWatching: false,
        deviceHub: false,
        memoryScopes: [],
      },
      new AbortController().signal,
    )
    expect((await request(runtime.port, credential, { id })).status).toBe(403)
    s.runCredentials.addTerminal(credential, id)
    s.runCredentials.addTerminal(credential, other)
    expect((await request(runtime.port, credential, { id })).status).toBe(200)
    expect((await request(runtime.port, credential, { id: other })).status).toBe(403)
    s.runCredentials.revoke(credential)
    expect((await request(runtime.port, credential, { id })).status).toBe(401)
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot?scope=overview`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    })
    expect(await response.json()).toMatchObject({ terminalScreenSupported: true })
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})

it('keeps the screen readable after a multi-megabyte build log', async () => {
  const f = await fixture()
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { terminals } = runtime.services
    const { id } = terminals.createCommand(
      'screen-thread',
      f.directory,
      {
        command: process.execPath,
        args: [
          '-e',
          String.raw`
        process.stdout.write('build log row\r\n'.repeat(230000), () => {
          process.stdout.write('finished large build');
        });
      `,
        ],
        env: {},
      },
      'Large build log',
    )
    await waitForRuntime(() => expect(terminals.get(id).buffer).toContain('finished large build'))
    const response = await request(runtime.port, ownerToken, { id, lines: 40 })
    expect(response.status).toBe(200)
    const screen = await response.json()
    expect(screen).toMatchObject({
      buffer: 'normal',
      text: expect.stringContaining('finished large build'),
    })
    expect(screen.text.split('\n')).toHaveLength(40)
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
