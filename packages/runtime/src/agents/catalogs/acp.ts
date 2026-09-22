import { homedir } from 'node:os'
import { z } from 'zod'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { withCatalogRpc } from './rpc.js'
const choice = z.object({ value: z.string(), name: z.string() })
const configSchema = z.object({
  configOptions: z
    .array(
      z.object({
        id: z.string(),
        category: z.string().nullish(),
        type: z.string(),
        options: z.array(z.union([choice, z.object({ options: z.array(choice) })])).optional(),
      }),
    )
    .optional(),
})
function choices(value: z.infer<typeof configSchema>, category: string) {
  const option = value.configOptions?.find((o) => o.category === category && o.type === 'select')
  return {
    id: option?.id,
    values: (option?.options ?? [])
      .flatMap((o) => ('options' in o ? o.options : [o]))
      .map((o) => ({ id: o.value, name: o.name })),
  }
}
export async function acpModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  if (!agent.endpoint) throw new Error('Set an ACP executable to discover its models')
  return withCatalogRpc(agent.endpoint, agent.args ?? [], async (rpc) => {
    await rpc.sendRequest('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'dovo-studio', version: '0.1.0' },
    })
    const raw = await rpc.sendRequest('session/new', { cwd: homedir(), mcpServers: [] })
    const sessionId = z.object({ sessionId: z.string() }).parse(raw).sessionId
    let config = configSchema.parse(raw)
    const models = choices(config, 'model')
    if (agent.model && models.id)
      config = configSchema.parse(
        await rpc.sendRequest('session/set_config_option', {
          sessionId,
          configId: models.id,
          value: agent.model,
        }),
      )
    return { models: models.values, reasoning: choices(config, 'thought_level').values }
  })
}
