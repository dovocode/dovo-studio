import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import type { AgentDiscovery, HarnessSandboxSupport } from '@dovo/protocol'
import type { AcpLaunch } from '../agents/execution/types.js'

type Provider = AgentDiscovery['provider']

/**
 * A harness's login and configuration folder as the sandbox sees it. The container gets a
 * private, writable folder for this thread at the host path. Configuration from the host
 * appears read-only, and only rotating login files and transcripts are shared writable, so a
 * sandboxed agent cannot change settings, hooks, MCP servers, plugins or extensions that a
 * harness on the host later loads.
 */
export interface HarnessHome {
  /** Host folder. The container sees the thread's private folder at the same path. */
  directory: string
  /** Host entries shown read-only: configuration, instructions, skills, plugins. Missing ones
   * are left out. */
  readOnly: readonly string[]
  /** Host entries shared writable. A missing folder is created; a missing file is left out,
   * so the harness writes it into the private folder instead. */
  shared: ReadonlyArray<{ name: string; folder?: true }>
  /** Host files copied once into the private folder: state that the harness rewrites and that
   * the host never reads back. */
  seed?: ReadonlyArray<{ name: string; from: string }>
}

/** How a harness runs in a sandbox: its mise tool, executable, login folders and the runtime
 * host variables it may receive. */
export interface HarnessProfile {
  /** mise tool without a version. Missing means the harness has no Linux package Dovo can install. */
  tool?: string
  /** In-container executable names that replace the host command. */
  executables: readonly string[]
  /** Login and configuration folders for this harness only, from the resolved agent env. */
  homes: (env: Readonly<Record<string, string | undefined>>, home: string) => HarnessHome[]
  /** Runtime host variables this harness may read, such as its own API key. */
  hostEnv: readonly string[]
  /** Fixed in-container values, such as the configuration folder the harness must use. */
  containerEnv?: (
    env: Readonly<Record<string, string | undefined>>,
    home: string,
  ) => Record<string, string>
  unsupported?: string
  note?: string
}

const multiProviderKeys = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
] as const
const dir = (value: string | undefined, fallback: string) => value || fallback
const folder = (name: string) => ({ name, folder: true as const })
const claudeDirectory = (env: Readonly<Record<string, string | undefined>>, home: string) =>
  dir(env.CLAUDE_CONFIG_DIR, join(home, '.claude'))
/** A folder whose host content the sandbox never sees. */
const privateHome = (directory: string): HarnessHome => ({ directory, readOnly: [], shared: [] })

