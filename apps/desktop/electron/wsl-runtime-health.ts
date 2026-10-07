import type { ChildProcess } from 'node:child_process'
import { checkRuntimeConnection } from './runtime-connection-health.js'
const refused = (error: unknown) =>
  error instanceof Error &&
  error.cause !== null &&
  typeof error.cause === 'object' &&
  'code' in error.cause &&
  error.cause.code === 'ECONNREFUSED'

/** Linux readiness precedes Windows localhost forwarding. Wait only for that startup transition. */
export async function waitForWslRuntime(
  connection: { address: string; token: string },
  child: Pick<ChildProcess, 'exitCode' | 'signalCode'>,
) {
  const deadline = performance.now() + 10_000
  let lastFailure: unknown
  while (true) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('WSL runtime exited before its Windows connection became ready.', {
        cause: lastFailure,
      })
    const remaining = Math.ceil(deadline - performance.now())
    if (remaining <= 0)
      throw new Error(
        'WSL started, but Windows could not reach its localhost listener. Check WSL localhost forwarding, then retry.',
        { cause: lastFailure },
      )
    try {
      await checkRuntimeConnection(connection, AbortSignal.timeout(remaining))
      return
    } catch (cause) {
      if (!refused(cause))
        throw new Error(
          `Could not verify the WSL runtime connection: ${cause instanceof Error ? cause.message : 'Unexpected connection failure'}`,
          { cause },
        )
      lastFailure = cause
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(0, deadline - performance.now()))),
      )
    }
  }
}
