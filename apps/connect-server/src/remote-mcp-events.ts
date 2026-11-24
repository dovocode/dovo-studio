import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CallToolRequestSchema,
  JSONRPCRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import {
  decode,
  remoteMcpEventFilterSchema,
  remoteMcpEventPageSchema,
  remoteMcpEventPollSchema,
  remoteMcpEventsExtension,
  remoteMcpEventsVersion,
  remoteMcpNeedsInputSchema,
  remoteMcpTurnFinishedSchema,
  type RemoteMcpEventPoll,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { json, RequestError } from './http.js'

function jsonSchema(schema: Schema.Constraint) {
  const { schema: root, definitions } = Schema.toJsonSchemaDocument(Schema.toType(schema), {
    onExcessProperty: 'error',
  })
  return Object.keys(definitions).length ? { ...root, $defs: definitions } : root
}
const inputSchema = jsonSchema(remoteMcpEventFilterSchema)
const events = [
  {
    name: 'thread.turn_finished',
    description: 'A thread turn completed, failed, or was cancelled.',
    payloadSchema: jsonSchema(remoteMcpTurnFinishedSchema),
  },
  {
    name: 'thread.needs_input',
    description: 'A thread needs a person to answer a question or review an approval.',
    payloadSchema: jsonSchema(remoteMcpNeedsInputSchema),
  },
].map((event) => ({ ...event, inputSchema, delivery: ['poll'] }))

// The installed MCP SDK supports the initialization-based protocol. Handle the native
// discovery and polling requests here so both versions can use the same OAuth resource.
export async function nativeRemoteMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  handlers: {
    eventsEnabled: boolean
    tools: Tool[]
    callTool: (params: (typeof CallToolRequestSchema)['_output']['params']) => Promise<unknown>
    poll: (params: RemoteMcpEventPoll) => Promise<unknown>
  },
) {
  const parsed = JSONRPCRequestSchema.safeParse(body)
  const method = parsed.data?.method
  const version = req.headers['mcp-protocol-version']
  if (
    version !== remoteMcpEventsVersion &&
    method !== 'server/discover' &&
    !method?.startsWith('events/')
  )
    return false
  const id = parsed.data?.id ?? null
  const error = (code: number, message: string) => {
    json(res, 200, { jsonrpc: '2.0', id, error: { code, message } })
    return true
  }
  const result = (value: unknown) => {
    json(res, 200, { jsonrpc: '2.0', id, result: value })
    return true
  }
  if (!parsed.success) return error(-32600, 'Invalid MCP request.')
  if (version !== remoteMcpEventsVersion) return error(-32022, 'Unsupported MCP protocol version.')
  if (req.headers['mcp-method'] !== method)
    return error(-32020, 'Mcp-Method does not match the request.')
  const { _meta, ...params } = parsed.data.params ?? {}
  if (_meta?.['io.modelcontextprotocol/protocolVersion'] !== version)
    return error(-32020, 'MCP-Protocol-Version does not match the request.')
  switch (method) {
    case 'server/discover':
      return result({
        supportedVersions: [remoteMcpEventsVersion],
        serverInfo: { name: 'dovo-connect', version: '1.0.0' },
        capabilities: {
          tools: {},
          ...(handlers.eventsEnabled && { extensions: { [remoteMcpEventsExtension]: {} } }),
        },
      })
    case 'tools/list':
      return result({ tools: handlers.tools })
    case 'tools/call': {
      const call = CallToolRequestSchema.safeParse(body)
      if (!call.success) return error(-32602, 'Invalid Dovo Studio tool request.')
      if (req.headers['mcp-name'] !== call.data.params.name)
        return error(-32020, 'Mcp-Name does not match the request.')
      return result(await handlers.callTool(call.data.params))
    }
    case 'events/list':
      return handlers.eventsEnabled
        ? result({ resultType: 'complete', events })
        : error(-32601, 'This computer does not currently offer MCP events.')
    case 'events/poll': {
      let poll: RemoteMcpEventPoll
      try {
        poll = Schema.decodeUnknownSync(remoteMcpEventPollSchema, {
          onExcessProperty: 'error',
        })(params)
      } catch {
        return error(-32602, 'Invalid MCP event name, filter, or cursor.')
      }
      if (req.headers['mcp-name'] !== poll.name)
        return error(-32020, 'Mcp-Name does not match the request.')
      try {
        const page = decode(remoteMcpEventPageSchema, await handlers.poll(poll))
        if (page.events.some((event) => event.name !== poll.name))
          return error(-32000, 'This computer returned a different MCP event type.')
        return result(page)
      } catch (failure) {
        return error(
          -32000,
          failure instanceof RequestError
            ? failure.message
            : 'This computer could not list events.',
        )
      }
    }
    default:
      return error(-32601, 'MCP method not found.')
  }
}
