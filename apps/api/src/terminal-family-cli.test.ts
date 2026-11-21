import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { it, expect } from 'vite-plus/test'

it.skipIf(process.platform === 'win32')(
  'starts real child shells from their parent, waits, and receives child changes after a runtime restart',
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'dovo-terminal-family-cli-'))
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      SHELL: '/bin/sh',
      DOVO_LOGIN_PATH: 'off',
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_STATE_HOME: join(home, 'state'),
      XDG_DATA_HOME: join(home, 'xdg-data'),
      CODEX_HOME: join(home, 'codex'),
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
      PI_CODING_AGENT_DIR: join(home, 'pi'),
    }
    const data = join(home, 'runtime')
    const cli = [
      fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
      '--data-dir',
      data,
    ]
    const dovo = (...args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [...cli, ...args],
          { cwd: home, env, timeout: 20_000 },
          (error, stdout, stderr) => {
            resolve({
              code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
              stdout,
              stderr,
            })
          },
        )
      })
    const ok = async (...args: string[]) => {
      const result = await dovo(...args)
      if (result.code !== 0)
        throw new Error(
          `CLI ${args.join(' ')} exited ${result.code}: ${result.stderr || result.stdout}`,
        )
      return result.stdout
    }
    const terminal = (...args: string[]) => ok('terminal', ...args)
    const childArgs = [
      'terminal',
      'start',
      '--parent',
      'self',
      '--name',
      'reviewer',
      '--command',
      'exec node worker.cjs',
    ]
    writeFileSync(
      join(home, 'launch-child.cjs'),
      `require('node:child_process').execFileSync(process.execPath, ${JSON.stringify([...cli, ...childArgs])}, {stdio:'inherit'})`,
    )
    writeFileSync(
      join(home, 'worker.cjs'),
      String.raw`
      const report = state => process.stdout.write('\x1b]7501;state=' + state + '\x07')
      process.stdin.setRawMode(true)
      process.stdin.on('data', data => report(data.toString() === 'b' ? 'blocked:kind=permission' : 'done'))
      report('working')
    `,
    )
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const address = probe.address()
        probe.close(() => resolve(address && typeof address === 'object' ? address.port : 0))
      })
    })
    try {
      await ok('setup', '--host', '127.0.0.1', '--port', String(port))
      await ok('start')
      const parentId = (await terminal('start', '--name', 'coordinator')).trim()
      const wait = (mode: string) =>
        dovo('terminal', 'wait', parentId, '--children', mode, '--timeout', '0', '--json')
      expect(JSON.parse((await wait('any')).stdout)).toEqual({ ready: true, children: [] })
      expect(JSON.parse((await wait('all')).stdout)).toEqual({ ready: true, children: [] })
      await terminal('send', parentId, '--enter', 'node launch-child.cjs')
      const workerId = (
        await terminal(
          'start',
          '--name',
          'worker',
          '--parent',
          'coordinator',
          '--command',
          'exec node worker.cjs',
        )
      ).trim()
      await terminal('start', '--name', 'unrelated', '--no-remember')
      const children = async () => {
        const progress = await wait('all')
        expect(progress).toMatchObject({ code: 124, stderr: '' })
        return JSON.parse(progress.stdout).children
      }
      const live = expect.objectContaining({
        parentTerminalId: parentId,
        activity: expect.objectContaining({ state: 'working' }),
      })
      await expect.poll(children, { timeout: 10_000 }).toEqual([live, live])
      await terminal('send', 'reviewer', 'b')
      const ready = JSON.parse(
        await terminal('wait', parentId, '--children', 'any', '--timeout', '5', '--json'),
      )
      expect(ready).toMatchObject({
        ready: true,
        children: [
          {
            title: 'reviewer',
            parentTerminalId: parentId,
            activity: { state: 'blocked', kind: 'permission' },
          },
        ],
      })
      const reviewerId = ready.children[0].id
      expect(await children()).toHaveLength(2)
      await ok('stop')
      await ok('start')
      const expectedNotice = { terminalId: reviewerId, state: 'blocked', turn: 1 }
      await expect
        .poll(
          async () => JSON.parse(await terminal('read', parentId, '--tail', '--json')).childNotices,
          { timeout: 10_000 },
        )
        .toContainEqual(expectedNotice)

      const events = spawn(process.execPath, [...cli, 'terminal', 'events', parentId], {
        cwd: home,
        env,
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      const exit = once(events, 'exit')
      const lines = createInterface({ input: events.stdout })
      const timer = setTimeout(() => events.kill('SIGTERM'), 30_000)
      try {
        const stream = lines[Symbol.asyncIterator]()
        const snapshot = await stream.next()
        expect(snapshot.done).toBe(false)
        expect(JSON.parse(snapshot.value!)).toMatchObject({
          type: 'snapshot',
          terminals: [{ id: parentId, childNotices: expect.arrayContaining([expectedNotice]) }],
        })
        await terminal('send', workerId, 'd')
        let reported = false
        for await (const line of stream) {
          const event = JSON.parse(line)
          if (
            event.type === 'changed' &&
            event.terminal.id === parentId &&
            event.terminal.childNotices?.some(
              (notice: { terminalId: string; state: string; turn: number }) =>
                notice.terminalId === workerId && notice.state === 'done' && notice.turn === 1,
            )
          ) {
            reported = true
            break
          }
        }
        expect(reported, 'The parent event stream must report the completed child turn').toBe(true)
      } finally {
        clearTimeout(timer)
        events.kill('SIGINT')
        await exit
        lines.close()
      }
      const result = JSON.parse((await wait('all')).stdout)
      expect(result.ready).toBe(true)
      expect(result.children).toHaveLength(2)
      expect(result.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: reviewerId,
            activity: expect.objectContaining({ state: 'blocked' }),
          }),
          expect.objectContaining({
            id: workerId,
            activity: expect.objectContaining({ state: 'done' }),
          }),
        ]),
      )
      const detach = async () => JSON.parse(await terminal('detach-parent', 'reviewer', '--json'))
      expect(await detach()).toMatchObject({ id: reviewerId, exited: false })
      expect(await detach()).not.toHaveProperty('parentTerminalId')
      expect(
        JSON.parse((await wait('all')).stdout).children.map((child: { id: string }) => child.id),
      ).toEqual([workerId])
      expect(
        JSON.parse(await terminal('read', parentId, '--tail', '--json')).childNotices,
      ).not.toContainEqual(expectedNotice)
    } finally {
      await Promise.all(['reviewer', 'worker'].map((name) => dovo('terminal', 'close', name)))
      await Promise.all(['coordinator', 'unrelated'].map((name) => dovo('terminal', 'close', name)))
      await dovo('stop')
      rmSync(home, { recursive: true, force: true })
    }
  },
  180_000,
)
