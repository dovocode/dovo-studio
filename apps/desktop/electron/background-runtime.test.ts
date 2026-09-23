import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { backgroundRuntimeDefinition, ensureBackgroundRuntime } from './background-runtime'

let home = ''
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true })
})
async function fixture() {
  home = await mkdtemp(join(tmpdir(), 'dovo-launch-agent-'))
  return {
    home,
    uid: 501,
    directory: join(home, 'Dovo & Studio'),
    node: '/Applications/Dovo Studio.app/Contents/Resources/runtime/bin/node',
    entrypoint: '/Applications/Dovo Studio.app/Contents/Resources/runtime/dist/index.js',
    host: '127.0.0.1',
    port: '8787',
    path: '/usr/bin:/bin',
  }
}
it('installs a private, persistent service for a fresh Mac profile', async () => {
  const options = await fixture()
  const command = vi.fn<(args: string[]) => Promise<void>>(async (args: string[]) => {
    if (args[0] === 'print') throw new Error('No service')
  })
  await Effect.runPromise(ensureBackgroundRuntime(options, command))
  const { label } = backgroundRuntimeDefinition(options)
  const path = join(home, 'Library', 'LaunchAgents', `${label}.plist`)
  expect(command.mock.calls).toEqual([
    [['print', `gui/501/${label}`]],
    [['bootstrap', 'gui/501', path]],
  ])
  const plist = await readFile(path, 'utf8')
  expect(plist).toContain('Dovo &amp; Studio')
  expect(plist).toContain('<key>KeepAlive</key><true/>')
  expect(plist).not.toContain('DOVO_OWNER_TOKEN')
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(
    backgroundRuntimeDefinition({ ...options, directory: options.directory + '2' }).label,
  ).not.toBe(label)
})
it('leaves a loaded background service running', async () => {
  const options = await fixture()
  const command = vi.fn<(args: string[]) => Promise<void>>(async () => {})
  await Effect.runPromise(ensureBackgroundRuntime(options, command))
  expect(command).toHaveBeenCalledTimes(1)
})
it('surfaces bootstrap failures instead of falling back to a desktop-owned process', async () => {
  const options = await fixture()
  const command = vi.fn<(args: string[]) => Promise<void>>(async () => {
    throw new Error('launchd unavailable')
  })
  await expect(Effect.runPromise(ensureBackgroundRuntime(options, command))).rejects.toThrow(
    'Could not start the Mac background runtime',
  )
})

it('stores provider credentials outside the plist and restores them on the next launch', async () => {
  const options = await fixture()
  const command = vi.fn<(args: string[]) => Promise<void>>(async () => {})
  await Effect.runPromise(
    ensureBackgroundRuntime(
      {
        ...options,
        environment: { ANTHROPIC_API_KEY: 'fixture-key', UNRELATED_SECRET: 'not-copied' },
      },
      command,
    ),
  )
  const { label } = backgroundRuntimeDefinition(options)
  const plist = await readFile(join(home, 'Library', 'LaunchAgents', `${label}.plist`), 'utf8')
  expect(plist).not.toContain('fixture-key')
  expect(plist).toContain('DOVO_RUNTIME_ENV_FILE')
  await Effect.runPromise(ensureBackgroundRuntime(options, command))
  const path = join(options.directory, 'runtime-environment.json')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ANTHROPIC_API_KEY: 'fixture-key' })
  expect((await stat(path)).mode & 0o777).toBe(0o600)
})

it('unloads only the expected app-owned process before an update', async () => {
  const { stopBackgroundRuntimeForUpdate } = await import('./background-runtime')
  const options = await fixture()
  const command = vi.fn<(args: string[]) => Promise<string>>(async (args) =>
    args[0] === 'print' ? '\npid = 2147483647\n' : '',
  )
  await Effect.runPromise(
    stopBackgroundRuntimeForUpdate(options.directory, 501, 2147483647, command),
  )
  expect(command.mock.calls.at(-1)?.[0]).toEqual([
    'bootout',
    `gui/501/${backgroundRuntimeDefinition(options).label}`,
  ])
  command.mockClear()
  await expect(
    Effect.runPromise(stopBackgroundRuntimeForUpdate(options.directory, 501, 123, command)),
  ).rejects.toThrow('ownership changed')
  expect(command).toHaveBeenCalledTimes(1)
})

it('restores Node startup certificate settings before the service process launches', async () => {
  const options = await fixture()
  const command = vi.fn<(args: string[]) => Promise<void>>(async () => {})
  await Effect.runPromise(
    ensureBackgroundRuntime(
      {
        ...options,
        environment: {
          NODE_EXTRA_CA_CERTS: '/private/company & root.pem',
          SSL_CERT_FILE: '/private/ssl.pem',
        },
      },
      command,
    ),
  )
  await Effect.runPromise(ensureBackgroundRuntime(options, command))
  const { label } = backgroundRuntimeDefinition(options)
  const plist = await readFile(join(home, 'Library', 'LaunchAgents', `${label}.plist`), 'utf8')
  expect(plist).toContain('<key>NODE_EXTRA_CA_CERTS</key>')
  expect(plist).toContain('/private/company &amp; root.pem')
  expect(plist).toContain('<key>SSL_CERT_FILE</key>')
})
