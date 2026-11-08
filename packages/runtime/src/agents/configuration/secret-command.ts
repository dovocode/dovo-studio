import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { processEnvironment } from '../../process.js'
import { OwnedProcessShutdownError, stopOwnedChild } from '../execution/stop-owned-child.js'

/** Secret CLIs own a process group. Abort must drain it before the last reader returns. */
export async function readSecretCommand(command: string, args: string[], signal: AbortSignal) {
  signal.throwIfAborted()
  const child = spawn(command, args, {
    cwd: homedir(),
    env: processEnvironment(),
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '',
    bytes = 0
  let failure: Error | undefined, cleanup: Promise<void> | undefined
  let pipeDeadline: ReturnType<typeof setTimeout> | undefined
  let confirmPipes!: () => void
  const pipesClosed = new Promise<void>((resolve) => {
    confirmPipes = resolve
  })
  child.once('close', confirmPipes)
  let rejectShutdown!: (error: unknown) => void
  const shutdownFailed = new Promise<never>((_, reject) => {
    rejectShutdown = reject
  })
  const drain = () => {
    cleanup ??= stopOwnedChild(child)
    void cleanup.catch(rejectShutdown)
    return cleanup
  }
  const stop = (error: Error) => {
    failure ??= error
    void drain()
  }
  const aborted = () => stop(new Error('Secret provider cancelled'))
  child.once('exit', () => {
    // The launcher may leave descendants holding its pipes, even after a successful read.
    void drain().then(() => {
      if (child.stdout.readableEnded && child.stderr.readableEnded) return
      pipeDeadline = setTimeout(
        () =>
          rejectShutdown(
            new OwnedProcessShutdownError('Secret provider output did not drain', {
              confirmed: pipesClosed,
            }),
          ),
        1_000,
      )
    }, rejectShutdown)
  })
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0 || failure) resolve()
      else reject(new Error('Secret provider command failed'))
    })
    const output = (chunk: string, error: boolean) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 128 * 1024) {
        stop(new Error('Secret provider output limit exceeded'))
        return
      }
      if (!error) stdout += chunk
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => output(chunk, false))
    // Drain stderr, but never retain credentials, login responses or diagnostic output.
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => output(chunk, true))
  })
  signal.addEventListener('abort', aborted, { once: true })
  if (signal.aborted) aborted()
  try {
    await Promise.race([closed, shutdownFailed])
    await drain()
    if (failure) throw failure
    return stdout
  } finally {
    signal.removeEventListener('abort', aborted)
    clearTimeout(pipeDeadline)
    await drain()
  }
}
