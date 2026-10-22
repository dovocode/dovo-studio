import { decode, mutableStruct, type AgentDiscovery, type ModelCatalog } from '@dovo/protocol'
import type { MessageConnection } from 'vscode-jsonrpc/node'
import { Schema } from 'effect'
import { withCatalogRpc } from './rpc.js'
import { vibeConfig, vibeInitialize, vibeServerInfo } from '../providers/vibe/vibe-protocol.js'

function inspectVibe<T>(
  agent: AgentDiscovery,
  inspect: (rpc: MessageConnection, info: typeof vibeServerInfo.Type.serverInfo) => Promise<T>,
) {
  return withCatalogRpc(
    agent.endpoint || 'vibe-app-server',
    agent.args ?? [],
    async (rpc) => {
      const { serverInfo } = decode(
        vibeServerInfo,
        await rpc.sendRequest('initialize', vibeInitialize),
      )
      await rpc.sendNotification('initialized', {})
      return inspect(rpc, serverInfo)
    },
    agent.env,
  )
}
export async function vibeModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  return inspectVibe(agent, async (rpc) => {
    const { config } = decode(vibeConfig, await rpc.sendRequest('config/read', {}))
    return {
      models: config.models.map((model) => ({
        id: model.alias,
        name: model.displayName || model.alias,
        isDefault: model.alias === config.activeModel.alias,
        defaultReasoning: model.thinking,
        reasoning: (model.thinkingLevels ?? []).map((id) => ({ id, name: id })),
      })),
      reasoning: [],
    }
  })
}
export async function vibeAuthenticated(agent: AgentDiscovery) {
  return inspectVibe(
    agent,
    async (rpc) =>
      decode(
        mutableStruct({ hasApiKey: Schema.Boolean }),
        await rpc.sendRequest('setup/status', {}),
      ).hasApiKey,
  )
}

export function vibeVersion(agent: AgentDiscovery) {
  return inspectVibe(agent, async (_rpc, info) => info.version)
}
