import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, responses, snapshotSchema, type TerminalInfo } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
const ownerToken = 'terminal-family-owner-token-with-at-least-32-characters'
const pairedToken = 'terminal-family-paired-token-with-at-least-32-characters'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  } finally {
    vi.unstubAllEnvs()
  }
})

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function setup(remembered = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  for (const key of [
    'HOME',
    'CODEX_HOME',
    'CLAUDE_CONFIG_DIR',
    'PI_CODING_AGENT_DIR',
    'XDG_CONFIG_HOME',
  ]) {
    const directory = join(f.directory, key)
    await mkdir(directory)
    vi.stubEnv(key, directory)
  }
  vi.stubEnv('DOVO_TERMINAL_HOLDER_SUPERVISOR', '')
  vi.stubEnv('DOVO_TERMINAL_ID', 'inherited-terminal')
  await writeFile(
    join(f.directory, 'agent.cjs'),
    String.raw`
    const { appendFileSync, writeFileSync } = require('node:fs')
    const { createInterface } = require('node:readline')
    const [name, initial] = process.argv.slice(2)
    const report = (state) => process.stdout.write('\x1b]7501;state=' + state + '\x07')
    writeFileSync('id-' + name, process.env.DOVO_TERMINAL_ID || '')
    if (initial !== 'unreported') report(initial)
    createInterface({ input: process.stdin }).on('line', (line) => {
      appendFileSync('input-' + name, line + '\n')
      if (line === 'exit') return process.exit(7)
      report(line)
    })
  `,
  )
  const makeRuntime = async () => {
    const runtime = await startRuntime({
      databasePath: remembered ? join(f.directory, 'runtime.sqlite') : ':memory:',
      ownerToken,
      port: 0,
    })
    cleanups.push(runtime.close)
    return runtime
  }
  let runtime = await makeRuntime()
  runtime.services.commands.save({ shell: '/bin/bash', shellArgs: ['--noprofile', '--norc', '-i'] })
  runtime.services.devices.add('Paired family client', pairedToken)
  const restart = async () => {
    await cleanups.pop()!()
    runtime = await makeRuntime()
  }
  const request = (path: string, input: unknown, token = ownerToken, signal?: AbortSignal) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/terminals/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  const post = async (path: string, input: unknown, token?: string) => {
    const response = await request(path, input, token)
    expect(response.status).toBe(200)
    return response.json()
  }
  const launch = async (name: string, state = 'unreported', parentTerminalId?: string) =>
    decode(
      responses.terminal,
      await post('workspace', {
        name,
        workingDirectory: f.directory,
        command: `exec "${process.execPath}" agent.cjs ${name} ${state}`,
        rememberSession: remembered,
        parentTerminalId,
        requestId: name,
      }),
    )
  const snapshot = async () => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot?scope=overview`, {
      headers: { Authorization: `Bearer ${pairedToken}` },
    })
    expect(response.status).toBe(200)
    return decode(snapshotSchema, await response.json())
  }
  const current = (id: string) => runtime.services.terminals.get(id)
  const wait = async (id: string, until: 'any' | 'all', waitMs?: number) =>
    (await post('children', { id, until, waitMs }, pairedToken)) as {
      children: TerminalInfo[]
      ready: boolean
    }
  return { ...f, launch, post, request, wait, current, snapshot, restart, runtime }
}

it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
  'waits for direct standalone children and records their news without writing to the parent PTY',
  async () => {
    const f = await setup()
    const parent = await f.launch('parent', 'working')
    expect(await f.wait(parent.id, 'any')).toEqual({ ready: true, children: [] })
    expect(await f.wait(parent.id, 'all')).toEqual({ ready: true, children: [] })
    const blocked = await f.launch('reviewer', 'working', parent.id)
    const busy = await f.launch('builder', 'working', parent.id)
    const quiet = await f.launch('quiet', 'unreported', parent.id)
    const unrelated = await f.launch('unrelated', 'done')
    const grandchild = await f.launch('grandchild', 'blocked', blocked.id)
    const split = decode(
      responses.terminal,
      await f.post('workspace', { sourceTerminalId: parent.id, name: 'split' }),
    )
    expect(split.parentTerminalId).toBeUndefined()
    await waitForRuntime(async () => {
      for (const terminal of [parent, blocked, busy, quiet, unrelated, grandchild]) {
        expect(await readFile(join(f.directory, `id-${terminal.title}`), 'utf8')).toBe(terminal.id)
      }
      expect(f.current(busy.id).info.activity?.state).toBe('working')
      expect(f.current(blocked.id).info.activity?.state).toBe('working')
      expect(f.current(grandchild.id).info.activity?.state).toBe('blocked')
    })
    const pending = f.wait(parent.id, 'any', 10_000)
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(1))
    await f.post('send', { id: blocked.id, data: 'blocked:kind=permission:msg=Y2hpbGQgZGV0YWls\r' })
    expect(await pending).toMatchObject({
      ready: true,
      children: [{ id: blocked.id, activity: { state: 'blocked', kind: 'permission' }, turn: 1 }],
    })
    const timedOut = await f.wait(parent.id, 'all', 25)
    expect(timedOut.ready).toBe(false)
    expect(timedOut.children.map(({ id }) => id)).toEqual([blocked.id, busy.id, quiet.id])
    await f.post('send', { id: busy.id, data: 'done\r' })
    await waitForRuntime(() => expect(f.current(busy.id).info.activity?.state).toBe('done'))
    // Unreported terminals are still pending. A child that reports idle can finish an all wait.
    expect((await f.wait(parent.id, 'all')).ready).toBe(false)
    const pendingAll = f.wait(parent.id, 'all', 10_000)
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(1))
    await f.post('send', { id: quiet.id, data: 'idle\r' })
    expect(await pendingAll).toMatchObject({
      ready: true,
      children: [
        { id: blocked.id, activity: { state: 'blocked' } },
        { id: busy.id, activity: { state: 'done' } },
        { id: quiet.id, activity: { state: 'idle' } },
      ],
    })
    const snapshot = await f.snapshot()
    expect(snapshot.terminals?.find(({ id }) => id === parent.id)).toMatchObject({
      activity: { state: 'working' },
      turn: 0,
      childNotices: [
        { terminalId: blocked.id, state: 'blocked', turn: 1 },
        { terminalId: busy.id, state: 'done', turn: 1 },
      ],
    })
    expect(existsSync(join(f.directory, 'input-parent'))).toBe(false)
    await f.post('send', { id: busy.id, data: 'exit\r' })
    await waitForRuntime(() =>
      expect(f.current(parent.id).info.childNotices).toContainEqual({
        terminalId: busy.id,
        state: 'exited',
        turn: 1,
      }),
    )
    await f.post('close', { id: busy.id })
    expect(f.current(parent.id).info.childNotices?.map(({ terminalId }) => terminalId)).toEqual([
      blocked.id,
    ])
    expect(f.current(parent.id).observers.size).toBe(0)
  },
)

it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
  'rejects invalid parents and releases waits when the request or parent closes',
  async () => {
    const f = await setup()
    const parent = await f.launch('parent')
    const child = await f.launch('child', 'working', parent.id)
    const thread = f.runtime.services.terminals.create('some-thread', f.directory)
    const createChild = (parentTerminalId: string, other: object = {}) =>
      f.request('workspace', { parentTerminalId, ...other })
    expect((await createChild('missing')).status).toBe(404)
    expect((await createChild(thread.id)).status).toBe(400)
    expect((await createChild(parent.id, { sourceTerminalId: parent.id })).status).toBe(400)
    expect((await f.request('children', { id: thread.id, until: 'any' })).status).toBe(400)
    expect(
      (await f.request('children', { id: parent.id, until: 'all', waitMs: 20_001 })).status,
    ).toBe(400)
    expect((await f.request('children', { id: parent.id, until: 'any' }, 'invalid')).status).toBe(
      401,
    )
    const detached = await f.launch('detached', 'working', parent.id)
    const detach = () => f.post('update', { id: detached.id, parentTerminalId: null }, pairedToken)
    await f.post('send', { id: child.id, data: 'done\r' })
    await waitForRuntime(() => expect(f.current(child.id).info.activity?.state).toBe('done'))
    const detachWait = f.wait(parent.id, 'all', 10_000)
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(1))
    await detach()
    expect(await detachWait).toMatchObject({ ready: true, children: [{ id: child.id }] })
    expect((await detach()).parentTerminalId).toBeUndefined()
    expect(f.current(detached.id).info.exited).toBe(false)
    await f.post('send', { id: child.id, data: 'working\r' })
    await waitForRuntime(() => expect(f.current(child.id).info.activity?.state).toBe('working'))
    const controller = new AbortController()
    const cancelled = f.request(
      'children',
      { id: parent.id, until: 'all', waitMs: 15_000 },
      ownerToken,
      controller.signal,
    )
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(1))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(0))

    const waiting = f.request('children', { id: parent.id, until: 'all', waitMs: 15_000 })
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(1))
    await f.post('close', { id: parent.id })
    expect((await waiting).status).toBe(409)
    expect(f.current(child.id).info.parentTerminalId).toBeUndefined()
    expect(f.current(child.id).info.exited).toBe(false)
    expect((await createChild(parent.id)).status).toBe(404)
    expect((await f.launch('child', 'working', parent.id)).id).toBe(child.id)
  },
)

it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
  'preserves remembered children and their notices through runtime restart',
  async () => {
    const f = await setup(true)
    const parent = await f.launch('parent', 'idle')
    const child = await f.launch('child', 'blocked', parent.id)
    await waitForRuntime(() =>
      expect(f.current(parent.id).info.childNotices).toEqual([
        { terminalId: child.id, state: 'blocked', turn: 0 },
      ]),
    )
    const pid = f.current(child.id).process?.pid
    expect(pid).toBeGreaterThan(0)
    await f.restart()
    expect((await f.launch('child', 'blocked', parent.id)).id).toBe(child.id)
    expect(f.current(child.id).info.parentTerminalId).toBe(parent.id)
    expect(f.current(parent.id).info.childNotices).toEqual([
      { terminalId: child.id, state: 'blocked', turn: 0 },
    ])
    await waitForRuntime(() => {
      expect(f.current(child.id).process?.pid).toBe(pid)
      expect(f.current(child.id).info.activity?.state).toBe('blocked')
    })
    expect(await f.wait(parent.id, 'all')).toMatchObject({
      ready: true,
      children: [{ id: child.id, activity: { state: 'blocked' } }],
    })
    await f.post('close', { id: parent.id })
    await f.restart()
    expect(f.current(child.id).info.parentTerminalId).toBeUndefined()
    await waitForRuntime(() => expect(f.current(child.id).process?.pid).toBe(pid))
    await f.post('close', { id: child.id })
  },
)

it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
  'keeps sleeping and exited child results through sibling close and runtime restart',
  async () => {
    const f = await setup(true)
    const parent = await f.launch('parent', 'idle')
    const sleepy = await f.launch('sleeper', 'working', parent.id)
    const failed = await f.launch('failure', 'working', parent.id)
    const other = await f.launch('other', 'working', parent.id)
    const checkpoint = join(f.directory, 'terminal-recovery', sleepy.id)
    await writeFile(
      join(checkpoint, 'state.json'),
      JSON.stringify({
        target: { provider: 'codex', sessionId: 'sleep-test', directory: f.directory },
      }),
    )
    await f.post('send', { id: sleepy.id, data: 'done:app=codex\r' })
    await waitForRuntime(() =>
      expect(f.current(sleepy.id).info).toMatchObject({
        activity: { state: 'done' },
        recoveryProgram: 'codex',
      }),
    )
    const held = f.current(sleepy.id).held!
    const pid = held.pid
    vi.spyOn(held, 'close').mockImplementationOnce(async () => {
      expect(existsSync(join(checkpoint, 'closing'))).toBe(true)
      throw new Error('holder temporarily unavailable')
    })
    await f.post('update', { id: sleepy.id, settled: true })
    await waitForRuntime(() =>
      expect(f.current(sleepy.id).info.recoveryError).toContain('temporarily unavailable'),
    )
    expect(f.current(sleepy.id).held).toBe(held)
    expect(f.current(sleepy.id).recovery?.held).toBe(true)
    expect(existsSync(join(checkpoint, 'closing'))).toBe(false)
    await f.post('update', { id: sleepy.id, settled: false })
    // Simulate a process interruption after freeze and before the holder confirmed sleep.
    await writeFile(join(checkpoint, 'closing'), '')
    await f.restart()
    await waitForRuntime(() => {
      expect(f.current(sleepy.id).process?.pid).toBe(pid)
      expect(existsSync(join(checkpoint, 'closing'))).toBe(false)
    })

    // Retry sleep and wait until the holder confirms that the PTY ended.
    await f.post('update', { id: sleepy.id, settled: true })
    await waitForRuntime(() => expect(f.current(sleepy.id).recovery?.held).toBe(false))
    expect((await f.wait(parent.id, 'any')).children).toMatchObject([
      { id: sleepy.id, activity: { state: 'done' } },
    ])
    const all = f.wait(parent.id, 'all', 10_000)
    await waitForRuntime(() => expect(f.current(parent.id).observers.size).toBe(1))
    await Promise.all([
      f.post('send', { id: failed.id, data: 'error:msg=ZmFpbGVk\rexit\r' }),
      f.post('close', { id: other.id }),
    ])
    const result = await all
    expect(result.ready).toBe(true)
    expect(result.children.map((child) => child.id)).toEqual([sleepy.id, failed.id])
    await waitForRuntime(() => expect(f.current(failed.id).info.exited).toBe(true))
    await f.restart()
    const final = [
      { id: sleepy.id, dormant: true, activity: { state: 'done' } },
      { id: failed.id, exited: true, exitCode: 7, activity: { state: 'error', message: 'failed' } },
    ]
    expect(await f.wait(parent.id, 'all')).toMatchObject({ ready: true, children: final })
    expect(await f.wait(parent.id, 'any')).toMatchObject({ ready: true, children: final })
    for (const terminal of [sleepy, failed, parent]) await f.post('close', { id: terminal.id })
  },
)

it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
  'waits for an in-flight sleep to release its checkpoint before runtime shutdown',
  async () => {
    const f = await setup(true)
    const child = await f.launch('sleeper', 'done:app=codex')
    const checkpoint = join(f.directory, 'terminal-recovery', child.id)
    await writeFile(
      join(checkpoint, 'state.json'),
      JSON.stringify({
        target: { provider: 'codex', sessionId: 'interrupted-sleep', directory: f.directory },
      }),
    )
    await waitForRuntime(() => expect(f.current(child.id).info.recoveryProgram).toBe('codex'))
    const terminal = f.current(child.id).held!
    const pid = terminal.pid
    const started = gate()
    const release = gate()
    vi.spyOn(terminal, 'close').mockImplementationOnce(async () => {
      started.resolve()
      await release.promise
      throw new Error('holder unavailable during sleep')
    })
    await f.post('update', { id: child.id, settled: true })
    await started.promise
    const terminals = f.runtime.services.terminals
    const disposing = gate()
    const dispose = terminals.dispose.bind(terminals)
    vi.spyOn(terminals, 'dispose').mockImplementationOnce(() => {
      const result = dispose()
      disposing.resolve()
      return result
    })
    const restarted = f.restart()
    try {
      await disposing.promise
      expect(existsSync(join(checkpoint, 'closing'))).toBe(true)
      expect(terminals.get(child.id).held).toBe(terminal)
    } finally {
      release.resolve()
      await restarted
    }
    await f.post('update', { id: child.id, settled: false })
    await waitForRuntime(() => {
      expect(f.current(child.id).process?.pid).toBe(pid)
      expect(existsSync(join(checkpoint, 'closing'))).toBe(false)
    })
    await f.post('close', { id: child.id })
  },
)
