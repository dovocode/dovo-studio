import { z } from 'zod'
import { MCP_PROTOCOL_VERSION } from '@agentclientprotocol/sdk/unstable'
import { McpEventsClient } from '../../mcp-events/client.js'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import { open, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import { parseDocument } from 'yaml'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { DiagnosticStdioTransport } from '../../mcp-apps/stdio-transport.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { managedSkillSchema, mcpServerSchema, mcpTestResultSchema } from '@dovo/protocol'
import { processEnvironment } from '../../process.js'
import { mcpHttpOptions } from '../../mcp-apps/http-transport.js'
import { mcpServerEnvironment, mcpHeaders } from './mcp-settings.js'
import type { McpOAuth } from '../../mcp-oauth/oauth.js'
export async function importSkill(input: unknown) {
  const { path } = decode(
    mutableStruct({
      path: maxValue(minValue(Schema.String, 1), 4000),
    }),
    input,
  )
  const sourcePath = await realpath(
    resolve(path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path),
  )
  if (basename(sourcePath) !== 'SKILL.md') throw new Error('Choose a SKILL.md file')
  const file = await open(sourcePath, 'r')
  let text: string
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 64000)
      throw new Error('Skill must be a file smaller than 64 KB')
    const buffer = Buffer.alloc(64001)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 64000) throw new Error('Skill exceeds 64 KB')
    text = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
  } finally {
    await file.close()
  }
  return { ...parseSkillDocument(text), sourcePath }
}

/** Catalog IDs come from frontmatter, and need not match the containing directory. */
export function parseSkillDocument(text: string) {
  text = text.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new Error('SKILL.md needs YAML frontmatter with name and description')
  const document = parseDocument(match[1], {
    uniqueKeys: true,
  })
  if (document.errors.length) throw new Error('Invalid skill frontmatter')
  const metadata = decode(
    mutableStruct({
      name: Schema.String,
      description: Schema.String,
    }),
    document.toJS({
      maxAliasCount: 20,
    }),
  )
  return decode(managedSkillSchema, {
    ...metadata,
    enabled: true,
    content: text.slice(match[0].length),
  })
}
export async function testMcpServer(input: unknown, oauth?: McpOAuth) {
  const server = decode(mcpServerSchema, input)
  if (server.acpTransport) return testNativeMcpServer(server)
  const client = new Client({
    name: 'dovo-studio',
    version: '0.1.0',
  })
  const transport =
    server.transport === 'stdio'
      ? new DiagnosticStdioTransport({
          command: server.command,
          args: server.args,
          env: {
            ...Object.fromEntries(
              Object.entries(processEnvironment()).flatMap(([key, value]) =>
                value === undefined ? [] : [[key, value]],
              ),
            ),
            ...mcpServerEnvironment(server),
          },
        })
      : new StreamableHTTPClientTransport(new URL(server.url), {
          ...mcpHttpOptions(mcpHeaders(server)),
          authProvider: oauth?.provider(server),
        })
  const signal = AbortSignal.timeout(15000)
  try {
    await client.connect(transport, {
      signal,
      timeout: 15000,
    })
    const tools: string[] = []
    if (client.getServerCapabilities()?.tools) {
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor === undefined ? {} : { cursor }, {
          signal,
          timeout: 15000,
        })
        tools.push(...page.tools.map((tool) => tool.name))
        cursor = page.nextCursor
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new Error('MCP tools/list repeated a pagination cursor')
          cursors.add(cursor)
        }
      } while (cursor !== undefined)
    }
    return decode(mcpTestResultSchema, {
      server: client.getServerVersion()?.name ?? server.name,
      tools,
    })
  } catch (error) {
    throw transport instanceof DiagnosticStdioTransport ? await transport.explain(error) : error
  } finally {
    await client.close()
    await transport.close()
  }
}

async function testNativeMcpServer(server: typeof mcpServerSchema.Type) {
  const signal = AbortSignal.timeout(15000)
  const client = new McpEventsClient(server)
  const discovery = await client.discover(signal)
  if (!discovery.supportedVersions.includes(MCP_PROTOCOL_VERSION))
    throw new Error('This server does not support MCP 2026-07-28; use regular HTTP instead')
  const info = z
    .object({ name: z.string() })
    .safeParse(discovery._meta?.['io.modelcontextprotocol/serverInfo'])
  const tools: string[] = []
  if (discovery.capabilities.tools !== undefined) {
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const page = z
        .object({
          tools: z.array(z.object({ name: z.string() })),
          nextCursor: z.string().optional(),
        })
        .parse(
          await client.request('tools/list', cursor === undefined ? undefined : { cursor }, signal),
        )
      tools.push(...page.tools.map((tool) => tool.name))
      cursor = page.nextCursor
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new Error('MCP tools/list repeated a pagination cursor')
        cursors.add(cursor)
      }
    } while (cursor !== undefined)
  }
  const events = (await client.list(signal, discovery))?.map(({ name, delivery }) => ({
    name,
    delivery,
  }))
  return decode(mcpTestResultSchema, {
    server: info.success ? info.data.name : server.name,
    tools,
    ...(events === undefined ? {} : { events }),
  })
}
