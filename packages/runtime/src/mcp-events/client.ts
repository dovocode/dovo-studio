import { randomUUID } from 'node:crypto'
import { MCP_PROTOCOL_VERSION, withMcpRequestMeta } from '@agentclientprotocol/sdk/unstable'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { Ajv, type ValidateFunction } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { McpServer } from '@dovo/protocol'
import { z } from 'zod'
import { mcpHeaders } from '../agents/configuration/mcp-settings.js'
import { acpMcpHttp } from '../agents/providers/acp/acp-mcp.js'
import { HttpError } from '../errors.js'
import type { McpEventsStdio } from './stdio.js'

export const eventsExtension = 'io.modelcontextprotocol/events'
const jsonObject = z.record(z.string(), z.json())
const jsonSchema = z.union([z.boolean(), jsonObject])
const cursor = z
  .string()
  .max(8192)
  .nullish()
  .transform((value) => value ?? null)
const occurrence = z.object({
  eventId: z.string().min(1).max(1024),
  name: z.string().min(1).max(512),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.json(),
})
const descriptor = z.object({
  name: occurrence.shape.name,
  description: z.string().optional(),
  delivery: z.array(z.enum(['poll', 'push', 'webhook'])).min(1),
  inputSchema: jsonSchema,
  payloadSchema: jsonSchema,
})
const list = z.object({
  resultType: z.literal('complete'),
  events: z.array(descriptor),
  nextCursor: z.string().optional(),
})
const discoverySchema = z.object({
  supportedVersions: z.array(z.string()),
  capabilities: z.object({
    tools: z.unknown().optional(),
    extensions: z.object({ [eventsExtension]: z.object({}).optional() }).optional(),
  }),
  _meta: z.record(z.string(), z.unknown()).optional(),
})
const poll = z.object({
  resultType: z.literal('complete'),
  events: z.array(occurrence).max(8),
  cursor,
  truncated: z.boolean().default(false),
  hasMore: z.boolean().default(false),
  nextPollMs: z.number().int().nonnegative().default(30000),
})
const position = z.object({ cursor, truncated: z.boolean().default(false) })
const streamEvent = occurrence.extend({ cursor })
export type McpEventType = z.infer<typeof descriptor>
export type McpOccurrence = z.infer<typeof occurrence>
export type McpEventBatch = {
  events: McpOccurrence[]
  cursor: string | null
  truncated: boolean
  hasMore: boolean
  nextPollMs: number
}
export class McpEventStreamTerminated extends Error {}

type HeaderParameter = { name: string; path: string[] }
const property = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined

function headerParameters(schema: z.infer<typeof jsonSchema>) {
  const parameters: HeaderParameter[] = []
  const names = new Set<string>()
  function visit(node: unknown, path: string[], reachable: boolean) {
    if (!node || typeof node !== 'object') return
    const header = property(node, 'x-mcp-header')
    if (header !== undefined) {
      const type = property(node, 'type')
      if (
        !path.length ||
        !reachable ||
        typeof header !== 'string' ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) ||
        names.has(header.toLowerCase()) ||
        (type !== 'string' && type !== 'integer' && type !== 'boolean')
      )
        throw new Error('Invalid x-mcp-header annotation')
      names.add(header.toLowerCase())
      parameters.push({ name: header, path })
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties' && child && typeof child === 'object') {
        for (const [name, definition] of Object.entries(child))
          visit(definition, [...path, name], reachable)
      } else if (
        [
          'items',
          'prefixItems',
          'contains',
          'additionalProperties',
          'patternProperties',
          'propertyNames',
          'dependentSchemas',
          'unevaluatedProperties',
          'unevaluatedItems',
          'oneOf',
          'anyOf',
          'allOf',
          'not',
          'if',
          'then',
          'else',
          '$defs',
          'definitions',
        ].includes(key)
      )
        visit(child, path, false)
      else if (!reachable && key !== 'x-mcp-header') visit(child, path, false)
    }
  }
  visit(schema, [], true)
  return parameters
}

function headerValue(value: string) {
  return /^[ -~]*$/.test(value.replaceAll('\t', ' ')) &&
    value.trim() === value &&
    !(value.startsWith('=?base64?') && value.endsWith('?='))
    ? value
    : `=?base64?${Buffer.from(value).toString('base64')}?=`
}

