import { z } from 'zod'
import type { JSONSchema } from 'zod/v4/core'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import {
  ToolSchema,
  CallToolResultSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { runToolCode } from './code-runtime.js'

type CodeTool = Omit<Tool, 'inputSchema'> & {
  inputSchema: JSONSchema.JSONSchema & { type: 'object' }
}
export const codeToolDefinition: CodeTool = {
  name: 'code',
  description:
    'Run isolated async JavaScript to compose tools. Discover schemas with await tools.search({source:"dovo"|"harness"|"mcp",server?,query?}). Call tools.dovo.NAME(args), tools.harness.NAME(args), tools.mcp[SERVER][NAME](args). Harness tools are Studio file/search/terminal equivalents. No host globals, imports or network. Use data(result) for text/structured data; print(value) or return a value to show output. Return or print a full tool result to keep images/audio. Calls retain access, approval and cancellation rules. Never retry side effects blindly.',
  inputSchema: {
    type: 'object',
    properties: { code: { type: 'string', minLength: 1, maxLength: 100000 } },
    required: ['code'],
    additionalProperties: false,
  },
}
const callSchema = z
  .object({
    source: z.enum(['dovo', 'harness', 'mcp', 'catalog']),
    name: z.string().min(1).max(200),
    server: z.string().min(1).max(200).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
const searchSchema = z
  .object({
    source: z.enum(['dovo', 'harness', 'mcp']).optional(),
    server: z.string().min(1).max(200).optional(),
    query: z.string().max(256).optional(),
  })
  .strict()
const catalogSchema = z.object({
  tools: z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()),
})
const serverSchema = z.object({ servers: z.array(z.string()) })

export async function executeCodeTool(options: {
  code: string
  signal: AbortSignal
  tools: CodeTool[]
  dovo: (
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<CallToolResult>
  remote: (
    command: {
      source: 'harness' | 'mcp'
      name: string
      server?: string
      arguments?: Record<string, unknown>
    },
    signal: AbortSignal,
  ) => Promise<unknown>
}): Promise<CallToolResult> {
  const tools = options.tools.filter((tool) => tool.name !== 'code')
  const validator = new AjvJsonSchemaValidator()
  const checked = (result: unknown) => {
    const parsed = CallToolResultSchema.safeParse(result)
    if (parsed.success && parsed.data.isError)
      throw new Error(
        parsed.data.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n') || 'Tool failed',
      )
    return result
  }
  const execution = await runToolCode({
    code: options.code,
    signal: options.signal,
    call: async (raw, signal) => {
      const call = callSchema.parse(raw)
      if (call.source === 'catalog') {
        if (call.name !== 'search') throw new Error('Unknown catalog operation')
        const args = searchSchema.parse(call.arguments ?? {})
        if (args.server && args.source !== 'mcp')
          throw new Error('Select source:"mcp" when choosing a server')
        const found: unknown[] = []
        if (!args.source || args.source === 'dovo')
          found.push(...tools.map((tool) => ({ ...tool, source: 'dovo', origin: 'studio' })))
        if (!args.source || args.source === 'harness') {
          const files = catalogSchema.parse(
            await options.remote({ source: 'harness', name: '__catalog' }, signal),
          )
          found.push(
            ...files.tools,
            ...tools
              .filter((tool) => tool.name.startsWith('terminal_'))
              .map((tool) => ({ ...tool, source: 'harness', origin: 'studio-equivalent' })),
          )
        }
        if (args.source === 'mcp' && args.server) {
          found.push(
            ...catalogSchema.parse(
              await options.remote(
                { source: 'mcp', name: '__catalog', server: args.server },
                signal,
              ),
            ).tools,
          )
        }
        const query = args.query?.toLowerCase()
        return {
          tools: found.filter((tool) => {
            const item = z
              .object({ name: z.string(), description: z.string().optional() })
              .parse(tool)
            return !query || `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query)
          }),
          ...(!args.source || (args.source === 'mcp' && !args.server)
            ? serverSchema.parse(await options.remote({ source: 'mcp', name: '__servers' }, signal))
            : {}),
        }
      }
      if (call.name.startsWith('__')) throw new Error('Use tools.search for discovery')
      if (
        call.source === 'dovo' ||
        (call.source === 'harness' && call.name.startsWith('terminal_'))
      ) {
        const tool = tools.find((tool) => tool.name === call.name)
        if (!tool) throw new Error('Tool is disabled or unavailable in this run')
        if (!validator.getValidator(ToolSchema.parse(tool).inputSchema)(call.arguments ?? {}).valid)
          throw new Error(`Arguments do not match the ${tool.name} input schema`)
        return checked(await options.dovo(tool.name, call.arguments ?? {}, signal))
      }
      return checked(
        await options.remote(
          { source: call.source, name: call.name, server: call.server, arguments: call.arguments },
          signal,
        ),
      )
    },
  })
  const content: CallToolResult['content'] = []
  const selected = (value: unknown) => {
    const parsed = CallToolResultSchema.safeParse(value)
    if (!parsed.success) return value
    content.push(...parsed.data.content)
    // Keep binary payloads in MCP blocks instead of duplicating them as base64 text.
    return {
      ...parsed.data,
      content: parsed.data.content.map((item) =>
        item.type === 'text' ? item : { type: item.type },
      ),
    }
  }
  const summary = {
    ...execution,
    result: selected(execution.result),
    output: execution.output.map((values) =>
      Array.isArray(values) ? values.map(selected) : selected(values),
    ),
  }
  return { content: [{ type: 'text', text: JSON.stringify(summary) }, ...content] }
}
