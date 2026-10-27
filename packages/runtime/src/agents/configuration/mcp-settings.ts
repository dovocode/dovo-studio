import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { McpServer } from '@dovo/protocol'
import { processEnvironment } from '../../process.js'
function mcpEnvironment(mapping: Record<string, string>) {
  const environment = processEnvironment()
  return Object.fromEntries(
    Object.entries(mapping).map(([key, variable]) => {
      const value = environment[variable]
      if (value === undefined)
        throw new Error(`Runtime environment variable ${variable} is not set`)
      return [key, value]
    }),
  )
}
export function mcpServerEnvironment(server: McpServer) {
  return { ...server.envValues, ...mcpEnvironment(server.env) }
}
export function mcpHeaders(server: McpServer) {
  // HTTP header names are case-insensitive. Resolve precedence before a transport
  // can combine differently cased credentials into one invalid value.
  const headers = new Map<string, [string, string]>()
  for (const [name, value] of [
    ...Object.entries(server.headerValues ?? {}),
    ...Object.entries(mcpEnvironment(server.headerEnv)),
  ]) {
    headers.set(name.toLowerCase(), [name, value])
  }
  if (server.bearerTokenEnv)
    headers.set('authorization', [
      'Authorization',
      `Bearer ${mcpEnvironment({ token: server.bearerTokenEnv }).token}`,
    ])
  return Object.fromEntries(headers.values())
}
export function codexMcpServers(servers: McpServer[]) {
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      {
        enabled: server.enabled,
        // Dovo enforces thread ownership and child access itself. Conversation,
        // progress and child controls also work when the parent is read-only.
        ...(server.name === 'dovo_task' && server.envValues?.DOVO_TASK_ID
          ? {
              tools: Object.fromEntries(
                [
                  'ask_question',
                  'todos',
                  ...['spawn', 'list', 'answer', 'send', 'read', 'wait', 'cancel'].map(
                    (action) => `subagent_${action}`,
                  ),
                ].map((name) => [name, { approval_mode: 'approve' }]),
              ),
            }
          : {}),
        ...(server.transport === 'stdio'
          ? {
              command: server.command,
              args: server.args,
              ...(server.enabled ? { env: mcpServerEnvironment(server) } : {}),
            }
          : { url: server.url, ...(server.enabled ? { http_headers: mcpHeaders(server) } : {}) }),
      },
    ]),
  )
}
export function claudeMcpServers(servers: McpServer[]) {
  return Object.fromEntries(
    servers
      .filter((server) => server.enabled)
      .map((server) => [
        server.name,
        server.transport === 'stdio'
          ? {
              type: 'stdio' as const,
              command: server.command,
              args: server.args,
              env: mcpServerEnvironment(server),
            }
          : { type: 'http' as const, url: server.url, headers: mcpHeaders(server) },
      ]),
  )
}
export function acpMcpServers(servers: McpServer[]) {
  return servers
    .filter((server) => server.enabled)
    .map((server) =>
      server.transport === 'stdio'
        ? {
            name: server.name,
            command: server.command,
            args: server.args,
            env: Object.entries(mcpServerEnvironment(server)).map(([name, value]) => ({
              name,
              value,
            })),
          }
        : {
            name: server.name,
            type: 'http' as const,
            url: server.url,
            headers: Object.entries(mcpHeaders(server)).map(([name, value]) => ({ name, value })),
          },
    )
}

/** Claude CLI --mcp-config accepts JSON file paths. The SDK otherwise serializes
 * mcpServers (including env and headers) directly into process arguments. */
export function claudeMcpConfigFile(servers: McpServer[]) {
  const config = claudeMcpServers(servers)
  if (!Object.keys(config).length) return { path: undefined, dispose: () => {} }
  const directory = mkdtempSync(join(tmpdir(), 'dovo-claude-mcp-'))
  const path = join(directory, 'mcp.json')
  try {
    writeFileSync(path, JSON.stringify({ mcpServers: config }), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return { path, dispose: () => rmSync(directory, { recursive: true, force: true }) }
}
