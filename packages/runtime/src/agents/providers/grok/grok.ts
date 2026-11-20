import { checkedPolicyRun } from '../shared/permission-policy.js'
import type { Agent, AgentDiscovery } from '@dovo/protocol'
import type { AcpLaunch, AgentAdapter } from '../../execution/types.js'
import { createAcpAdapter } from '../acp/acp.js'
import { acpModels } from '../../catalogs/acp.js'
import { inspectAcp } from '../acp/acp-connection.js'
export function grokLaunch(agent: AgentDiscovery, permission?: Agent['permission']): AcpLaunch {
  const args = agent.args ?? []
  const extra = permission
    ? args.filter(
        (arg, index) =>
          args[index - 1] !== '--permission-mode' &&
          !/^--(?:permission-mode|always-approve)(?:=|$)/.test(arg),
      )
    : args
  return {
    command: agent.endpoint || 'grok',
    args: [
      '--no-auto-update',
      ...(permission && permission !== 'full-access'
        ? ['--permission-mode', permission === 'auto' ? 'auto' : 'default']
        : []),
      'agent',
      '--no-leader',
      ...(permission === 'full-access' ? ['--always-approve'] : []),
      'stdio',
      ...extra,
    ],
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
    run: async (run) => {
      run = checkedPolicyRun(run, 'grok')
      if (run.tools === 'none' || run.agent.permission === 'read-only')
        return Promise.reject(
          new Error(
            'Grok Build does not advertise restricted tool-free sessions; choose another provider for utilities',
          ),
        )
      // Keep older saved Auto-accept edits usable under supervised execution.
      const permission = run.agent.permission === 'workspace-write' ? 'ask' : run.agent.permission
      const agent = { ...run.agent, permission }
      return acp.run({ ...run, agent, acpLaunch: grokLaunch(agent, permission) })
    },
    dispose: acp.dispose,
    releaseTask: acp.releaseTask,
  }
}
