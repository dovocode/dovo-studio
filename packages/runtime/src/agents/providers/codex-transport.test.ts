import { expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import { JsonLineReader, JsonLineWriter } from './codex-transport'
it('cancels a pending input request when Codex clears it server-side', async () => {
  const input = new PassThrough(),
    output = new PassThrough()
  const rpc = createMessageConnection(new JsonLineReader(input), new JsonLineWriter(output))
  let waiting = false,
    cancelled = false
  rpc.onRequest('item/tool/requestUserInput', async (_params, token) => {
    waiting = true
    await new Promise<void>((resolve) => token.onCancellationRequested(() => resolve()))
    cancelled = true
    return { answers: {} }
  })
  rpc.listen()
  try {
    input.write(
      JSON.stringify({ id: 'request', method: 'item/tool/requestUserInput', params: {} }) + '\n',
    )
    await vi.waitFor(() => expect(waiting).toBe(true))
    input.write(
      JSON.stringify({
        method: 'serverRequest/resolved',
        params: { threadId: 'thread', requestId: 'request' },
      }) + '\n',
    )
    await vi.waitFor(() => expect(cancelled).toBe(true))
  } finally {
    rpc.dispose()
    input.destroy()
    output.destroy()
  }
})