const draft7 = new Ajv({ addUsedSchema: false, strict: false })
const draft2020 = new Ajv2020({ addUsedSchema: false, strict: false })
addFormats(draft7)
addFormats(draft2020)
const validators = new Map<string, ValidateFunction>()

function validate(schema: z.infer<typeof jsonSchema>, value: unknown, message: string) {
  const key = JSON.stringify(schema)
  let check = validators.get(key)
  if (!check) {
    if (typeof schema === 'object' && schema.$async === true)
      throw new HttpError(400, 'Asynchronous MCP event schemas are unsupported')
    const ajv =
      typeof schema === 'object' &&
      typeof schema.$schema === 'string' &&
      /\/draft-07\/schema#?$/.test(schema.$schema)
        ? draft7
        : draft2020
    check = ajv.compile(schema)
    validators.set(key, check)
    const oldest = validators.keys().next().value
    if (oldest !== undefined && validators.size > 32) validators.delete(oldest)
    ajv.removeSchema(schema)
  }
  if (!check(value)) throw new HttpError(400, message)
}

export class McpEventsClient {
  constructor(
    private server: McpServer,
    private stdio?: McpEventsStdio,
  ) {}

  async request(
    method: string,
    params: Record<string, unknown> | undefined,
    signal: AbortSignal,
    extra?: {
      event: McpEventType
      notify?: (method: string, params: unknown, requestId: string) => void
    },
  ) {
    const requestId = randomUUID()
    const context = {
      requestId,
      method,
      params: withMcpRequestMeta(params, {
        clientInfo: { name: 'dovo-studio', version: '1.0.0' },
        clientCapabilities: { extensions: { [eventsExtension]: {} } },
      }),
      signal,
      notify: async (method: string, params: unknown) => extra?.notify?.(method, params, requestId),
    }
    const outcome = this.stdio
      ? await this.stdio.request({
          ...context,
          notify: (method, value) => extra?.notify?.(method, value, requestId),
        })
      : await this.httpRequest(context, params?.arguments, extra?.event)
    if ('error' in outcome)
      throw McpError.fromError(outcome.error.code, outcome.error.message, outcome.error.data)
    return outcome.result
  }

  private async httpRequest(
    context: Parameters<typeof acpMcpHttp>[2],
    arguments_: unknown,
    event?: McpEventType,
  ) {
    const headers = new Headers(mcpHeaders(this.server))
    for (const name of [...headers.keys()])
      if (name === 'mcp-name' || name.startsWith('mcp-param-')) headers.delete(name)
    headers.set('Mcp-Method', context.method)
    headers.set('MCP-Protocol-Version', MCP_PROTOCOL_VERSION)
    if (event) {
      headers.set('Mcp-Name', headerValue(event.name))
      for (const parameter of headerParameters(event.inputSchema)) {
        const value = parameter.path.reduce(property, arguments_)
        if (value === undefined) continue
        if (
          typeof value !== 'string' &&
          typeof value !== 'boolean' &&
          !(typeof value === 'number' && Number.isSafeInteger(value))
        )
          throw new HttpError(
            400,
            'MCP header arguments must be strings, booleans or safe integers',
          )
        headers.set(`Mcp-Param-${parameter.name}`, headerValue(String(value)))
      }
    }
    return acpMcpHttp(this.server.url, Object.fromEntries(headers), context)
  }

  async discover(signal: AbortSignal) {
    return discoverySchema.parse(await this.request('server/discover', undefined, signal))
  }

