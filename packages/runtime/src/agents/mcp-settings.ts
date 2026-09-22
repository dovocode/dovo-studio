import type { McpServer } from '@dovo/protocol'
import { processEnvironment } from '../process.js'
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
  const headers = { ...server.headerValues, ...mcpEnvironment(server.headerEnv) }
  if (server.bearerTokenEnv)
    headers.Authorization = `Bearer ${mcpEnvironment({ token: server.bearerTokenEnv }).token}`
  return headers
}
export function codexMcpServers(servers: McpServer[]) {
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      {
        enabled: server.enabled,
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
