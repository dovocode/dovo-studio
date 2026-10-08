import { spawn } from 'node:child_process'
import { codeEditorOpenTargets, type RepositoryOpenTarget } from '@dovo/protocol'
import { exec, processEnvironment } from '../../process.js'
import { HttpError } from '../../errors.js'
import { detectInstalledOpeners, type InstalledOpener } from './installed-openers.js'

export function runtimeFolderOpener() {
  if (process.platform === 'win32' || (process.platform === 'linux' && process.env.WSL_DISTRO_NAME))
    return 'explorer' as const
  if (process.platform === 'darwin') return 'finder' as const
  if (process.platform === 'linux') return 'file-manager' as const
  return undefined
}
export async function folderOpenCommand(
  cwd: string,
  target: RepositoryOpenTarget,
  installed?: InstalledOpener[],
) {
  const list = installed ?? (await detectInstalledOpeners())
  const actual =
    target === 'finder' || target === 'explorer' || target === 'file-manager'
      ? runtimeFolderOpener()
      : target
  const opener = list.find((opener) => opener.target === actual)
  if (!opener)
    throw new HttpError(
      400,
      'This application was not found on the runtime computer. Install it there, then reopen the Open menu.',
    )
  if (opener.kind === 'app')
    return { executable: '/usr/bin/open', args: ['-a', opener.executable, cwd], detached: false }
  let path = cwd
  const codeEditor = codeEditorOpenTargets.some(([target]) => opener.target === target)
  if (
    (process.platform === 'linux' && process.env.WSL_DISTRO_NAME && opener.target === 'explorer') ||
    opener.kind === 'wsl-windows'
  ) {
    if (opener.kind === 'wsl-windows' && codeEditor)
      return {
        executable: opener.executable,
        args: ['--reuse-window', '--remote', `wsl+${process.env.WSL_DISTRO_NAME}`, cwd],
        detached: true,
      }
    path = (
      await exec('wslpath', ['-w', cwd], {
        timeout: 5000,
        env: processEnvironment(),
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim()
    if (!path)
      throw new HttpError(400, 'Could not convert the checkout path for the Windows application')
  }
  const flags = opener.prefix[0] !== 'launch' && codeEditor ? ['--reuse-window'] : []
  return {
    executable: opener.executable,
    args: [...opener.prefix, ...flags, path],
    detached: process.platform !== 'darwin',
  }
}
/** GUI apps outlive the request/runtime without holding its pipes or parsing paths in a shell. */
export function launchDesktop(executable: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: processEnvironment(),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