export const harnessProfiles: Record<Provider, HarnessProfile> = {
  codex: {
    tool: 'npm:@openai/codex',
    executables: ['codex'],
    homes: (env, home) => [
      {
        directory: dir(env.CODEX_HOME, join(home, '.codex')),
        readOnly: [
          'config.toml',
          'AGENTS.md',
          'AGENTS.override.md',
          'hooks.json',
          'rules',
          'prompts',
          'skills',
          'agents',
          'plugins',
        ],
        // auth.json holds refresh tokens that rotate. Codex writes it in place.
        shared: [{ name: 'auth.json' }, folder('sessions'), folder('archived_sessions')],
      },
    ],
    hostEnv: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT'],
  },
  claude: {
    tool: 'npm:@anthropic-ai/claude-code',
    executables: ['claude'],
    homes: (env, home) => {
      const directory = claudeDirectory(env, home)
      return [
        {
          directory,
          readOnly: [
            'settings.json',
            'CLAUDE.md',
            'agents',
            'commands',
            'skills',
            'plugins',
            'output-styles',
            'rules',
            'hooks',
            'keybindings.json',
          ],
          shared: [{ name: '.credentials.json' }, folder('projects')],
          // Claude rewrites .claude.json all the time. It also holds MCP servers, so the
          // container works on its own copy. Without CLAUDE_CONFIG_DIR the host file is
          // ~/.claude.json.
          seed: [
            {
              name: '.claude.json',
              from: env.CLAUDE_CONFIG_DIR
                ? join(directory, '.claude.json')
                : join(home, '.claude.json'),
            },
          ],
        },
      ]
    },
    // Claude otherwise reads ~/.claude.json. Keep all of its state inside the mounted folder.
    containerEnv: (env, home) => ({ CLAUDE_CONFIG_DIR: claudeDirectory(env, home) }),
    hostEnv: [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'ANTHROPIC_VERTEX_PROJECT_ID',
      'CLOUD_ML_REGION',
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_BEARER_TOKEN_BEDROCK',
    ],
  },
  opencode: {
    tool: 'npm:opencode-ai',
    executables: ['opencode'],
    homes: (env, home) => [
      {
        directory: join(dir(env.XDG_CONFIG_HOME, join(home, '.config')), 'opencode'),
        readOnly: [
          'opencode.json',
          'opencode.jsonc',
          'config.json',
          'AGENTS.md',
          'package.json',
          'agent',
          'agents',
          'command',
          'commands',
          'mode',
          'modes',
          'plugin',
          'plugins',
          'tool',
          'tools',
          'skill',
          'skills',
          'themes',
        ],
        shared: [],
      },
      {
        directory: join(dir(env.XDG_DATA_HOME, join(home, '.local', 'share')), 'opencode'),
        readOnly: [],
        shared: [{ name: 'auth.json' }, { name: 'mcp-auth.json' }],
      },
      privateHome(join(dir(env.XDG_STATE_HOME, join(home, '.local', 'state')), 'opencode')),
    ],
    hostEnv: [...multiProviderKeys, 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME'],
    note: 'OpenCode runs its own server in the sandbox. It needs network access.',
  },
  pi: {
    tool: 'npm:@mariozechner/pi-coding-agent',
    executables: ['pi'],
    homes: (env, home) => [
      {
        directory: dir(env.PI_CODING_AGENT_DIR, join(home, '.pi', 'agent')),
        readOnly: [
          'settings.json',
          'models.json',
          'keybindings.json',
          'AGENTS.md',
          'SYSTEM.md',
          'APPEND_SYSTEM.md',
          'extensions',
          'skills',
          'prompts',
          'themes',
          'tools',
          'agents',
        ],
        shared: [{ name: 'auth.json' }, folder('sessions')],
      },
    ],
    hostEnv: multiProviderKeys,
  },
  copilot: {
    tool: 'npm:@github/copilot',
    executables: ['copilot'],
    homes: (env, home) => [
      {
        directory: dir(env.COPILOT_HOME, join(home, '.copilot')),
        // config.json holds both settings and the login, so the sandbox does not share it.
        readOnly: ['mcp-config.json', 'copilot-instructions.md', 'agents', 'skills', 'hooks'],
        shared: [],
      },
    ],
    hostEnv: ['COPILOT_GITHUB_TOKEN'],
  },
  vibe: {
    tool: 'pipx:mistral-vibe',
    executables: ['vibe-app-server'],
    homes: (env, home) => [
      {
        directory: dir(env.VIBE_HOME, join(home, '.vibe')),
        readOnly: [
          'config.toml',
          '.env',
          'AGENTS.md',
          'instructions.md',
          'agents',
          'prompts',
          'tools',
          'skills',
        ],
        shared: [],
      },
    ],
    hostEnv: ['MISTRAL_API_KEY'],
  },
  hermes: {
    tool: 'pipx:hermes-agent',
    executables: ['hermes'],
    homes: (env, home) => [
      {
        directory: dir(env.HERMES_HOME, join(home, '.hermes')),
        readOnly: [
          'config.yaml',
          '.env',
          'SOUL.md',
          'AGENTS.md',
          'skills',
          'plugins',
          'hooks',
          'cron',
        ],
        shared: [{ name: 'auth.json' }],
      },
    ],
    hostEnv: ['OPENROUTER_API_KEY', 'NOUS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  },
  grok: {
    executables: ['grok'],
    homes: (_env, home) => [privateHome(join(home, '.grok'))],
    hostEnv: ['XAI_API_KEY'],
    note: 'Dovo cannot install Grok Build in the sandbox. Add grok to the project mise.toml, or Dovo reports that grok is missing. The sandbox does not see ~/.grok: set XAI_API_KEY or sign in from a sandbox terminal.',
  },
  muse: {
    executables: ['muse'],
    homes: (_env, home) => [privateHome(join(home, '.muse'))],
    hostEnv: [],
    note: 'Dovo cannot install Muse Code in the sandbox. Add muse to the project mise.toml and sign in from a sandbox terminal. The login stays with that thread.',
  },
  cursor: {
    executables: [],
    homes: () => [],
    hostEnv: [],
    unsupported:
      'Cursor runs inside a Dovo SDK worker on the runtime host, so its tools would run outside the sandbox.',
  },
  acp: {
    executables: [],
    homes: () => [],
    hostEnv: [],
  },
}

const keychainNote =
  'Claude Code on macOS keeps its login in the Keychain, which Dovo never reads. Run `claude setup-token` on this Mac and save the token as CLAUDE_CODE_OAUTH_TOKEN in the agent environment (a secret reference works), or open a terminal in a sandboxed thread and run `claude`, then /login. A login made in the sandbox stays with that thread.'
const copilotNote =
  'The sandbox does not share ~/.copilot/config.json, which holds both Copilot settings and its login. Set COPILOT_GITHUB_TOKEN in the agent environment (a secret reference works), or sign in from a sandbox terminal. A login made in the sandbox stays with that thread.'

/** ELF machine values for the container architecture. */
const elfMachine: Partial<Record<string, number>> = { x64: 0x3e, arm64: 0xb7 }

function linuxExecutable(path: string) {
  try {
    const descriptor = openSync(path, 'r')
    try {
      const header = Buffer.alloc(20)
      readSync(descriptor, header, 0, 20, 0)
      if (header.subarray(0, 2).toString() === '#!') return true
      return (
        header.readUInt32BE(0) === 0x7f454c46 &&
        header.readUInt16LE(18) === elfMachine[process.arch]
      )
    } finally {
      closeSync(descriptor)
    }
  } catch {
    return false
  }
}

/** Whether a configured harness can run in a sandbox, with a reason when it cannot. Checks only
 * local facts; a missing executable inside the container appears when the turn starts. */
export function harnessSandboxSupport(
  agent: Pick<AgentDiscovery, 'provider' | 'env' | 'endpoint' | 'acpInstallationId' | 'args'>,
  options: {
    acpLaunch?: AcpLaunch
    /** Registry installation directory: launches from it map to the Linux distribution. */
    acpRegistryInstalled?: boolean
    mounted?: (path: string) => boolean
    platform?: NodeJS.Platform
    home?: string
  } = {},
): HarnessSandboxSupport {
  const profile = harnessProfiles[agent.provider]
  if (profile.unsupported) return { supported: false, note: profile.unsupported }
  const env = agent.env ?? {}
  const home = options.home ?? homedir()
  if (agent.provider === 'claude' && (options.platform ?? process.platform) === 'darwin') {
    const directory = claudeDirectory(env, home)
    const token = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].some(
      (name) => env[name] || process.env[name],
    )
    if (!token && !existsSync(join(directory, '.credentials.json')))
      return { supported: true, note: keychainNote }
  }
  if (
    agent.provider === 'copilot' &&
    !(env.COPILOT_GITHUB_TOKEN || process.env.COPILOT_GITHUB_TOKEN)
  )
    return { supported: true, note: copilotNote }
  if (agent.provider === 'hermes') {
    const command = agent.endpoint || env.HERMES_PYTHON || 'hermes'
    if (basename(command) !== 'hermes')
      return {
        supported: false,
        note: 'Select the hermes executable for sandboxed threads. A Python interpreter launch uses a host environment.',
      }
  }
  if (agent.provider === 'acp') {
    if (agent.acpInstallationId && options.acpRegistryInstalled !== false)
      return { supported: true }
    const command = options.acpLaunch?.command ?? agent.endpoint
    if (!command) return { supported: false, note: 'Set the ACP agent command first.' }
    if (!isAbsolute(command))
      return {
        supported: true,
        note: `${command} must be installed in the sandbox, for example through the project mise.toml or npx.`,
      }
    const mounted = options.mounted?.(command) ?? false
    let file = false
    try {
      file = statSync(command).isFile()
    } catch {
      file = false
    }
    if (!mounted || !file || !linuxExecutable(command))
      return {
        supported: false,
        note: `${command} is not available in the sandbox. Only Linux executables inside the project checkout, or commands installed in the sandbox, can run there.`,
      }
    return { supported: true }
  }
  return profile.note ? { supported: true, note: profile.note } : { supported: true }
}

/** Version from `<harness> --version` output, as Dovo diagnostics report it. */
export function reportedHarnessVersion(output: string) {
  return output.match(/(?:^|\s|\()v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|\s|\))/)?.[1]
}

/** Whether Dovo may read a sandboxed thread's native child transcript. Claude's reader only
 * reads transcript files. Codex's reader starts `codex app-server`, so it runs only inside a
 * running container. OpenCode's reader starts a server on the host for the checkout, so a
 * sandboxed thread shows the saved prompt and result instead. */
export function sandboxNativeReads(provider: Provider, container: boolean) {
  return provider === 'claude' || (provider === 'codex' && container)
}
