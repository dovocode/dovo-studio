import { readdir, readFile, readlink, stat } from 'node:fs/promises'
import { exec, ProcessError } from '../../../process.js'

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')

/** An idle native CLI still owns its open rollout. Never attach while that handle exists. */
export async function codexSessionActivity(
  path: string,
): Promise<'inactive' | 'active' | 'unknown'> {
  if (process.platform === 'linux') {
    try {
      const processes = (await readdir('/proc')).filter((name) => /^\d+$/.test(name))
      if (processes.length > 4096) return 'unknown'
      let descriptors = 0
      let uncertain = false
      for (const pid of processes) {
        try {
          if ((await stat(`/proc/${pid}`)).uid !== process.getuid?.()) continue
          const directory = `/proc/${pid}/fd`
          const files = await readdir(directory)
          descriptors += files.length
          if (descriptors > 40000) return 'unknown'
          const handles = await Promise.all(
            files.map(async (file) => {
              try {
                return await readlink(`${directory}/${file}`)
              } catch (error) {
                if (!missing(error)) throw error
                return undefined // Process/descriptor closed during enumeration.
              }
            }),
          )
          if (handles.some((handle) => handle === path || handle === `${path} (deleted)`))
            return 'active'
        } catch (error) {
          if (missing(error)) continue
          const state = await readFile(`/proc/${pid}/stat`, 'utf8').catch((cause: unknown) => {
            if (missing(cause)) return undefined
            throw cause
          })
          if (
            !state ||
            ['Z', 'X', 'x'].includes(
              state.slice(state.lastIndexOf(')') + 2, state.lastIndexOf(')') + 3),
            )
          )
            continue
          // Login/session managers can be non-dumpable even for their owner.
          // They launch provider children but do not hold provider rollout files.
          const name = await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')
          if (!['systemd', '(sd-pam)', 'sshd', 'sshd-session'].includes(name.trim()))
            uncertain = true
        }
      }
      return uncertain ? 'unknown' : 'inactive'
    } catch {
      return 'unknown'
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await exec('lsof', ['-t', '--', path], { timeout: 5000, maxBuffer: 64000 })
      return stdout.trim() ? 'active' : 'unknown'
    } catch (error) {
      if (error instanceof ProcessError && error.code === 1 && !String(error.stderr).trim())
        return 'inactive'
      return 'unknown'
    }
  }
  // No safe native handle probe is available here. Preview remains available.
  return 'unknown'
}
