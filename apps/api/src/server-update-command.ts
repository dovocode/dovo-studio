import { spawn } from 'node:child_process'

/** Stream updater diagnostics to its log rather than aborting on execFile's output limit. */
export function runServerUpdateCommand(command: string, args: string[], timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'pipe'],
      timeout,
      killSignal: 'SIGKILL',
    })
    let tail = Buffer.alloc(0)
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      tail = Buffer.from(Buffer.concat([tail, chunk]).subarray(-16384))
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `${command} failed (${signal ?? `exit ${code}`}): ${tail.toString('utf8').trim() || 'Check server-update.log for details.'}`,
          ),
        )
    })
  })
}
