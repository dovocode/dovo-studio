import { effectivePermissionPolicy } from '@dovo/protocol'
import { z } from 'zod'
import type { Services } from '../services.js'
import type { RunPolicy } from '../auth/run-credentials.js'
import { checkCodeAccess } from './code-access.js'
import { codeFileTools, codeFileCall } from './code-files.js'
import { CodeResults, codeResultTool, checkCodeToolResult } from './code-results.js'
import { codeCatalog, codeCatalogQuery, matchesCodeCatalogQuery } from './code-catalog.js'

const results = new WeakMap<Services, CodeResults>()

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
  let retained = results.get(s)
  if (!retained) results.set(s, (retained = new CodeResults()))
  if (call.source === 'harness') {
    if (call.name === '__check') return { ok: true }
    if (call.name === '__catalog')
      return {
        tools: [...codeFileTools, codeResultTool].filter(
          (tool) =>
            !(grant.readOnly || effectivePermissionPolicy(grant.permissions).readOnly) ||
            (tool.name !== 'write_file' && tool.name !== 'edit'),
        ),
      }
    if (call.name === 'read_tool_result') return retained.read(grant.taskId, call.arguments)
    return codeFileCall(s, grant, call.name, call.arguments, signal, authorize)
  }
  if (call.name === '__servers')
    return { servers: grant.codeDirectories?.mcp?.map((server) => server.name) ?? [] }
  if (!call.server) throw new Error('Select an MCP server from tools.search({source:"mcp"})')
  const catalog = call.name === '__catalog'
  const query = catalog ? codeCatalogQuery.parse(call.arguments?.query) : undefined
  const value = await s.mcpApps.codeTools(
    grant,
    call.server,
    catalog ? undefined : { name: call.name, arguments: call.arguments },
    signal,
    authorize,
  )
  authorize()
  signal.throwIfAborted()
  checkCodeAccess(s.store, grant)
  return retained.retain(
    grant.taskId,
    catalog
      ? { tools: codeCatalog.parse(value).tools.filter(matchesCodeCatalogQuery(query)) }
      : checkCodeToolResult(value),
  )
}
