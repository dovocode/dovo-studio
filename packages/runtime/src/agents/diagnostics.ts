import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { compare, valid } from 'semver'
import { Schema } from 'effect'
import type { AgentDiscovery, CommandSettings } from '@dovo/protocol'
import { exec, processEnvironment } from '../process.js'
export interface AdapterDiagnostic {
  id: string
  name: string
  provider: AgentDiscovery['provider'] | 'mcp'
  kind: 'executable' | 'sdk' | 'server'
  available: boolean
  installedVersion: string | null
  latestVersion: string | null
  updateStatus: 'not-checked' | 'current' | 'update-available' | 'ahead' | 'unknown'
  detail: string
  guidance: string
  documentationUrl: string
}
interface Check {
  id: string
  name: string
  provider: AdapterDiagnostic['provider']
  kind: AdapterDiagnostic['kind']
  packageName?: string
  guidance: string
  documentationUrl: string
  inspect: () => Promise<{
    version: string | null
    detail: string
  }>
}
const packageSchema = mutableStruct({
  name: Schema.String,
  version: Schema.String,
})
async function installedPackageVersion(name: string) {
  const entry = name === '@modelcontextprotocol/sdk' ? `${name}/client/index.js` : name
  let directory = dirname(fileURLToPath(import.meta.resolve(entry)))
  // Package exports often hide package.json; find the manifest belonging to the resolved module.
  for (let depth = 0; depth < 6; depth++) {
    try {
      const manifest = decodeResult(
        packageSchema,
        JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
      )
      if (manifest.success && manifest.data.name === name) return manifest.data.version
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error('Installed package manifest could not be located.')
}
function reportedVersion(output: string) {
  const clean = stripVTControlCharacters(output)
  const candidate = clean.match(
    /(?:^|\s|\()v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|\s|\))/,
  )?.[1]
  return candidate ? valid(candidate) : null
}
function executable(command: string) {
  return async () => {
    const { stdout } = await exec(command, ['--version'], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: processEnvironment(),
    })
    return {
      version: reportedVersion(stdout),
      detail: 'Executable responds. Provider authentication was not tested.',
    }
  }
}
function sdk(name: string) {
  return async () => ({
    version: await installedPackageVersion(name),
    detail: 'Adapter dependency bundled with this Dovo runtime.',
  })
}
function checks(settings: CommandSettings, agents: AgentDiscovery[]): Check[] {
  const result: Check[] = [
    {
      id: 'codex',
      name: 'Codex CLI',
      provider: 'codex',
      kind: 'executable',
      packageName: '@openai/codex',
      inspect: executable(settings.codex),
      guidance:
        'Update with the installer that owns this executable (npm: npm install -g @openai/codex@latest; Homebrew: brew upgrade codex).',
      documentationUrl: 'https://developers.openai.com/codex/cli/',
    },
    {
      id: 'claude-sdk',
      name: 'Claude Agent SDK',
      provider: 'claude',
      kind: 'sdk',
      packageName: '@anthropic-ai/claude-agent-sdk',
      inspect: sdk('@anthropic-ai/claude-agent-sdk'),
      guidance:
        'Update Dovo to receive its tested, pinned Claude SDK. Install Claude CLI separately on the runtime host. Updating the global Claude CLI does not update this SDK.',
      documentationUrl: 'https://github.com/anthropics/claude-agent-sdk-typescript/releases',
    },
    {
      id: 'opencode-sdk',
      name: 'OpenCode SDK',
      provider: 'opencode',
      kind: 'sdk',
      packageName: '@opencode-ai/sdk',
      inspect: sdk('@opencode-ai/sdk'),
      guidance:
        'Update Dovo to receive its tested, pinned OpenCode SDK. Update the OpenCode server separately on its host.',
      documentationUrl: 'https://opencode.ai/docs/sdk/',
    },
    {
      id: 'acp-sdk',
      name: 'Agent Client Protocol SDK',
      provider: 'acp',
      kind: 'sdk',
      packageName: '@agentclientprotocol/sdk',
      inspect: sdk('@agentclientprotocol/sdk'),
      guidance:
        'Update Dovo to receive its tested ACP SDK. Custom ACP agents have their own installers and release channels.',
      documentationUrl: 'https://github.com/agentclientprotocol/typescript-sdk/releases',
    },
    {
      id: 'mcp-sdk',
      name: 'Model Context Protocol SDK',
      provider: 'mcp',
      kind: 'sdk',
      packageName: '@modelcontextprotocol/sdk',
      inspect: sdk('@modelcontextprotocol/sdk'),
      guidance:
        'Update Dovo to receive its tested MCP SDK. Project and custom-agent MCP servers are managed separately.',
      documentationUrl: 'https://github.com/modelcontextprotocol/typescript-sdk/releases',
    },
  ]
  const configured = new Set<string>(['codex\0' + settings.codex])
  for (const agent of [
    {
      provider: 'claude' as const,
      endpoint: settings.claude,
    },
    {
      provider: 'acp' as const,
      endpoint: settings.acp,
    },
    ...agents,
  ]) {
    if (agent.provider === 'opencode') continue
    const command = agent.endpoint || (agent.provider === 'claude' ? 'claude' : '')
    if (!command || configured.has(`${agent.provider}\0${command}`)) continue
    configured.add(`${agent.provider}\0${command}`)
    result.push({
      id: `${agent.provider}-executable-${result.length}`,
      name: `${agent.provider === 'claude' ? 'Claude' : agent.provider === 'codex' ? 'Codex' : 'ACP'} executable (${command})`,
      provider: agent.provider,
      kind: 'executable',
      ...(agent.provider === 'claude'
        ? {
            packageName: '@anthropic-ai/claude-code',
          }
        : agent.provider === 'codex'
          ? {
              packageName: '@openai/codex',
            }
          : {}),
      inspect: executable(command),
      guidance:
        agent.provider === 'claude'
          ? 'Update this configured executable using its original installer; native Claude installations support claude update. Dovo’s bundled SDK is updated separately.'
          : 'Update this configured executable using its original installer. Custom ACP agents do not share a release version.',
      documentationUrl:
        agent.provider === 'claude'
          ? 'https://code.claude.com/docs/en/setup'
          : agent.provider === 'codex'
            ? 'https://developers.openai.com/codex/cli/'
            : 'https://agentclientprotocol.com/overview/agents',
    })
  }
  const addresses = new Set(
    agents
      .filter((agent) => agent.provider === 'opencode')
      .map((agent) => agent.endpoint || 'http://127.0.0.1:4096'),
  )
  // Probe the default endpoint when no OpenCode agent has been configured yet.
  if (!addresses.size) addresses.add('http://127.0.0.1:4096')
  for (const address of addresses) {
    result.push({
      id: `opencode-server-${result.length}`,
      name: 'OpenCode server',
      provider: 'opencode',
      kind: 'server',
      packageName: 'opencode-ai',
      guidance:
        'On the OpenCode host, run opencode upgrade using its existing installation method, then restart opencode serve. Authentication uses OPENCODE_SERVER_PASSWORD when configured.',
      documentationUrl: 'https://opencode.ai/docs/cli/#upgrade',
      inspect: async () => {
        const url = new URL(address)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Use an HTTP(S) OpenCode URL without embedded credentials.')
        const response = await fetch(new URL('global/health', `${url.href.replace(/\/$/, '')}/`), {
          signal: AbortSignal.timeout(5000),
          headers: process.env.OPENCODE_SERVER_PASSWORD
            ? {
                Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`,
              }
            : {},
        })
        if (!response.ok) throw new Error(`OpenCode health check returned HTTP ${response.status}.`)
        const health = decode(
          mutableStruct({
            healthy: Schema.Literal(true),
            version: Schema.String,
          }),
          await response.json(),
        )
        return {
          version: valid(health.version),
          detail: `Server responds at ${url.origin}. Model credentials were not tested.`,
        }
      },
    })
  }
  return result
}

/** Read-only checks: no model turns, logins, updates, or install commands are executed. */
export async function checkAdapterUpdates(
  settings: CommandSettings,
  options: {
    checkUpdates?: boolean
    agents?: AgentDiscovery[]
  } = {},
): Promise<AdapterDiagnostic[]> {
  const releases = new Map<string, Promise<string>>()
  const latest = (name: string) => {
    let pending = releases.get(name)
    if (!pending) {
      pending = (async () => {
        const response = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
          {
            signal: AbortSignal.timeout(5000),
          },
        )
        if (!response.ok) throw new Error(`Update registry returned HTTP ${response.status}.`)
        const manifest = decode(packageSchema, await response.json())
        if (manifest.name !== name || !valid(manifest.version))
          throw new Error('Update registry returned an invalid package version.')
        return manifest.version
      })()
      releases.set(name, pending)
    }
    return pending
  }
  return Promise.all(
    checks(settings, options.agents ?? []).map(async (check) => {
      const base: AdapterDiagnostic = {
        id: check.id,
        name: check.name,
        provider: check.provider,
        kind: check.kind,
        available: false,
        installedVersion: null,
        latestVersion: null,
        updateStatus: options.checkUpdates ? 'unknown' : 'not-checked',
        detail: '',
        guidance: check.guidance,
        documentationUrl: check.documentationUrl,
      }
      try {
        const installed = await check.inspect()
        base.available = true
        base.installedVersion = installed.version
        base.detail = installed.detail
        if (!installed.version) base.detail += ' A comparable version was not reported.'
      } catch (error) {
        // Child stderr may contain environment or authentication data; never include it in diagnostics.
        base.detail =
          check.kind === 'executable'
            ? 'Executable could not be started or did not respond to --version within 5 seconds.'
            : check.kind === 'sdk'
              ? 'Installed adapter dependency could not be read. Reinstall Dovo dependencies with its lockfile.'
              : error instanceof Error &&
                  error.message.startsWith('OpenCode health check returned HTTP ')
                ? error.message
                : 'OpenCode server is unreachable or returned an incompatible health response.'
      }
      if (options.checkUpdates && check.packageName) {
        try {
          base.latestVersion = await latest(check.packageName)
          if (base.installedVersion && valid(base.installedVersion)) {
            const comparison = compare(base.latestVersion, base.installedVersion)
            base.updateStatus =
              comparison > 0 ? 'update-available' : comparison < 0 ? 'ahead' : 'current'
          }
        } catch {
          base.detail +=
            ' Latest release could not be checked; try again when registry.npmjs.org is reachable.'
        }
      }
      return base
    }),
  )
}
