import { open, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { parseDocument } from 'yaml'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { managedSkillSchema, mcpServerSchema, mcpTestResultSchema } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
import { mcpServerEnvironment, mcpHeaders } from './mcp-settings.js'
export async function importSkill(input: unknown) {
  const { path } = z.object({ path: z.string().min(1).max(4000) }).parse(input)
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
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new Error('SKILL.md needs YAML frontmatter with name and description')
  const document = parseDocument(match[1], { uniqueKeys: true })
  if (document.errors.length) throw new Error('Invalid skill frontmatter')
  const metadata = z
    .object({ name: z.string(), description: z.string() })
    .parse(document.toJS({ maxAliasCount: 20 }))
  return managedSkillSchema.parse({
    ...metadata,
    enabled: true,
    content: text.slice(match[0].length),
    sourcePath,
  })
}
export async function testMcpServer(input: unknown) {
  const server = mcpServerSchema.parse(input)
  const client = new Client({ name: 'dovo-studio', version: '0.1.0' })
  const transport =
    server.transport === 'stdio'
      ? new StdioClientTransport({
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
          stderr: 'ignore',
        })
      : new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: mcpHeaders(server) },
        })
  const signal = AbortSignal.timeout(15000)
  try {
    await client.connect(transport, { signal, timeout: 15000 })
    const tools = client.getServerCapabilities()?.tools
      ? (await client.listTools({}, { signal, timeout: 15000 })).tools.map((tool) => tool.name)
      : []
    return mcpTestResultSchema.parse({
      server: client.getServerVersion()?.name ?? server.name,
      tools,
    })
  } finally {
    await client.close()
    await transport.close()
  }
}
