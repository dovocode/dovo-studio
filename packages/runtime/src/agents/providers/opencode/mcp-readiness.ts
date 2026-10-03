import { setTimeout } from 'node:timers/promises'

/** V2 registration returns before the asynchronous MCP handshake completes. */
export async function waitForMcpConnection(
  name: string,
  read: (signal: AbortSignal) => Promise<{ status: string; error?: string } | undefined>,
  signal: AbortSignal,
) {
  const deadline = AbortSignal.timeout(30_000)
  const connectionSignal = AbortSignal.any([signal, deadline])
  try {
    while (true) {
      connectionSignal.throwIfAborted()
      const status = await read(connectionSignal)
      if (status?.status === 'connected') return
      if (status?.status !== 'pending')
        throw new Error(
          `MCP server ${name} could not connect (${status?.status ?? 'unknown status'})${status?.error ? `: ${status.error}` : '.'}`,
        )
      await setTimeout(100, undefined, { signal: connectionSignal })
    }
  } catch (error) {
    signal.throwIfAborted()
    if (deadline.aborted)
      throw new Error(`MCP server ${name} did not become ready within 30 seconds.`, {
        cause: error,
      })
    throw error
  }
}
