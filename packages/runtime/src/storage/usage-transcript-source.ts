import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import { exec, processEnvironment } from '../process.js'

/** WSL's mapped drive path and native Windows must identify the same directory on the same host. */
export function transcriptSourceIdentity(
  platform = process.platform,
  wsl = platform === 'linux' && !!(process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME),
  probe = async (command: string, args: string[]) =>
    (await exec(command, args, { env: processEnvironment(), timeout: 1500, maxBuffer: 8192 }))
      .stdout,
) {
  let machine: Promise<string | undefined> | undefined
  return async (provider: string, root: string) => {
    if (!wsl && platform !== 'win32') return
    try {
      const path = wsl ? (await probe('wslpath', ['-w', root])).trim() : root
      if (!/^[a-z]:[\\/]/i.test(path) || /[\r\n]/.test(path)) return
      machine ??= probe('reg.exe', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
        '/reg:64',
      ])
        .then((value) =>
          /^\s*MachineGuid\s+REG_SZ\s+([\da-f-]{36})\s*$/im.exec(value)?.[1].toLowerCase(),
        )
        .catch(() => undefined)
      const guid = await machine
      if (!guid) return
      const directory = path[0].toUpperCase() + win32.normalize(path).slice(1).replace(/\\$/, '')
      return createHash('sha256')
        .update(JSON.stringify([guid, provider, directory]))
        .digest('hex')
    } catch {
      return undefined
    }
  }
}
