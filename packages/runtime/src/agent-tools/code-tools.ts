import { effectivePermissionPolicy } from '@dovo/protocol'
import { z } from 'zod'
import type { Services } from '../services.js'
import type { RunPolicy } from '../auth/run-credentials.js'
import { checkCodeAccess } from './code-access.js'
import { codeFileTools, codeFileCall } from './code-files.js'

const command = z
  .object({
    source: z.enum(['harness', 'mcp']),
    name: z.string().min(1).max(200),
    server: z.string().min(1).max(200).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export async function codeToolCommand(
  s: Services,
  grant: RunPolicy,
  input: unknown,
  signal: AbortSignal,
  authorize: () => void,
) {
  const call = command.parse(input)
  authorize()
  signal.throwIfAborted()
  checkCodeAccess(s.store, grant)
  if (call.source === 'harness') {
    if (call.name === '__catalog')
      return {
        tools: codeFileTools.filter(
          (tool) =>
            !(grant.readOnly || effectivePermissionPolicy(grant.permissions).readOnly) ||
            tool.name !== 'write_file',
        ),
      }
    return codeFileCall(s, grant, call.name, call.arguments, signal, authorize)
  }
  if (call.name === '__servers')
    return { servers: grant.codeDirectories?.mcp?.map((server) => server.name) ?? [] }
  if (!call.server) throw new Error('Select an MCP server from tools.search({source:"mcp"})')
  return s.mcpApps.codeTools(
    grant,
    call.server,
    call.name === '__catalog' ? undefined : { name: call.name, arguments: call.arguments },
    signal,
    authorize,
  )
}