  async list(signal: AbortSignal, known?: z.infer<typeof discoverySchema>) {
    let discovery
    try {
      discovery = known ?? (await this.discover(signal))
    } catch (error) {
      // An older stdio server may require initialize and has no Events extension.
      if (this.stdio && error instanceof McpError && [-32601, -32000, -32002].includes(error.code))
        return undefined
      throw error
    }
    if (!discovery.supportedVersions.includes(MCP_PROTOCOL_VERSION))
      throw new HttpError(
        409,
        'This server does not support the native MCP version required for Events',
      )
    if (!discovery.capabilities.extensions?.[eventsExtension]) return undefined
    const events: McpEventType[] = []
    const seen = new Set<string>()
    let next: string | undefined
    do {
      const page = list.parse(
        await this.request(
          'events/list',
          next === undefined ? undefined : { cursor: next },
          signal,
        ),
      )
      for (const event of page.events) {
        try {
          if (!this.stdio) headerParameters(event.inputSchema)
          events.push(event)
        } catch {
          console.warn('MCP Events skipped an event with invalid header annotations')
        }
      }
      next = page.nextCursor
      if (next !== undefined) {
        if (seen.has(next)) throw new Error('MCP events/list repeated a pagination cursor')
        if (seen.size >= 100) throw new Error('MCP Events catalog exceeds 100 pages')
        seen.add(next)
      }
    } while (next !== undefined)
    return events
  }

  validateArguments(event: McpEventType, arguments_: Record<string, unknown>) {
    validate(
      event.inputSchema,
      arguments_,
      'Subscription arguments do not match the MCP event schema',
    )
  }

  private validateEvent(event: McpEventType, occurrence: McpOccurrence) {
    if (occurrence.name !== event.name)
      throw new Error('MCP returned an event for a different subscription')
    validate(
      event.payloadSchema,
      occurrence.data,
      'MCP event payload does not match its advertised schema',
    )
  }

  async poll(
    event: McpEventType,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<McpEventBatch> {
    const response = poll.parse(
      await this.request('events/poll', { ...params, maxEvents: 8 }, signal, { event }),
    )
    for (const occurrence of response.events) this.validateEvent(event, occurrence)
    return response
  }

  async stream(
    event: McpEventType,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onBatch: (batch: McpEventBatch) => boolean,
  ) {
    const stop = new AbortController()
    let active = false
    let heartbeat: ReturnType<typeof setTimeout> | undefined
    let heartbeatMs = 5000
    const resetHeartbeat = () => {
      clearTimeout(heartbeat)
      heartbeat = setTimeout(
        () => stop.abort(new Error('MCP event stream heartbeat timed out')),
        heartbeatMs * 3,
      )
    }
    resetHeartbeat()
    try {
      const result = await this.request(
        'events/stream',
        { ...params, heartbeatMs },
        AbortSignal.any([signal, stop.signal]),
        {
          event,
          notify: (method, value, id) => {
            try {
              stop.signal.throwIfAborted()
              signal.throwIfAborted()
              if (!method.startsWith('notifications/events/')) return
              const meta = property(value, '_meta')
              if (property(meta, 'io.modelcontextprotocol/subscriptionId') !== id)
                throw new Error('MCP event stream returned an unexpected subscription ID')
              if (method === 'notifications/events/active') {
                const grant = z
                  .object({
                    heartbeatMs: z
                      .number()
                      .int()
                      .positive()
                      .max(2 ** 29),
                  })
                  .parse(value)
                heartbeatMs = grant.heartbeatMs
                active = true
              }
              if (method === 'notifications/events/terminated') {
                const { error } = z
                  .object({
                    error: z.object({
                      code: z.number().int(),
                      message: z.string(),
                      data: z.unknown().optional(),
                    }),
                  })
                  .parse(value)
                throw new McpEventStreamTerminated(error.message)
              }
              if (!active) throw new Error('MCP event stream sent a notification before activation')
              resetHeartbeat()
              if (
                !['active', 'event', 'heartbeat'].includes(
                  method.slice('notifications/events/'.length),
                )
              )
                return
              const { cursor, truncated } = position.parse(value)
              const events: McpOccurrence[] = []
              if (method === 'notifications/events/event') {
                const occurrence = streamEvent.parse(value)
                this.validateEvent(event, occurrence)
                events.push(occurrence)
              }
              if (!onBatch({ events, cursor, truncated, hasMore: false, nextPollMs: 0 }))
                stop.abort()
            } catch (error) {
              stop.abort(error)
              throw error
            }
          },
        },
      )
      z.object({ resultType: z.literal('complete') }).parse(result)
    } catch (error) {
      if (!stop.signal.aborted || stop.signal.reason?.name !== 'AbortError') throw error
    } finally {
      clearTimeout(heartbeat)
    }
  }
}
