import { SessionConfigOption } from '@agentclientprotocol/sdk/experimental/v2'
import { acpModelSetting, type AgentDiscovery, type Agent } from '@dovo/protocol'
import type { openAcpV2Connection } from './acp-v2-connection.js'
import {
  acpPermissionModeOption,
  acpReadOnlyMode,
  antigravityPermissionMode,
  kiroAutopilot,
  type AcpPermissionProvider,
} from './acp-permissions.js'

export function acpV2ModelOption(
  options: SessionConfigOption[] | undefined,
): SessionConfigOption | undefined {
  return (
    options?.find(
      (option) => option.category === 'model' && SessionConfigOption.isSelect(option),
    ) ??
    options?.find(
      (option) =>
        SessionConfigOption.isSelect(option) &&
        acpModelSetting({ id: option.configId, category: option.category }) === 'model',
    )
  )
}

export async function configureAcpV2(
  connection: ReturnType<typeof openAcpV2Connection>,
  id: string,
  initial: SessionConfigOption[] | undefined,
  agent: AgentDiscovery &
    Partial<Pick<Agent, 'permission' | 'reasoning' | 'approvalPolicy' | 'sandboxMode'>>,
  textOnly = false,
  permissionProvider?: AcpPermissionProvider,
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
    const applied = options?.find((updated) => updated.configId === configId)
    if (!applied || String(applied.currentValue) !== value)
      throw new Error(`ACP did not apply ${option.name}: ${value}`)
  }
  const restrictive = agent.permission === 'read-only' || textOnly
  const antigravity = permissionProvider === 'antigravity'
  const findMode = () =>
    options?.find((option) => option.category === 'mode' && SessionConfigOption.isSelect(option)) ??
    (antigravity
      ? options?.find(
          (option) =>
            SessionConfigOption.isSelect(option) &&
            acpPermissionModeOption(option, option.configId),
        )
      : undefined)
  const applyMode = async () => {
    const mode = findMode()
    if (!mode || !SessionConfigOption.isSelect(mode))
      throw new Error('This ACP v2 agent does not advertise the required mode')
    const choices = mode.options
      .flatMap((item) => ('options' in item ? item.options : [item]))
      .map(({ value }) => value)
    const value = antigravity
      ? antigravityPermissionMode(
          choices,
          agent.acpMode ?? agent.acpConfig?.[mode.configId],
          { ...agent, permission: agent.permission ?? 'ask' },
          restrictive,
        )
      : restrictive
        ? acpReadOnlyMode(choices)
        : agent.acpMode
    if (!value)
      throw new Error(
        restrictive
          ? 'This ACP v2 agent does not advertise a read-only mode'
          : 'Antigravity does not advertise a mode that can apply this thread’s permissions',
      )
    if (!antigravity || mode.currentValue !== value) await configure(mode.configId, value)
  }
  if (!antigravity && (restrictive || agent.acpMode)) await applyMode()
  for (const [category, value] of [
    ['model', agent.model],
    ['thought_level', agent.reasoning],
  ]) {
    if (!value) continue
    const option =
      category === 'model'
        ? acpV2ModelOption(options)
        : options?.find(
            (option) => option.category === category && SessionConfigOption.isSelect(option),
          )
    if (!option) throw new Error(`This ACP v2 agent does not advertise ${category} configuration`)
    await configure(option.configId, value)
  }
  for (const [configId, value] of Object.entries(agent.acpConfig ?? {})) {
    const option = options?.find((option) => option.configId === configId)
    if (
      (agent.model && acpV2ModelOption(options)?.configId === configId) ||
      (agent.reasoning && option?.category === 'thought_level') ||
      (antigravity && option && acpPermissionModeOption(option, configId)) ||
      (permissionProvider === 'kiro' && configId === 'autopilot')
    )
      continue
    if (restrictive && option?.category === 'mode')
      throw new Error('ACP mode configuration cannot override read-only execution')
    if (agent.acpMode && findMode()?.configId === configId) continue
    await configure(configId, value)
  }
  if (antigravity) await applyMode()
  if (permissionProvider === 'kiro') {
    const autopilot = options?.find((option) => option.configId === 'autopilot')
    if (!autopilot) throw new Error('Kiro does not advertise its Autopilot setting')
    const value = kiroAutopilot(agent)
    await configure(
      'autopilot',
      SessionConfigOption.isBoolean(autopilot) ? String(value === 'on') : value,
    )
  }
  return options
}
