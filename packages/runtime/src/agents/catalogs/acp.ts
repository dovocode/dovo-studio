import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { withCatalogRpc } from './rpc.js'
const choice = mutableStruct({
  value: Schema.String,
  name: Schema.String,
})
const configSchema = mutableStruct({
  configOptions: Schema.optional(
    mutableArray(
      mutableStruct({
        id: Schema.String,
        category: Schema.optional(Schema.NullOr(Schema.String)),
        type: Schema.String,
        options: Schema.optional(
          mutableArray(
            Schema.Union(
              choice,
              mutableStruct({
                options: mutableArray(choice),
              }),
            ),
          ),
        ),
      }),
    ),
  ),
})
function choices(value: Schema.Schema.Type<typeof configSchema>, category: string) {
  const option = value.configOptions?.find((o) => o.category === category && o.type === 'select')
  return {
    id: option?.id,
    values: (option?.options ?? [])
      .flatMap((o) => ('options' in o ? o.options : [o]))
      .map((o) => ({
        id: o.value,
        name: o.name,
      })),
  }
}
export async function acpModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  if (!agent.endpoint) throw new Error('Set an ACP executable to discover its models')
  return withCatalogRpc(agent.endpoint, agent.args ?? [], async (rpc) => {
    await rpc.sendRequest('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: 'dovo-studio',
        version: '0.1.0',
      },
    })
    const raw = await rpc.sendRequest('session/new', {
      cwd: homedir(),
      mcpServers: [],
    })
    const sessionId = decode(
      mutableStruct({
        sessionId: Schema.String,
      }),
      raw,
    ).sessionId
    let config = decode(configSchema, raw)
    const models = choices(config, 'model')
    if (agent.model && models.id)
      config = decode(
        configSchema,
        await rpc.sendRequest('session/set_config_option', {
          sessionId,
          configId: models.id,
          value: agent.model,
        }),
      )
    return {
      models: models.values,
      reasoning: choices(config, 'thought_level').values,
    }
  })
}
