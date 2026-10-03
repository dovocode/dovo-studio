import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { decode, decodeResult } from '@dovo/protocol'
import type { Agent } from '@dovo/protocol'
import { Schema } from 'effect'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import { processEnvironment } from '../../../process.js'

const record = Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
async function optionalFile(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Hermes' documented deployment overlay keeps task credentials out of the user's config. */
export async function hermesConfig(agent: Agent) {
  const environment = processEnvironment(agent.env)
  const managed = environment.HERMES_MANAGED_DIR || '/etc/hermes'
  const source = await optionalFile(join(managed, 'config.yaml'))
  const document = parseDocument(source ?? '{}')
  if (document.errors.length)
    throw new Error(`Cannot read Hermes administrator policy: ${document.errors[0].message}`)
  const config = decode(record, document.toJS() ?? {})
  const approval = decodeResult(record, config.approvals).data ?? {}
  // Preserve pinned administrator approvals. Dovo may tighten but never weaken them.
  const mode =
    agent.permission === 'full-access' ? 'off' : agent.permission === 'auto' ? 'smart' : 'manual'
  if (approval.mode !== undefined && approval.mode !== mode)
    throw new Error(
      `Hermes administrator policy pins approvals.mode=${JSON.stringify(approval.mode)}. Choose matching access settings.`,
    )
  config.approvals = { ...approval, mode }
  const mcp = decodeResult(record, config.mcp_servers).data ?? {}
  for (const server of agent.resources?.mcpServers ?? []) {
    if (!server.enabled) continue
    if (Object.hasOwn(mcp, server.name))
      throw new Error(`Hermes administrator policy already configures MCP server ${server.name}`)
    mcp[server.name] =
      server.transport === 'stdio'
        ? { command: server.command, args: server.args, env: mcpServerEnvironment(server) }
        : { url: server.url, transport: 'http', headers: mcpHeaders(server) }
  }
  config.mcp_servers = mcp
  // The native gateway otherwise hides interim prose and tool lifecycle by user display preference.
  const display = decodeResult(record, config.display).data ?? {}
  config.display = {
    ...display,
    interim_assistant_messages: true,
    tool_progress: 'all',
    show_reasoning: true,
  }
  const directory = await mkdtemp(join(tmpdir(), 'dovo-hermes-'))
  try {
    await writeFile(join(directory, 'config.yaml'), stringify(config), { mode: 0o600 })
    const secrets = await optionalFile(join(managed, '.env'))
    if (secrets !== undefined) await writeFile(join(directory, '.env'), secrets, { mode: 0o600 })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return { directory, close: () => rm(directory, { recursive: true, force: true }) }
}
