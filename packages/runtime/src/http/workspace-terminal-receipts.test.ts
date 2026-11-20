import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, responses } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { waitForRuntime } from '../testing/integration'

// Each held launch waits for the holder. A stopped holder takes two 10 s request timeouts.
vi.setConfig({ testTimeout: 90_000 })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'workspace-terminal-receipt-owner-token-at-least-32'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  // Agent integrations write into these folders. Keep them out of the host profile.
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME'])
    vi.stubEnv(key, join(f.directory, key))
  vi.stubEnv('DOVO_TERMINAL_HOLDER_SUPERVISOR', '')
  cleanups.push(async () => {
    vi.unstubAllEnvs()
  })
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'runtime.sqlite'),
    ownerToken,
    port: 0,
  })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({ ...f.workspace, tasks: [] }))
  const token = 'paired-computer-receipt-token-at-least-32-chars'
  runtime.services.devices.add('Paired computer', token)
  const post = (input: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/terminals/workspace`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const holderDirectory = join(f.directory, 'terminal-recovery', 'holder')
  const marker = join(f.directory, 'marker')
  const lines = async () =>
    (await readFile(marker, 'utf8').catch(() => '')).split('\n').filter(Boolean)
  return { ...f, runtime, post, holderDirectory, marker, lines }
}

it.skipIf(process.platform === 'win32')(
  'rejects a launch the holder never created, so the same request can run once later',
  async () => {
    const { runtime, post, holderDirectory, marker, lines } = await setup()
    // An unusable holder folder fails before any create reaches a holder.
    await mkdir(join(holderDirectory, '..'), { recursive: true })
    await writeFile(holderDirectory, 'not a folder')
    const input = {
      requestId: 'never-created',
      rememberSession: true,
      command: `echo ran >> '${marker}'`,
    }
    const rejected = await post(input)
    expect(rejected.status).toBe(409)
    expect(await rejected.text()).toContain('Nothing ran')
    expect(runtime.services.terminals.list()).toEqual([])
    await rm(holderDirectory)
    const accepted = await post(input)
    expect(accepted.status).toBe(200)
    const terminal = decode(responses.terminal, await accepted.json())
    await waitForRuntime(async () => expect(await lines()).toEqual(['ran']))
    // The receipt now returns the same terminal. Nothing runs again.
    const again = await post(input)
    expect(decode(responses.terminal, await again.json()).id).toBe(terminal.id)
    expect(runtime.services.terminals.list()).toHaveLength(1)
    expect(await lines()).toEqual(['ran'])
  },
)

it.skipIf(process.platform === 'win32')(
  'reports an unconfirmed launch as uncertain and never starts it twice',
  async () => {
    const { runtime, post, holderDirectory, marker, lines } = await setup()
    const first = await post({ requestId: 'starts-holder', rememberSession: true })
    expect(first.status).toBe(200)
    const holder = (
      JSON.parse(await readFile(join(holderDirectory, 'holder.json'), 'utf8')) as { pid: number }
    ).pid
    const input = {
      requestId: 'unconfirmed',
      rememberSession: true,
      command: `echo ran >> '${marker}'`,
    }
    process.kill(holder, 'SIGSTOP')
    try {
      // The create reaches the stopped holder's socket, but no reply comes back.
      const uncertain = await post(input)
      expect(uncertain.status).toBe(503)
      expect(runtime.services.terminals.list()).toHaveLength(2)
      // A retry of the same request is refused instead of launching a second program.
      const retry = await post(input)
      expect(retry.status).toBe(409)
      expect(await retry.text()).toContain('may have partially applied')
    } finally {
      process.kill(holder, 'SIGCONT')
    }
    // The holder handles the create it received. The runtime attaches to that same program.
    await waitForRuntime(async () => expect(await lines()).toEqual(['ran']))
    await waitForRuntime(() =>
      expect(runtime.services.terminals.list().every((terminal) => !terminal.dormant)).toBe(true),
    )
    expect((await post(input)).status).toBe(409)
    expect(runtime.services.terminals.list()).toHaveLength(2)
    expect(await lines()).toEqual(['ran'])
  },
)
