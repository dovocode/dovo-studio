import { expect, it, vi } from 'vite-plus/test'
import { Terminals } from './terminals'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'
import { createServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
vi.setConfig(runtimeIntegration)
function killIfRunning(pid: number) {
  try {
    process.kill(pid)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

it('keeps the runtime listener port out of project commands but honors command overrides', async () => {
  const f = await fixture()
  const terminals = new Terminals()
  const runtimeListener = createServer()
  try {
    await new Promise<void>((resolve) => runtimeListener.listen(0, '127.0.0.1', resolve))
    const address = runtimeListener.address()
    if (!address || typeof address === 'string') throw new Error('Invalid listener fixture')
    vi.stubEnv('PORT', String(address.port))
    const session = terminals.createCommand(
      'task',
      f.directory,
      {
        command: process.execPath,
        args: [
          '-e',
          `const server = require('node:net').createServer();
           server.on('error', error => { console.log(error.code); process.exit(1); });
           server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => console.log('project-port:' + server.address().port));`,
        ],
        env: {},
      },
      'Project server',
    )
    await waitForRuntime(() => {
      const output = terminals.get(session.id).buffer
      expect(output).not.toContain('EADDRINUSE')
      const match = output.match(/project-port:(\d+)/)
      expect(match).not.toBeNull()
      expect(Number(match![1])).not.toBe(address.port)
    })
    const explicit = terminals.createCommand(
      'task',
      f.directory,
      {
        command: process.execPath,
        args: ['-e', "console.log('configured-port:' + process.env.PORT)"],
        env: { PORT: '24680' },
      },
      'Configured command',
    )
    await waitForRuntime(() =>
      expect(terminals.get(explicit.id).buffer).toContain('configured-port:24680'),
    )
    expect(runtimeListener.listening).toBe(true)
  } finally {
    vi.unstubAllEnvs()
    await terminals.dispose()
    await new Promise<void>((resolve) => runtimeListener.close(() => resolve()))
    await f.cleanup()
  }
})

for (const foreground of [false, true])
  it.skipIf(process.platform === 'win32')(
    `releases a child server port after closing its ${foreground ? 'interactive foreground' : 'launcher'} terminal`,
    async () => {
      const f = await fixture()
      const terminals = new Terminals()
      const unrelated = createServer()
      let descendantPid: number | undefined
      let replacement: ReturnType<typeof createServer> | undefined
      try {
        await new Promise<void>((resolve) => unrelated.listen(0, '127.0.0.1', resolve))
        const record = join(f.directory, 'listener.json')
        const source = `
          process.on('SIGHUP', () => {});
          process.on('SIGTERM', () => {});
          const server = require('node:net').createServer();
          server.listen(0, '127.0.0.1', () => {
            require('node:fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,port:server.address().port}));
            console.log('listener-ready');
          });`
        const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
        const session = terminals.createCommand(
          'task',
          f.directory,
          foreground
            ? {
                command: '/bin/bash',
                // The trailing command keeps bash alive while job control gives the server its own group.
                args: [
                  '--noprofile',
                  '--norc',
                  '-i',
                  '-c',
                  `${quote(process.execPath)} -e ${quote(source)} ${quote(record)}; :`,
                ],
                env: {},
              }
            : {
                command: process.execPath,
                args: [
                  '-e',
                  `require('node:child_process').spawn(process.execPath, ['-e', process.argv[1], process.argv[2]], {stdio:'inherit'}); setInterval(()=>{},1000)`,
                  source,
                  record,
                ],
                env: {},
              },
          'Child server',
        )
        let port = 0
        await waitForRuntime(async () => {
          const saved: unknown = JSON.parse(await readFile(record, 'utf8'))
          if (
            !saved ||
            typeof saved !== 'object' ||
            !('pid' in saved) ||
            typeof saved.pid !== 'number' ||
            !('port' in saved) ||
            typeof saved.port !== 'number'
          )
            throw new Error('Invalid listener fixture')
          descendantPid = saved.pid
          port = saved.port
          expect(terminals.get(session.id).buffer).toContain('listener-ready')
        })
        const rootPid = terminals.get(session.id).process.pid
        const detach = terminals.attach(session.id, () => {})
        detach()
        const reattach = terminals.attach(session.id, () => {})
        expect((await terminals.ensure('task', async () => f.directory)).id).toBe(session.id)
        expect(terminals.get(session.id).process.pid).toBe(rootPid)
        reattach()
        await terminals.close(session.id)
        await terminals.dispose()
        replacement = createServer()
        await new Promise<void>((resolve, reject) => {
          replacement!.once('error', reject)
          replacement!.listen(port, '127.0.0.1', resolve)
        })
        expect(unrelated.listening).toBe(true)
      } finally {
        if (descendantPid) killIfRunning(descendantPid)
        if (replacement?.listening)
          await new Promise<void>((resolve) => replacement!.close(() => resolve()))
        await new Promise<void>((resolve) => unrelated.close(() => resolve()))
        await terminals.dispose()
        await f.cleanup()
      }
    },
  )
it.skipIf(process.platform !== 'win32')(
  'closes the Windows pseudoconsole and its child processes',
  async () => {
    const f = await fixture()
    const terminals = new Terminals()
    let descendantPid: number | undefined
    try {
      const session = terminals.createCommand(
        'task',
        f.directory,
        {
          command: process.execPath,
          args: [
            '-e',
            `const { spawn } = require('node:child_process');
             const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
             console.log('descendant:' + child.pid);
             setInterval(() => {}, 1000);`,
          ],
          env: {},
        },
        'Owned process tree',
      )
      await waitForRuntime(() => {
        const match = terminals.get(session.id).buffer.match(/descendant:(\d+)/)
        expect(match).not.toBeNull()
        descendantPid = Number(match![1])
      })
      await terminals.close(session.id)
      await terminals.dispose()
      await waitForRuntime(() => expect(() => process.kill(descendantPid!, 0)).toThrow(/ESRCH/))
    } finally {
      await terminals.dispose()
      // Keep failed regression runs from leaving a background process behind.
      if (descendantPid) killIfRunning(descendantPid)
      await f.cleanup()
    }
  },
)
it.skipIf(process.platform === 'win32')('stops commands that ignore terminal hangup', async () => {
  const f = await fixture()
  const terminals = new Terminals()
  try {
    const session = terminals.createCommand(
      'task',
      f.directory,
      {
        command: process.execPath,
        args: [
          '-e',
          "process.on('SIGHUP', () => {}); console.log('hangup-ready'); setInterval(() => {}, 1000)",
        ],
        env: {},
      },
      'Ignores hangup',
    )
    const child = terminals.get(session.id)
    await waitForRuntime(() => expect(child.buffer).toContain('hangup-ready'))
    await terminals.close(session.id)
    await terminals.dispose()
    expect(child.info.exited).toBe(true)
    expect(() => process.kill(child.process.pid, 0)).toThrow(/ESRCH/)
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})
it('waits for previously closed terminals to exit before completing disposal', async () => {
  const f = await fixture()
  const terminals = new Terminals()
  try {
    const session = terminals.createCommand(
      'task',
      f.directory,
      {
        command: process.execPath,
        args: ['-e', 'console.log("terminal-ready"); setInterval(() => {}, 1000)'],
        env: {},
      },
      'Owned process',
    )
    let exited = false
    terminals.get(session.id).process.onExit(() => {
      exited = true
    })
    const closed = terminals.close(session.id)
    expect(terminals.list()).toEqual([])
    await terminals.dispose()
    await closed
    expect(exited).toBe(true)
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})
it('reuses a live shell across simultaneous terminal openings', async () => {
  const f = await fixture()
  const terminals = new Terminals()
  try {
    const directory = vi.fn<() => Promise<string>>(async () => f.directory)
    const [first, second] = await Promise.all([
      terminals.ensure('task', directory),
      terminals.ensure('task', directory),
    ])
    expect(first.id).toBe(second.id)
    expect(directory).toHaveBeenCalledTimes(1)
    expect((await terminals.ensure('task', directory)).id).toBe(first.id)
    await terminals.close(first.id)
    expect((await terminals.ensure('task', directory)).id).not.toBe(first.id)
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})

it('reclaims exited unattended sessions while preserving observed output and the live limit', async () => {
  const f = await fixture()
  const terminals = new Terminals()
  try {
    const first = terminals.createCommand(
      'task',
      f.directory,
      { command: process.execPath, args: ['-e', 'console.log("retained-output")'], env: {} },
      'Observed',
    )
    const detach = terminals.attach(first.id, () => {})
    for (let index = 1; index < 20; index++)
      terminals.createCommand(
        'task',
        f.directory,
        { command: process.execPath, args: ['-e', ''], env: {} },
        'Finished',
      )
    await vi.waitFor(() => expect(terminals.list().every((session) => session.exited)).toBe(true), {
      timeout: 10000,
    })
    const next = terminals.create('task', f.directory)
    expect(terminals.list()).toHaveLength(20)
    expect(terminals.get(first.id).buffer).toContain('retained-output')
    expect(terminals.get(next.id).info.exited).toBe(false)
    detach()
    await terminals.dispose()
    for (let index = 0; index < 20; index++) terminals.create('task', f.directory)
    expect(() => terminals.create('task', f.directory)).toThrow('limit 20')
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})
