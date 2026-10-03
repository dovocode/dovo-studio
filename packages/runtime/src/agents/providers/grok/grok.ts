import type { AgentDiscovery } from '@dovo/protocol'
import type { AcpLaunch, AgentAdapter } from '../../execution/types.js'
import { createAcpAdapter } from '../acp/acp.js'
import { acpModels } from '../../catalogs/acp.js'
import { inspectAcp } from '../acp/acp-connection.js'
export function grokLaunch(agent: AgentDiscovery): AcpLaunch {
  return {
    command: agent.endpoint || 'grok',
    args: ['--no-auto-update', 'agent', '--no-leader', 'stdio', ...(agent.args ?? [])],
    env: agent.env ?? {},
    authentication: 'grok',
  }
}
/** Grok Build exposes its full interactive agent through ACP, not the xAI model API. */
export function createGrokAdapter(): AgentAdapter {
  const acp = createAcpAdapter()
  return {
    models: (agent) => acpModels(agent, grokLaunch(agent)),
    async probe(agent) {
      try {
        await inspectAcp(grokLaunch(agent))
        return {
          provider: 'grok',
          available: true,
          detail: 'Grok Build is authenticated and exposes ACP.',
        }
      } catch (error) {
        return {
          provider: 'grok',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    },
    run: (run) => {
      if (run.tools === 'none' || run.agent.permission === 'read-only')
        return Promise.reject(
          new Error(
            'Grok Build does not advertise restricted tool-free sessions; choose another provider for utilities',
          ),
        )
      return acp.run({ ...run, acpLaunch: grokLaunch(run.agent) })
    },
    dispose: acp.dispose,
  }
}
