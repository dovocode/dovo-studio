import type { Schema } from 'effect'
import type { RuntimeConnection } from '../runtime/connection/runtime.js'
import { runtimeTransportAddress } from '../runtime/connection/routes.js'
import {
  runtimeRequest,
  runtimeRequestEffect,
  runtimeResponseAddress,
  type RuntimeRequestOptions,
} from './client.js'
import { runtimeUrl } from './runtime-url.js'

type RequestOptions = RuntimeRequestOptions & {
  method?: string
  timeoutMs?: number
  signal?: AbortSignal
}
type RouteOptions = Pick<RequestOptions, 'route'>

/** Bind credentials and route selection once. The saved connection stays logical: native
 * WebRTC listeners and verified LAN/VPN failover are resolved by each operation. */
export function createRuntimeClient(connection: RuntimeConnection) {
  const url = (path: string, options?: RouteOptions) =>
    runtimeUrl(runtimeTransportAddress(connection, options?.route), path)
  return {
    request<T extends Schema.Codec<unknown, unknown>>(
      path: string,
      input: unknown,
      schema: T,
      options?: RequestOptions,
    ) {
      return runtimeRequest(
        connection,
        connection.address,
        path,
        input,
        schema,
        options?.method,
        options?.timeoutMs,
        options?.signal,
        options,
      )
    },
    requestEffect<T extends Schema.Codec<unknown, unknown>>(
      path: string,
      input: unknown,
      schema: T,
      options?: Omit<RequestOptions, 'signal'>,
    ) {
      return runtimeRequestEffect(
        connection,
        connection.address,
        path,
        input,
        schema,
        options?.method,
        options?.timeoutMs,
        options,
      )
    },
    /** Resolve a runtime-issued file URL after its request has selected a route. */
    url: (path: string, options?: RouteOptions) => url(path, options).href,
    /** Pass the ticket response to retain its issuing transport across route changes.
     * String tickets retain compatibility with older integrations. Credentials never enter URLs. */
    socketUrl(path: string, ticket: string | { readonly ticket: string }, options?: RouteOptions) {
      const issuedAt = typeof ticket === 'string' ? undefined : runtimeResponseAddress(ticket)
      const target = issuedAt ? runtimeUrl(issuedAt, path) : url(path, options)
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
      target.searchParams.set('ticket', typeof ticket === 'string' ? ticket : ticket.ticket)
      return target.href
    },
  }
}
export type RuntimeClient = ReturnType<typeof createRuntimeClient>
export type RuntimeClientRequestOptions = RequestOptions
