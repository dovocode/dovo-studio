import { SessionConfigOption } from '@agentclientprotocol/sdk/experimental/v2'
import type { AgentDiscovery, Agent } from '@dovo/protocol'
import type { openAcpV2Connection } from './acp-v2-connection.js'

export async function configureAcpV2(
  connection: ReturnType<typeof openAcpV2Connection>,
  id: string,
  initial: SessionConfigOption[] | undefined,
  agent: AgentDiscovery & Partial<Pick<Agent, 'permission' | 'reasoning'>>,
  textOnly = false,
): Promise<SessionConfigOption[] | undefined> {
  let options = initial
  const configure = async (configId: string, value: string) => {
    const option = options?.find((option) => option.configId === configId)
    if (!option) throw new Error(`ACP configuration ${configId} is unavailable`)
    if (SessionConfigOption.isBoolean(option)) {
      if (value !== 'true' && value !== 'false')
        throw new Error(`ACP configuration ${configId} must be true or false`)
      options = (
        await connection.control(
          connection.rpc.request('session/set_config_option', {
            sessionId: id,
            configId,
            type: 'boolean',
            value: value === 'true',
          }),
          'configuration',
        )
      ).configOptions
    } else if (SessionConfigOption.isSelect(option)) {
      const choices = option.options.flatMap((item) => ('options' in item ? item.options : [item]))
      if (!choices.some((item) => item.value === value))
        throw new Error(`ACP configuration ${configId} does not offer ${value}`)
      options = (
        await connection.control(
          connection.rpc.request('session/set_config_option', {
            sessionId: id,
            configId,
            type: 'id',
            value,
          }),
          'configuration',
        )
      ).configOptions
    } else throw new Error(`ACP configuration ${configId} has an unsupported type`)
  }
  const restrictive = agent.permission === 'read-only' || textOnly
  const mode = options?.find(
    (option) => option.category === 'mode' && SessionConfigOption.isSelect(option),
  )
  if (restrictive || agent.acpMode) {
    if (!mode || !SessionConfigOption.isSelect(mode))
      throw new Error('This ACP v2 agent does not advertise the required mode')
    const choices = mode.options.flatMap((item) => ('options' in item ? item.options : [item]))
    const value = restrictive
      ? choices.find((item) => /^(plan|read[-_ ]?only)$/i.test(item.value))?.value
      : agent.acpMode
    if (!value) throw new Error('This ACP v2 agent does not advertise a read-only mode')
    await configure(mode.configId, value)
  }
  for (const [category, value] of [
    ['model', agent.model],
    ['thought_level', agent.reasoning],
  ]) {
    if (!value) continue
    const option = options?.find(
      (option) => option.category === category && SessionConfigOption.isSelect(option),
    )
    if (!option) throw new Error(`This ACP v2 agent does not advertise ${category} configuration`)
    await configure(option.configId, value)
  }
  for (const [configId, value] of Object.entries(agent.acpConfig ?? {})) {
    if (restrictive && options?.find((option) => option.configId === configId)?.category === 'mode')
      throw new Error('ACP mode configuration cannot override read-only execution')
    await configure(configId, value)
  }
  return options
}
