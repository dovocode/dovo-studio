import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
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
