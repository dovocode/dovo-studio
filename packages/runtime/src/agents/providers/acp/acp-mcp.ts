import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  MCP_PROTOCOL_VERSION,
  type McpOperationContext,
  type McpOutcome,
} from '@agentclientprotocol/sdk/unstable'
import { mcpHttpOptions } from '../../../mcp-apps/http-transport.js'

/** Forward native MCP 2026 operations. The MCP SDK owns JSON/SSE framing and HTTP cancellation. */
export async function acpMcpHttp(
  url: string,
  headers: Record<string, string>,
  context: Pick<McpOperationContext, 'signal' | 'requestId' | 'method' | 'params' | 'notify'>,
): Promise<McpOutcome> {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10 * 60_000)])
  signal.throwIfAborted()
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...mcpHttpOptions(headers),
    // A call is never retried: replaying a tool can repeat side effects.
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 0,
      maxReconnectionDelay: 0,
      reconnectionDelayGrowFactor: 1,
    },
  })
  transport.setProtocolVersion(MCP_PROTOCOL_VERSION)
  let abort = () => {}
  try {
    await transport.start()
    return await new Promise<McpOutcome>((resolve, reject) => {
      abort = () => {
        reject(signal.reason)
        void transport.close()
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) {
        abort()
        return
      }
      transport.onerror = reject
      transport.onmessage = (message) => {
        if ('id' in message && message.id === context.requestId) {
          if ('result' in message) resolve({ result: message.result })
          else if ('error' in message) resolve({ error: message.error })
        } else if ('method' in message && !('id' in message)) {
          void context.notify(message.method, message.params).catch(reject)
        } else if ('method' in message && 'id' in message) {
          void transport
            .send({
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32601,
                message: 'Server-initiated requests are not supported by this binding',
              },
            })
            .catch(reject)
        }
      }
      void transport
        .send({
          jsonrpc: '2.0',
          id: context.requestId,
          method: context.method,
          params: context.params,
        })
        .catch(reject)
    })
  } finally {
    signal.removeEventListener('abort', abort)
    await transport.close()
  }
}
