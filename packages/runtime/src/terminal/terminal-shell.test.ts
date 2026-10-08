import { expect, it, vi } from 'vite-plus/test'
import { stripVTControlCharacters } from 'node:util'
import { Terminal } from '@xterm/headless'
import { Terminals } from './terminals'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

// Cold Windows PowerShell startup can exceed ten seconds on hosted runners.
// Keep prompt startup separate from command delivery and leave time for cleanup.
vi.setConfig({ ...runtimeIntegration, testTimeout: process.platform === 'win32' ? 45_000 : 30_000 })
async function waitForPrompt(terminals: Terminals, id: string, output: () => string) {
  await vi.waitFor(
    () => {
      const session = terminals.get(id)
      expect({
        ready:
          process.platform !== 'win32' || /PS [^\r\n]*>/.test(stripVTControlCharacters(output())),
        exited: session.info.exited,
        exitCode: session.info.exitCode,
        output: output(),
      }).toMatchObject({ ready: true, exited: false })
    },
    { timeout: process.platform === 'win32' ? 20_000 : 10_000 },
  )
}

// Keep the marker out of echoed input and use the actual platform shell syntax.
const outputCommand =
  process.platform === 'win32'
    ? "Write-Output ('dovo-pty-' + 'verified')\r"
    : "printf 'dovo-pty-%s\\n' verified\r"
it('runs a real PTY and retains output when clients detach', async () => {
  const f = await fixture(),
    terminals = new Terminals(),
    display = new Terminal({ cols: 100, rows: 24 })
  try {
    const session = terminals.create('task', f.directory)
    // Act like the app's xterm client: ConPTY waits for terminal query replies at startup.
    display.onData((data) => terminals.input(session.id, data))
    const detachDisplay = terminals.attach(session.id, (data) => display.write(data))
    let output = ''
    const detachOutput = terminals.attach(session.id, (data) => {
      output += data
    })
    // ConPTY may encode the prompt's trailing space as cursor movement rather than text.
    // Wait for the prompt itself before sending input to PowerShell's line editor.
    await waitForPrompt(terminals, session.id, () => output)
    terminals.input(session.id, outputCommand)
    await waitForRuntime(() => expect(output).toContain('dovo-pty-verified'))
    detachDisplay()
    detachOutput()
    let replay = ''
    const detach = terminals.attach(session.id, (data) => {
      replay += data
    })
    expect(replay).toContain('dovo-pty-verified')
    detach()
    terminals.resize(session.id, 80, 30)
    await terminals.close(session.id)
    expect(terminals.list()).toEqual([])
  } finally {
    display.dispose()
    await terminals.dispose()
    await f.cleanup()
  }
})
it('keeps delivering terminal output when one client throws', async () => {
  const f = await fixture(),
    terminals = new Terminals(),
    display = new Terminal({ cols: 100, rows: 24 })
  const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const session = terminals.create('task', f.directory)
    // Act like the app's xterm client: ConPTY waits for terminal query replies at startup.
    display.onData((data) => terminals.input(session.id, data))
    terminals.attach(session.id, (data) => display.write(data))
    let armed = false
    terminals.attach(session.id, (data) => {
      if (armed && data) throw new Error('closed client')
    })
    armed = true
    let output = ''
    terminals.attach(session.id, (data) => {
      output += data
    })
    await waitForPrompt(terminals, session.id, () => output)
    terminals.input(session.id, outputCommand)
    await waitForRuntime(() => expect(output).toContain('dovo-pty-verified'))
    expect(reported).toHaveBeenCalled()
    await terminals.close(session.id)
  } finally {
    display.dispose()
    reported.mockRestore()
    await terminals.dispose()
    await f.cleanup()
  }
})
