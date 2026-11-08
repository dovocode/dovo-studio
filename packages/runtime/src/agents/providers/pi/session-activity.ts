import { readFile, readdir, stat } from 'node:fs/promises'
import { basename } from 'node:path'

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')

/** Pi closes its transcript after each write, so an open-file check is insufficient.
 * Conservatively refuse to attach while any other same-user Node process could host Pi.
 * Platforms without an exhaustive process inspection remain unknown.
 */
export async function piSessionActivity(): Promise<'active' | 'inactive' | 'unknown'> {
  if (process.platform !== 'linux' || !process.getuid) return 'unknown'
  try {
    const processes = (await readdir('/proc')).filter((pid) => /^\d+$/.test(pid))
    if (processes.length > 4096) return 'unknown'
    let uncertain = false
    for (const pid of processes) {
      if (Number(pid) === process.pid) continue
      try {
        if ((await stat(`/proc/${pid}`)).uid !== process.getuid()) continue
        const command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean)
        if (!command.length) continue
        const executable = basename(command[0] ?? '').toLowerCase()
        if (
          command.some(
            (part) =>
              /(?:^|[/\\])pi(?:\.js|\.mjs|\.cjs)?$/i.test(part) ||
              /(?:^|[/\\])pi-coding-agent(?:[/\\]|$)/i.test(part),
          )
        )
          return 'active'
        // Pi's SDK can be loaded into an otherwise unidentifiable Node or Bun process.
        if (/^(node|nodejs|bun|deno)(?:\.exe)?$/.test(executable)) uncertain = true
      } catch (error) {
        if (!missing(error)) uncertain = true
      }
    }
    return uncertain ? 'unknown' : 'inactive'
  } catch {
    return 'unknown'
  }
}
