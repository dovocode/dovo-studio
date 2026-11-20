import { expect, it, vi } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import { TerminalRecovery } from './recovery.js'
import { Terminals } from './terminals.js'

vi.setConfig(runtimeIntegration)

it('uses a contiguous suffix for partial VT and refuses a checkpoint that rolled out or predates a resize', async () => {
  const { HolderOutput, HOLDER_REPLAY_LIMIT } = await import('./holder-protocol.js')
  const { HolderScreenReplay } = await import('./holder-screen-replay.js')
  const { TerminalScreenState } = await import('./screen.js')
  const raw = new HolderOutput()
  const state = new HolderScreenReplay(raw, new TerminalScreenState(20, 4), 20, 4)
  try {
    state.write('left')
    await state.prepare()
    state.write('\x1b[')
    await state.prepare()
    expect(state.full()).toMatchObject({
      screen: { kind: 'checkpoint', offset: 4, cols: 20, rows: 4 },
      rawPrefix: 'left',
      replay: '\x1b[',
    })
    state.resize(22, 6)
    await state.prepare()
    expect(state.full()).toEqual({ screen: { kind: 'unavailable' }, replay: 'left\x1b[' })
    state.write('2J\x1b]0;' + 'x'.repeat(HOLDER_REPLAY_LIMIT))
    await state.prepare()
    expect(state.full().screen).toEqual({ kind: 'unavailable' })
    state.write('\x07after')
    await state.prepare()
    expect(state.full()).toMatchObject({
      screen: { kind: 'checkpoint', cols: 22, rows: 6, offset: raw.end },
      replay: '',
    })
  } finally {
    state.dispose()
  }
})

it('keeps later live output after the queued checkpoint and avoids an expired checkpoint', async () => {
  const { HolderOutput, HOLDER_REPLAY_LIMIT } = await import('./holder-protocol.js')
  const { HolderScreenReplay } = await import('./holder-screen-replay.js')
  const { TerminalScreenState } = await import('./screen.js')
  const raw = new HolderOutput()
  const screen = new HolderScreenReplay(raw, new TerminalScreenState(30, 5), 30, 5)
  try {
    screen.write('first🙂')
    const prepared = screen.prepare()
    screen.write(' later')
    await prepared
    const full = screen.full()
    expect(full).toMatchObject({
      screen: { kind: 'checkpoint', offset: 'first🙂'.length },
      rawPrefix: 'first🙂',
      replay: ' later',
    })
    if (full.screen?.kind !== 'checkpoint') throw new Error('Expected a complete screen')
    expect(full.screen.ansi).not.toContain(' later')
    expect(full.screen.offset + full.replay.length).toBe(raw.end)
    screen.write('\x1b]0;' + 'x'.repeat(HOLDER_REPLAY_LIMIT))
    await screen.prepare()
    expect(screen.full().screen).toEqual({ kind: 'unavailable' })
    expect(screen.full().replay.length).toBe(HOLDER_REPLAY_LIMIT)
  } finally {
    screen.dispose()
  }
})

it.skipIf(process.platform === 'win32')(
  'restores both PTY buffers after output rolls over while the runtime is stopped',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-holder-screen-'))
    const db = openDatabase(join(directory, 'runtime.sqlite'))
    for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME'])
      vi.stubEnv(key, join(directory, key))
    // The test starts its own detached holder. No real user service manager is required.
    vi.stubEnv('DOVO_TERMINAL_HOLDER_SUPERVISOR', '')
    const start = () =>
      new Terminals(
        undefined,
        undefined,
        undefined,
        new TerminalRecovery(db, join(directory, 'recovery')),
      )
    let terminals = start()
    let id: string | undefined
    try {
      await writeFile(
        join(directory, 'panel.cjs'),
        String.raw`
const fs = require('node:fs')
process.stdin.setRawMode(true)
process.stdin.on('data', data => {
  if (data.toString() === 'q') process.stdout.write('\x1b[?1049l\r\nAFTER_RESTORE')
  else fs.writeFileSync('unexpected-input', data)
})
process.stdout.write('\r\nPRIMARY_MARKER\x1b[?1049h\x1b[2J\x1b[HHELD_PANEL')
const timer = setInterval(() => {
  if (!fs.existsSync('go')) return
  clearInterval(timer)
  process.stdout.write(('\x1b[3;1Hprogress').repeat(100000) + '\x1b[5;3HAFTER_GAP\x1b[6n', () => fs.writeFileSync('finished',''))
}, 10)
`,
      )
      id = terminals.createCommand(
        STUDIO_TERMINAL_SCOPE,
        directory,
        { command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], env: {} },
        'Panel',
        undefined,
        undefined,
        { rememberSession: true },
      ).id
      const sessionId = id
      terminals.input(id, 'exec "' + process.execPath + '" panel.cjs\r')
      await waitForRuntime(async () =>
        expect((await terminals.screen(sessionId)).text).toContain('HELD_PANEL'),
      )
      // `exec` makes the panel the held shell process, so its PID must survive the restart.
      await waitForRuntime(() => expect(terminals.get(sessionId).process?.pid).toBeGreaterThan(0))
      const pid = terminals.get(sessionId).process!.pid
      terminals.resize(id, 42, 9)
      await terminals.dispose()
      await writeFile(join(directory, 'go'), '')
      await waitForRuntime(() => expect(existsSync(join(directory, 'finished'))).toBe(true))
      terminals = start()
      await waitForRuntime(async () => {
        const panel = await terminals.screen(sessionId)
        expect(panel).toMatchObject({ cols: 42, rows: 9, buffer: 'alternate' })
        expect(panel.text).toContain('HELD_PANEL')
        expect(panel.text).toContain('  AFTER_GAP')
      })
      expect(terminals.get(id).process?.pid).toBe(pid)
      const raw = terminals.get(id).buffer
      expect(raw).toContain('AFTER_GAP')
      expect(raw).not.toContain('HELD_PANEL')
      expect(raw).not.toContain('PRIMARY_MARKER')
      terminals.input(id, 'q')
      await waitForRuntime(async () => {
        const main = await terminals.screen(sessionId)
        expect(main.buffer).toBe('normal')
        expect(main.text).toContain('PRIMARY_MARKER')
        expect(main.text).toContain('AFTER_RESTORE')
      })
      expect(existsSync(join(directory, 'unexpected-input'))).toBe(false)
    } finally {
      if (id) await terminals.close(id)
      await terminals.dispose()
      db.close()
      vi.unstubAllEnvs()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
