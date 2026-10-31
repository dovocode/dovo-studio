import { homedir } from 'node:os'
import { SecretReferences } from './secret-references.js'
import { join } from 'node:path'
import { Effect } from 'effect'
import { runtimeOperation, runtimeFailure } from '../../errors.js'
import { decode } from '@dovo/protocol'
import { ExtensionHost, runClientEffect } from '@dovo/client-runtime'
import { commandsSchema, type CommandSettings, type AgentDiscovery } from '@dovo/protocol'
import type { Agent } from '@dovo/protocol'
import type { AcpLaunch, AgentAdapter } from '../execution/types.js'
const expandHome = (path: string) =>
  path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

export class AgentRegistry {
  readonly secretReferences = new SecretReferences()
  get secretGeneration() {
    return this.secretReferences.generation
  }
  private adapters = new Map<Agent['provider'], AgentAdapter>()
  readonly host = new ExtensionHost()
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private acpLaunch?: (id: string) => AcpLaunch,
  ) {
    const providers = [
      ['vibe', () => import('../providers/vibe/vibe.js').then((m) => m.createVibeAdapter())],
      ['codex', () => import('../providers/codex/codex.js').then((m) => m.createCodexAdapter())],
      [
        'opencode',
        () => import('../providers/opencode/opencode.js').then((m) => m.createOpenCodeAdapter()),
      ],
      [
        'claude',
        () => import('../providers/claude/claude.js').then((m) => m.createClaudeAdapter()),
      ],
      [
        'hermes',
        () => import('../providers/hermes/hermes.js').then((m) => m.createHermesAdapter()),
      ],
      [
        'copilot',
        () => import('../providers/copilot/copilot.js').then((m) => m.createCopilotAdapter()),
      ],
      ['grok', () => import('../providers/grok/grok.js').then((m) => m.createGrokAdapter())],
      ['muse', () => import('../providers/muse/muse.js').then((m) => m.createMuseAdapter())],
      [
        'cursor',
        () => import('../providers/cursor/cursor.js').then((m) => m.createCursorAdapter()),
      ],
      ['acp', () => import('../providers/acp/acp.js').then((m) => m.createAcpAdapter())],
    ] as const
    for (const [id, load] of providers)
      this.host.register({
        manifest: {
          id: `dovo.provider.${id}`,
          name: id,
          version: '0.1.0',
          activationEvents: [`onCommand:agent.${id}.run`],
        },
        activate: (context) =>
          Effect.gen({ self: this }, function* () {
            this.adapters.set(id, yield* runtimeOperation(load))
            context.subscriptions.push({
              dispose: () => {
                this.adapters.delete(id)
              },
            })
          }),
      })
  }
  configure<T extends AgentDiscovery>(agent: T): T {
    if (agent.provider === 'cursor') return { ...agent, endpoint: '' }
    return {
      ...agent,
      ...(agent.configDirectory ? { configDirectory: expandHome(agent.configDirectory) } : {}),
      ...(agent.configDirectory &&
      (agent.provider === 'codex' ||
        agent.provider === 'claude' ||
        agent.provider === 'hermes' ||
        agent.provider === 'vibe')
        ? {
            env: {
              ...agent.env,
              [agent.provider === 'vibe'
                ? 'VIBE_HOME'
                : agent.provider === 'hermes'
                  ? 'HERMES_HOME'
                  : agent.provider === 'codex'
                    ? 'CODEX_HOME'
                    : 'CLAUDE_CONFIG_DIR']: expandHome(agent.configDirectory),
            },
          }
        : {}),
      endpoint: expandHome(
        (agent.provider !== 'opencode' ? agent.executablePath : undefined) ||
          agent.endpoint ||
          (agent.provider === 'hermes' ? agent.env?.HERMES_PYTHON : undefined) ||
          (agent.provider === 'opencode' ? '' : this.settings()[agent.provider]),
      ),
    }
  }
  launch(agent: AgentDiscovery): AcpLaunch | undefined {
    if (agent.provider !== 'acp' || !agent.acpInstallationId) return undefined
    if (!this.acpLaunch) throw new Error('Managed ACP installations are unavailable')
    const launch = this.acpLaunch(agent.acpInstallationId)
    return {
      command: expandHome(agent.executablePath || launch.command),
      args: [...launch.args, ...(agent.args ?? [])],
      env: { ...launch.env, ...agent.env },
    }
  }
  getEffect(provider: Agent['provider']) {
    return Effect.gen({ self: this }, function* () {
      yield* this.host.activateEffect(`dovo.provider.${provider}`)
      const adapter = this.adapters.get(provider)
      if (!adapter)
        return yield* Effect.fail(runtimeFailure(new Error('Provider failed to activate')))
      const models = adapter.models
      const readNativeThread = adapter.readNativeThread
      return {
        ...(readNativeThread
          ? {
              readNativeThread: (
                agent: Agent,
                id: string,
                sessionId: string | undefined,
                cwd?: string,
              ) =>
                this.secretReferences
                  .resolve(this.configure(agent))
                  .then((resolved) => readNativeThread(resolved, id, sessionId, cwd)),
            }
          : {}),
        run: async (run) => {
          const agent = await this.secretReferences.resolve(this.configure(run.agent), run.signal)
          return adapter.run({ ...run, agent, acpLaunch: this.launch(agent) })
        },
        probe: (agent) => {
          const configured = this.configure(agent)
          this.launch(configured)
          return this.secretReferences
            .resolve(configured)
            .then((resolved) => adapter.probe(resolved, this.launch(resolved)))
        },
        ...(models
          ? {
              models: (agent: AgentDiscovery) => {
                const configured = this.configure(agent)
                this.launch(configured)
                return this.secretReferences
                  .resolve(configured)
                  .then((resolved) => models(resolved, this.launch(resolved)))
              },
            }
          : {}),
      } satisfies AgentAdapter
    })
  }
  get(provider: Agent['provider']) {
    return runClientEffect(this.getEffect(provider))
  }
  async releaseTask(taskId: string) {
    const results = await Promise.allSettled(
      [...this.adapters.values()].map(async (adapter) => adapter.releaseTask?.(taskId)),
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length) throw new AggregateError(failures, 'Could not release task providers')
  }
  async dispose() {
    const secrets = await Promise.allSettled([this.secretReferences.close()])
    const adapters = [...this.adapters.values()]
    const results = await Promise.allSettled(adapters.map(async (adapter) => adapter.dispose?.()))
    const host = await Promise.allSettled([this.host.dispose()])
    const failures = [...secrets, ...results, ...host].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length) throw new AggregateError(failures, 'Could not close all agent providers')
  }
}
