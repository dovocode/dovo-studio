import { Effect } from 'effect'
import { runtimeOperation, runtimeFailure } from '../errors.js'
import { decode } from '@dovo/protocol'
import { ExtensionHost, runClientEffect } from '@dovo/client-runtime'
import { commandsSchema, type CommandSettings, type AgentDiscovery } from '@dovo/protocol'
import type { Agent } from '@dovo/protocol'
import type { AcpLaunch, AgentAdapter } from './types.js'
export class AgentRegistry {
  private adapters = new Map<Agent['provider'], AgentAdapter>()
  readonly host = new ExtensionHost()
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private acpLaunch?: (id: string) => AcpLaunch,
  ) {
    const providers = [
      ['codex', () => import('./providers/codex.js').then((m) => m.codexAdapter)],
      ['opencode', () => import('./providers/opencode.js').then((m) => m.opencodeAdapter)],
      ['claude', () => import('./providers/claude.js').then((m) => m.claudeAdapter)],
      ['acp', () => import('./providers/acp.js').then((m) => m.acpAdapter)],
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
      endpoint:
        agent.endpoint || (agent.provider === 'opencode' ? '' : this.settings()[agent.provider]),
    }
  }
  launch(agent: AgentDiscovery): AcpLaunch | undefined {
    if (agent.provider !== 'acp' || !agent.acpInstallationId) return undefined
    if (!this.acpLaunch) throw new Error('Managed ACP installations are unavailable')
    return this.acpLaunch(agent.acpInstallationId)
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
  dispose() {
    return this.host.dispose()
  }
}
