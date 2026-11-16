import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'

const real = (path: string) => realpath(path).catch(() => resolve(path))

/**
 * Whether running `command` on the host could start a file that a sandboxed agent can change.
 * A path counts when the file, or the folder it is in, is writable. A bare name counts when a
 * writable PATH folder comes before or holds its first match, because the agent can place a
 * file of that name there. Relative PATH folders are skipped, as the shell would resolve them
 * against an unknown folder.
 */
export async function hostCommandWritable(
  command: string,
  path: string | undefined,
  writable: (realPath: string) => boolean,
) {
  if (command.includes('/')) {
    const file = resolve(command)
    return writable(await real(file)) || writable(await real(dirname(file)))
  }
  for (const folder of (path ?? '').split(delimiter)) {
    if (!folder || !isAbsolute(folder)) continue
    if (writable(await real(folder))) return true
    const candidate = join(folder, command)
    const found = await access(candidate, constants.X_OK).then(
      () => true,
      () => false,
    )
    if (found) return writable(await real(candidate))
  }
  return false
}
