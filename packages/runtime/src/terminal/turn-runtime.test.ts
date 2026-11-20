import { expect, it, vi } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { startRuntime } from '../index.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import { Terminals } from './terminals.js'

vi.setConfig(runtimeIntegration)

it('captures the input baseline and waits for a newer root turn through HTTP', async () => {
  const token = 'terminal-turn-owner-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const terminal = runtime.services.terminals.createCommand(
      'studio:terminals',
      process.cwd(),
      {
        command: process.execPath,
        args: [
          '-e',
          String.raw`
            const report = (word) => '\x1b]7501;state=' + word + '\x07'
            process.stdout.write(report('done') + report('working:id=child'))
            let inputs = 0
            process.stdin.on('data', () => {
              if (++inputs === 1) process.stdout.write(report('working') + report('done') + report('working'))
              else if (inputs === 2) process.stdout.write(report('done') + report('done'))
              else process.stdout.write(report('working') + '\x1b]133;A\x07\x1b]133;A\x07')
            })
          `,
        ],
        env: {},
      },
      'Agent',
    )
    const current = () => runtime.services.terminals.get(terminal.id).info
    const request = (path: string, input: object, key = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/terminals/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: terminal.id, ...input }),
      })
    const post = async (path: string, input: object) => {
      const response = await request(path, input)
      expect(response.status).toBe(200)
      return response.json()
    }
    expect(current().turn).toBe(0)
    await waitForRuntime(() => expect(current().activity?.state).toBe('done'))
    expect(await post('summary', { until: ['done'] })).toMatchObject({
      waitResult: 'activity',
      turn: 0,
    })
    expect(await post('summary', { afterTurn: 0, until: ['done'] })).toMatchObject({
      waitResult: 'timeout',
      turn: 0,
    })
    expect((await request('summary', { afterTurn: -1 })).status).toBe(400)
    expect((await request('send', { data: '\r' }, 'invalid-token')).status).toBe(401)
    expect(await post('send', { data: '\r' })).toEqual({ turn: 0 })
    await waitForRuntime(() =>
      expect(current()).toMatchObject({ turn: 1, activity: { state: 'working' } }),
    )
    expect(await post('summary', { afterTurn: 0 })).toMatchObject({
      waitResult: 'activity',
      turn: 1,
    })
    expect(await post('summary', { afterTurn: 0, until: ['done'] })).toMatchObject({
      waitResult: 'timeout',
      turn: 1,
    })
    const pending = post('summary', { afterTurn: 1, until: ['done'], waitMs: 10000 })
    await waitForRuntime(() =>
      expect(runtime.services.terminals.get(terminal.id).observers.size).toBe(1),
    )
    expect(await post('send', { data: '\r' })).toEqual({ turn: 1 })
    expect(await pending).toMatchObject({ waitResult: 'activity', turn: 2 })
    expect(current().turn).toBe(2)
    expect(await post('send', { data: '\r' })).toEqual({ turn: 2 })
    expect(await post('summary', { afterTurn: 2, waitMs: 10000 })).toMatchObject({
      waitResult: 'activity',
      turn: 3,
    })
    expect(current().activity).toBeUndefined()
    expect(current().turn).toBe(3)
  } finally {
    await runtime.close()
  }
})

it.skipIf(!['linux', 'darwin'].includes(process.platform) || !existsSync('/bin/bash'))(
  'ends the direct PTY working turn when the foreground command returns to the shell',
  async () => {
    const terminals = new Terminals()
    try {
      const { id } = terminals.createCommand(
        'studio:terminals',
        process.cwd(),
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Shell',
      )
      const current = () => terminals.get(id).info
      await waitForRuntime(() => expect(current().foregroundProcess?.idle).toBe(true))
      const agent = String.raw`process.stdout.write("\x1b]7501;state=working\x07"); setTimeout(() => {}, 200)`
      terminals.input(id, `"${process.execPath}" -e '${agent}'\r`)
      await waitForRuntime(() => expect(current().activity?.state).toBe('working'))
      await waitForRuntime(() =>
        expect(current()).toMatchObject({ foregroundProcess: { idle: true }, turn: 1 }),
      )
      expect(current().activity).toBeUndefined()
      expect(current().exited).toBe(false)
    } finally {
      await terminals.dispose()
    }
  },
)

it('shows resumed work and ignores a delayed status for an older identified turn on a direct PTY', async () => {
  const terminals = new Terminals()
  try {
    const { id } = terminals.createCommand(
      'studio:terminals',
      process.cwd(),
      {
        command: process.execPath,
        args: [
          '-e',
          String.raw`
          const report = (state, turn) => '\x1b]7501;state=' + state + ':turnId=' + turn + '\x07'
          process.stdout.write(report('working', 'A') + report('blocked', 'A'))
          const responses = [
            report('working', 'A'),
            report('done', 'A') + report('working', 'B') + report('working', 'A') + report('clear', 'A'),
            report('working', 'C') + report('done', 'B') + report('done', 'C'),
          ]
          process.stdin.on('data', () => process.stdout.write(responses.shift() ?? ''))
        `,
        ],
        env: {},
      },
      'Agent',
    )
    const status = (state: string, turnId: string, turn: number) =>
      waitForRuntime(() =>
        expect(terminals.get(id).info).toMatchObject({ activity: { state, turnId }, turn }),
      )
    await status('blocked', 'A', 1)
    terminals.input(id, '\r')
    await status('working', 'A', 1)
    terminals.input(id, '\r')
    await status('working', 'B', 1)
    terminals.input(id, '\r')
    await status('done', 'C', 3)
  } finally {
    await terminals.dispose()
  }
})
