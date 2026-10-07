import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { claudeAuthenticated, claudeCommand } from './claude-command.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function installation(loggedIn = true) {
  const home = await mkdtemp(join(tmpdir(), 'dovo-claude wsl-'))
  directories.push(home)
  const bin = join(home, '.local', 'bin')
  await mkdir(bin, { recursive: true })
  const command = join(bin, 'claude')
  await writeFile(
    command,
    `#!/bin/sh
case "$*" in
  --version) printf '2.1.292\\n';;
  'auth status --json') printf '{"loggedIn":${loggedIn}}\\n';;
  *) exit 1;;
esac
`,
    { mode: 0o755 },
  )
  return { home, bin, command }
}

it.skipIf(process.platform === 'win32')(
  'finds and authenticates a native Linux install outside the WSL service PATH',
  async () => {
    const { home, command } = await installation()
    const env = { HOME: home, PATH: join(home, 'missing') }
    expect(await claudeCommand('', env)).toBe(command)
    expect(await claudeAuthenticated({ provider: 'claude', endpoint: '', model: '', env })).toBe(
      true,
    )
    const signedOut = await installation(false)
    expect(
      await claudeAuthenticated({
        provider: 'claude',
        endpoint: '',
        model: '',
        env: { HOME: signedOut.home, PATH: '' },
      }),
    ).toBe(false)
  },
)

it.skipIf(process.platform === 'win32')(
  'respects the configured PATH and never substitutes a broken explicit executable',
  async () => {
    const local = await installation(),
      preferred = await installation(false)
    const env = { HOME: local.home, PATH: preferred.bin }
    expect(await claudeCommand('', env)).toBe('claude')
    expect(await claudeAuthenticated({ provider: 'claude', endpoint: '', model: '', env })).toBe(
      false,
    )
    expect(await claudeCommand(local.command, env)).toBe(local.command)
    await expect(claudeCommand(join(local.home, 'missing-claude'), env)).rejects.toThrow(
      'For WSL, install and sign in inside the selected Linux distribution',
    )
    expect(
      await claudeAuthenticated({
        provider: 'claude',
        endpoint: join(local.home, 'missing-claude'),
        model: '',
        env,
      }),
    ).toBe(false)
  },
)
