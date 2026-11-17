import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AsyncLocalStorage } from 'node:async_hooks'

const requestSignal = new AsyncLocalStorage<AbortSignal>()
/** Bind the response body to this call, without closing a shared session or GET stream. */
export function mcpHttpCall<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return requestSignal.run(signal, operation)
}

/** Apply the runtime's no-redirect policy to POST, GET/SSE and DELETE alike. */
export function mcpHttpOptions(
  headers: Record<string, string>,
): StreamableHTTPClientTransportOptions {
  return {
    redirectPolicy: 'same-origin',
    requestInit: { headers, redirect: 'error' },
    // SDK 1.32's GET/SSE path does not read requestInit.redirect.
    fetch: (input, init) => {
      const signal = init?.method?.toUpperCase() === 'POST' ? requestSignal.getStore() : undefined
      return fetch(input, {
        ...init,
        redirect: 'error',
        ...(signal
          ? { signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }
          : {}),
      })
    },
  }
}
