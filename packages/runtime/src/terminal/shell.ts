import { constants, existsSync } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import type { CommandSettings, TerminalShell } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { processEnvironment } from '../process.js'
export function defaultShell() {
  if (process.platform === 'win32')
    return join(
      process.env.SystemRoot || 'C:/Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
  const inherited = process.env.SHELL
  if (inherited && ['zsh', 'bash'].includes(basename(inherited)) && existsSync(inherited))
    return inherited
  return process.platform === 'darwin' && existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'
}

export function shellArguments(settings: { shell: string; shellArgs: string[] }) {
  return process.platform === 'win32' && !settings.shell
    ? ['-NoLogo', '-NoProfile']
    : settings.shellArgs
}

/** Resolve on the owning computer without starting a shell or changing its configured default. */
async function installedShell(names: string[], searchPath: string) {
  for (const name of names) {
    const candidates = isAbsolute(name)
      ? [name]
      : searchPath
          .split(delimiter)
          .filter(Boolean)
          .map((directory) => join(directory, name))
    for (const candidate of candidates) {
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        if ((await stat(candidate)).isFile()) return candidate
      } catch (cause: unknown) {
        if (
          cause instanceof Error &&
          'code' in cause &&
          ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(cause.code))
        )
          continue
        throw cause
      }
    }
  }
  return undefined
}

export async function terminalShells(settings: CommandSettings): Promise<TerminalShell[]> {
  const configured = settings.shell || defaultShell()
  const defaults: TerminalShell = {
    id: 'default',
    label: `Default (${basename(configured)})`,
    path: configured,
    args: shellArguments(settings),
  }
  const choices =
    process.platform === 'win32'
      ? [
          {
            id: 'pwsh',
            label: 'PowerShell 7',
            names: [
              'pwsh.exe',
              join(process.env.ProgramFiles || 'C:/Program Files', 'PowerShell', '7', 'pwsh.exe'),
            ],
            args: ['-NoLogo'],
          },
          {
            id: 'powershell',
            label: 'Windows PowerShell',
            names: [defaultShell()],
            args: ['-NoLogo'],
          },
          {
            id: 'cmd',
            label: 'Command Prompt',
            names: [join(process.env.SystemRoot || 'C:/Windows', 'System32', 'cmd.exe')],
            args: [],
          },
          {
            id: 'bash',
            label: 'Git Bash',
            names: [join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe')],
            args: ['-l'],
          },
        ]
      : [
          { id: 'bash', label: 'Bash', names: ['bash', '/bin/bash'], args: ['-l'] },
          { id: 'zsh', label: 'Zsh', names: ['zsh', '/bin/zsh'], args: ['-l'] },
          {
            id: 'fish',
            label: 'Fish',
            names: ['fish', '/usr/bin/fish', '/opt/homebrew/bin/fish'],
            args: ['-l'],
          },
          { id: 'sh', label: 'POSIX shell', names: ['sh', '/bin/sh'], args: ['-l'] },
          { id: 'nu', label: 'Nushell', names: ['nu'], args: ['--login'] },
        ]
  const environment = processEnvironment()
  const installed = await Promise.all(
    choices.map(async ({ names, ...shell }) => {
      const path = await installedShell(names, environment.PATH ?? environment.Path ?? '')
      return path ? { ...shell, path } : undefined
    }),
  )
  return [defaults, ...installed.filter((shell) => shell !== undefined)]
}

export async function resolveTerminalShell(settings: CommandSettings, id = 'default') {
  const shell = (await terminalShells(settings)).find((shell) => shell.id === id)
  if (!shell) throw new HttpError(400, 'This shell is not available on the selected computer.')
  const environment = processEnvironment()
  if (!(await installedShell([shell.path], environment.PATH ?? environment.Path ?? '')))
    throw new HttpError(400, 'This shell is not available on the selected computer.')
  return { id: shell.id, command: shell.path, args: shell.args, env: {} }
}
