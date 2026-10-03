import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** Apply the runtime's no-redirect policy to POST, GET/SSE and DELETE alike. */
export function mcpHttpOptions(
  headers: Record<string, string>,
): StreamableHTTPClientTransportOptions {
  return {
    redirectPolicy: 'same-origin',
    requestInit: { headers, redirect: 'error' },
    // SDK 1.32's GET/SSE path does not read requestInit.redirect.
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
  }
}
