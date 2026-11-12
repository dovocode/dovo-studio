import { spawn } from 'node:child_process'
import type { SecureInputRequest } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
import { stopOwnedChild } from '../agents/execution/stop-owned-child.js'

/** No PTY, shell interpolation, command history, captured output or secret in argv/env. */
export async function runSecureCommand(
  destination: Extract<SecureInputRequest['destination'], { kind: 'command' }>,
  directory: string,
  value: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const child = spawn(destination.command, destination.args, {
    cwd: directory,
    env: processEnvironment(),
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  let stopping: Promise<void> | undefined
  const stop = () => {
    stopping ??= stopOwnedChild(child)
    // Observe immediately. The finally block awaits and reports cleanup failure.
    void stopping.catch(() => {
      inputFailed = true
    })
  }
  const input = Buffer.from(value + (destination.appendNewline ? '\n' : ''), 'utf8')
  let inputFailed = false
  // Errors can include command arguments or platform diagnostics. Never forward them.
  child.stdin.on('error', () => {
    inputFailed = true
  })
  const closed = new Promise<boolean>((resolve) => {
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0 && !inputFailed))
  })
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  child.stdin.end(input, () => input.fill(0))
  try {
    const success = await closed
    if (!success || signal.aborted) throw new Error('Secure command did not complete.')
  } finally {
    input.fill(0)
    signal.removeEventListener('abort', stop)
    // Reap descendants even if a launcher exits successfully.
    await (stopping ?? stopOwnedChild(child)).catch(() => {
      throw new Error('Secure command cleanup was not confirmed.')
    })
  }
}
