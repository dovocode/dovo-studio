import { existsSync } from 'node:fs'
import { basename } from 'node:path'
export function defaultShell() {
  const inherited = process.env.SHELL
  if (inherited && ['zsh', 'bash'].includes(basename(inherited)) && existsSync(inherited))
    return inherited
  return process.platform === 'darwin' && existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'
}
