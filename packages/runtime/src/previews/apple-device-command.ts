import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { quote } from 'shell-quote'
import { HttpError } from '../errors.js'

const exec = promisify(execFile)
type Options = { windowsHide?: boolean; signal?: AbortSignal; timeout: number; maxBuffer: number }

/** Signing and CoreDevice need the Mac user's login environment. Some SSH/daemon sessions
 * additionally lack the GUI audit session required by Apple's developer services. */
export async function appleDeviceCommand(file: string, args: string[], options: Options) {
  if (process.platform !== 'darwin') return exec(file, args, options)
  try {
    return await exec('/bin/zsh', ['-l', '-c', 'exec "$@"', 'dovo-device', file, ...args], options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (!/CoreDeviceError[^\n]*4016|requested usage assertion requirements/i.test(message))
      throw error
    return guiDeviceCommand(file, args, options)
  }
}

async function guiDeviceCommand(file: string, args: string[], options: Options) {
  const consoleUser = await exec('/usr/bin/stat', ['-f', '%u', '/dev/console'], options)
  if (consoleUser.stdout.trim() !== String(process.getuid?.()))
    throw new HttpError(
      409,
      'Sign in to the Mac desktop as the user running Device Hub, then retry the device action.',
    )
  const directory = await mkdtemp(join(tmpdir(), 'dovo-apple-device-'))
  const output = join(directory, 'stdout'),
    errors = join(directory, 'stderr'),
    exit = join(directory, 'exit'),
    pid = join(directory, 'pid')
  let completed = false
  try {
    const script = join(directory, 'command.zsh')
    await writeFile(
      script,
      `#!/bin/zsh -l\numask 077\n${quote([file, ...args])} > ${quote([output])} 2> ${quote([errors])} &\ndevice_child=$!\nprint -r -- "$device_child" > ${quote([pid])}\nif wait "$device_child"; then device_status=0; else device_status=$?; fi\nprint -r -- "$device_status" > ${quote([exit + '.tmp'])}\n/bin/mv ${quote([exit + '.tmp', exit])}\n`,
      { mode: 0o700 },
    )
    options.signal?.throwIfAborted()
    await exec(
      '/usr/bin/osascript',
      [
        '-e',
        'on run argv\n tell application "Terminal" to do script (item 1 of argv)\nend run',
        '--',
        quote(['/bin/zsh', '-l', script]),
      ],
      options,
    )
    const deadline = Date.now() + options.timeout
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted()
      let code: string
      try {
        code = await readFile(exit, 'utf8')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        await delay(100, undefined, { signal: options.signal })
        continue
      }
      completed = true
      const [out, err] = await Promise.all([stat(output), stat(errors)])
      if (out.size + err.size > options.maxBuffer)
        throw new Error('Apple device command output exceeded its limit')
      const stdout = await readFile(output, 'utf8'),
        stderr = await readFile(errors, 'utf8')
      if (code.trim() !== '0')
        throw new HttpError(
          409,
          `Apple device command failed in the logged-in session: ${stderr || stdout}`,
        )
      return { stdout, stderr }
    }
    throw new HttpError(
      504,
      'Apple device command timed out in the logged-in session. Check that the iPhone is unlocked, connected and trusts this Mac.',
    )
  } finally {
    await cleanupCommand(directory, pid, completed)
  }
}

async function cleanupCommand(directory: string, pid: string, completed: boolean) {
  try {
    if (!completed) {
      const child = Number((await readFile(pid, 'utf8')).trim())
      if (Number.isSafeInteger(child) && child > 1) process.kill(child, 'SIGTERM')
    }
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        ['ENOENT', 'ESRCH'].includes(String(error.code))
      )
    )
      throw error
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
