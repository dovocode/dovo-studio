import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandsSchema, decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { defaultShell, resolveTerminalShell, shellArguments, terminalShells } from './shell'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
const settings = () => decode(commandsSchema, {})
async function shellDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-shell-catalog-'))
  directories.push(directory)
  vi.stubEnv('PATH', directory)
  vi.stubEnv('Path', directory)
  return directory
}
it('uses PowerShell without POSIX login flags for automatic Windows terminals', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('SystemRoot', 'C:/Windows')
  expect(defaultShell()).toMatch(/WindowsPowerShell.*powershell.exe$/)
  expect(shellArguments({ shell: '', shellArgs: ['-l'] })).toEqual(['-NoLogo', '-NoProfile'])
  expect(shellArguments({ shell: 'bash.exe', shellArgs: ['-l'] })).toEqual(['-l'])
})

it('preserves the configured default executable and arguments', async () => {
  const directory = await shellDirectory()
  const shell = join(directory, 'shell')
  await writeFile(shell, '', { mode: 0o755 })
  const configured = { ...settings(), shell, shellArgs: ['--interactive'] }
  expect((await terminalShells(configured))[0]).toEqual({
    id: 'default',
    label: 'Default (shell)',
    path: shell,
    args: ['--interactive'],
  })
  expect(await resolveTerminalShell(configured)).toEqual({
    id: 'default',
    command: shell,
    args: ['--interactive'],
    env: {},
  })
  await rm(shell)
  await expect(resolveTerminalShell(configured)).rejects.toThrow('not available')
})

it.skipIf(process.platform === 'win32')(
  'discovers installed shells without executing them and excludes nonexecutables',
  async () => {
    const directory = await shellDirectory()
    const fish = join(directory, 'fish')
    const nu = join(directory, 'nu')
    // Invalid executable content deliberately proves catalog discovery does not run binaries.
    await writeFile(fish, 'not an executable program', { mode: 0o755 })
    await writeFile(nu, 'not executable', { mode: 0o644 })
    expect((await terminalShells(settings())).find((shell) => shell.id === 'fish')).toEqual({
      id: 'fish',
      label: 'Fish',
      path: fish,
      args: ['-l'],
    })
    expect((await terminalShells(settings())).some((shell) => shell.id === 'nu')).toBe(false)
    await chmod(nu, 0o755)
    expect(
      await resolveTerminalShell({ ...settings(), shellArgs: ['custom-default-flag'] }, 'nu'),
    ).toEqual({
      id: 'nu',
      command: nu,
      args: ['--login'],
      env: {},
    })
    await rm(nu)
    await expect(resolveTerminalShell(settings(), 'nu')).rejects.toThrow('not available')
  },
)

it('rejects executable paths and unknown shell IDs from client input', async () => {
  await expect(resolveTerminalShell(settings(), '/bin/anything')).rejects.toThrow('not available')
  await expect(resolveTerminalShell(settings(), 'missing-shell')).rejects.toThrow('not available')
})

it('discovers Windows PowerShell without requiring POSIX executable permissions', async () => {
  const directory = await shellDirectory()
  const pwsh = join(directory, 'pwsh.exe')
  await writeFile(pwsh, '', { mode: 0o644 })
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  expect(await resolveTerminalShell(settings(), 'pwsh')).toEqual({
    id: 'pwsh',
    command: pwsh,
    args: ['-NoLogo'],
    env: {},
  })
})
