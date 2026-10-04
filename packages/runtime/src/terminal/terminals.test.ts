import { expect, it, vi } from 'vitest'
import { Terminals } from './terminals'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'
import { stripVTControlCharacters } from 'node:util'
vi.setConfig(runtimeIntegration)
// Keep the marker out of echoed input and use the actual platform shell syntax.
const outputCommand =
  process.platform === 'win32'
    ? "Write-Output ('dovo-pty-' + 'verified')\r"
    : "printf 'dovo-pty-%s\\n' verified\r"
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
    terminals.close(session.id)
    expect(terminals.list()).toEqual([])
    await terminals.dispose()
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
    terminals.close(first.id)
    expect((await terminals.ensure('task', directory)).id).not.toBe(first.id)
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})
it('runs a real PTY and retains output when clients detach', async () => {
  const f = await fixture(),
    terminals = new Terminals()
  try {
    const session = terminals.create('task', f.directory)
    let output = ''
    const detachOutput = terminals.attach(session.id, (data) => {
      output += data
    })
    // PowerShell's line editor can lose input sent before its first prompt is ready.
    await waitForRuntime(() =>
      expect(
        process.platform !== 'win32' || /PS [^\r\n]*> /.test(stripVTControlCharacters(output)),
      ).toBe(true),
    )
    terminals.input(session.id, outputCommand)
    await waitForRuntime(() => expect(output).toContain('dovo-pty-verified'))
    detachOutput()
    let replay = ''
    const detach = terminals.attach(session.id, (data) => {
      replay += data
    })
    expect(replay).toContain('dovo-pty-verified')
    detach()
    terminals.resize(session.id, 80, 30)
    terminals.close(session.id)
    expect(terminals.list()).toEqual([])
  } finally {
    await terminals.dispose()
    await f.cleanup()
  }
})
it('keeps delivering terminal output when one client throws', async () => {
  const f = await fixture(),
    terminals = new Terminals()
  const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const session = terminals.create('task', f.directory)
    let armed = false
    terminals.attach(session.id, (data) => {
      if (armed && data) throw new Error('closed client')
    })
    armed = true
    let output = ''
    terminals.attach(session.id, (data) => {
      output += data
    })
    await waitForRuntime(() =>
      expect(
        process.platform !== 'win32' || /PS [^\r\n]*> /.test(stripVTControlCharacters(output)),
      ).toBe(true),
    )
    terminals.input(session.id, outputCommand)
    await waitForRuntime(() => expect(output).toContain('dovo-pty-verified'))
    expect(reported).toHaveBeenCalled()
    terminals.close(session.id)
  } finally {
    reported.mockRestore()
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
