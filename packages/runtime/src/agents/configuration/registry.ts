import { homedir } from 'node:os'
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
  private adapters = new Map<Agent['provider'], AgentAdapter>()
  readonly host = new ExtensionHost()
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private acpLaunch?: (id: string) => AcpLaunch,
  ) {
    const providers = [
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
          Effect.gen(this, function* () {
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
    return {
      ...agent,
      ...(agent.configDirectory ? { configDirectory: expandHome(agent.configDirectory) } : {}),
      ...(agent.configDirectory &&
      (agent.provider === 'codex' || agent.provider === 'claude' || agent.provider === 'hermes')
        ? {
            env: {
              ...agent.env,
              [agent.provider === 'hermes'
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
    return Effect.gen(this, function* () {
      yield* this.host.activateEffect(`dovo.provider.${provider}`)
      const adapter = this.adapters.get(provider)
      if (!adapter)
        return yield* Effect.fail(runtimeFailure(new Error('Provider failed to activate')))
      const models = adapter.models
      return {
        run: (run) =>
          adapter.run({
            ...run,
            agent: this.configure(run.agent),
            acpLaunch: this.launch(run.agent),
          }),
        probe: (agent) => adapter.probe(this.configure(agent), this.launch(agent)),
        ...(models
          ? {
              models: (agent: AgentDiscovery) => models(this.configure(agent), this.launch(agent)),
            }
          : {}),
      } satisfies AgentAdapter
    })
  }
  get(provider: Agent['provider']) {
    return runClientEffect(this.getEffect(provider))
  }
  async dispose() {
    const adapters = [...this.adapters.values()]
    const results = await Promise.allSettled(adapters.map(async (adapter) => adapter.dispose?.()))
    const host = await Promise.allSettled([this.host.dispose()])
    const failures = [...results, ...host].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length) throw new AggregateError(failures, 'Could not close all agent providers')
  }
}
