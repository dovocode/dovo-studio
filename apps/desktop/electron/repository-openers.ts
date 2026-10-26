import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ipcMain } from 'electron'
import { Schema } from 'effect'
import {
  clientRepositoryOpenSchema,
  decode,
  mutableStruct,
  parseSshAddress,
  sshRepositoryOpenTargets,
} from '@dovo/protocol'
import {
  detectInstalledOpeners,
  folderOpenCommand,
  launchDesktop,
  type InstalledOpener,
} from '@dovo/api/desktop-openers'
import { readConnection } from '@dovo/api/connection'
import { desktopRuntimeDirectory } from './runtime-data-directory.js'
import { requireTrustedRenderer } from './renderer-trust.js'

type OpenInput = typeof clientRepositoryOpenSchema.Type
const identitySchema = mutableStruct({ runtimeId: Schema.String })
/** Identity is read only from this desktop's own discovery file, never from a remote URL. */
export async function localOpenerRuntimeId(): Promise<string | null> {
  let connection: ReturnType<typeof readConnection>
  try {
    connection = readConnection(join(desktopRuntimeDirectory(), 'runtime-connection.json'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  let response: Response
  try {
    response = await fetch(`${connection.address}/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${connection.token}` },
    })
  } catch {
    // A paused local runtime must not prevent opening a different computer over SSH.
    // Without an identity match, a path is always treated as remote.
    return null
  }
  if (!response.ok) return null
  return decode(identitySchema, await response.json()).runtimeId
}
export async function clientOpenCommand(
  input: OpenInput,
  localRuntimeId: string | null,
  installed: InstalledOpener[],
) {
  if (/[\0\r\n]/.test(input.path)) throw new Error('Invalid checkout path')
  if (input.runtimeId === localRuntimeId)
    return folderOpenCommand(input.path, input.target, installed)
  if (!sshRepositoryOpenTargets.includes(input.target))
    throw new Error('This application cannot open remote folders over SSH.')
  if (!input.sshAddress)
    throw new Error(
      'Set the runtime’s SSH address in Devices & runtime before opening a remote checkout.',
    )
  const ssh = parseSshAddress(input.sshAddress)
  if (!input.path.startsWith('/')) throw new Error('Remote SSH paths must be absolute POSIX paths.')
  const opener = installed.find((item) => item.target === input.target)
  if (!opener)
    throw new Error(
      'This editor is not installed on your computer. Reopen the Open menu after installing it.',
    )
  if (opener.kind === 'wsl-windows')
    throw new Error(
      'Install this editor in the desktop client’s operating system to open an SSH checkout.',
    )
  const host = ssh.sshHost.includes(':') ? `[${ssh.sshHost}]` : ssh.sshHost
  const destination = `${ssh.sshUser}@${host}${ssh.sshPort === 22 ? '' : `:${ssh.sshPort}`}`
  const encodedPath = input.path.split('/').map(encodeURIComponent).join('/')
  const args =
    input.target === 'zed'
      ? [`ssh://${destination}${encodedPath}`]
      : [
          '--reuse-window',
          input.kind === 'file' ? '--file-uri' : '--folder-uri',
          `vscode-remote://ssh-remote+${destination}${encodedPath}`,
        ]
  if (opener.kind === 'app') {
    // Bundle discovery also works when the editor's CLI was never added to PATH.
    const names: Partial<Record<OpenInput['target'], string[]>> = {
      vscode: ['code'],
      'vscode-insiders': ['code-insiders'],
      vscodium: ['codium'],
      cursor: ['cursor'],
      windsurf: ['windsurf'],
      antigravity: ['antigravity'],
      devin: ['devin-desktop', 'devin', 'windsurf'],
    }
    const candidates =
      input.target === 'zed'
        ? [join(opener.executable, 'Contents/MacOS/cli')]
        : (names[input.target] ?? []).map((name) =>
            join(opener.executable, 'Contents/Resources/app/bin', name),
          )
    for (const executable of candidates) {
      try {
        await access(executable, constants.X_OK)
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          ['ENOENT', 'EACCES', 'ENOTDIR'].includes(String(error.code))
        )
          continue
        throw error
      }
      return { executable, args, detached: true }
    }
    // macOS ignores --args for an already-running bundle unless a new instance is requested.
    return {
      executable: '/usr/bin/open',
      args: ['-n', '-a', opener.executable, '--args', ...args],
      detached: false,
    }
  }
  return { executable: opener.executable, args: [...opener.prefix, ...args], detached: true }
}
export function registerRepositoryOpeners(rendererPath: string) {
  ipcMain.handle('repositories:local-openers', async (event) => {
    requireTrustedRenderer(event, rendererPath)
    const [installed, localRuntimeId] = await Promise.all([
      detectInstalledOpeners(),
      localOpenerRuntimeId(),
    ])
    return { targets: installed.map((item) => item.target), localRuntimeId }
  })
  ipcMain.handle('repositories:local-open', async (event, value: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    const input = decode(clientRepositoryOpenSchema, value)
    const [installed, identity] = await Promise.all([
      detectInstalledOpeners(),
      localOpenerRuntimeId(),
    ])
    const command = await clientOpenCommand(input, identity, installed)
    // Never set a local process's working directory to a remote path.
    await launchDesktop(command.executable, command.args, homedir())
  })
}
