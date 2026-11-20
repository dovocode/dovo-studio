import { acpV2Models } from '../providers/acp/acp-v2-services.js'
import { acpModelOption, legacyAcpModels } from '../providers/acp/acp-models.js'
import { acpV1ModeOption, applyAcpV1Option, setAcpV1Mode } from '../providers/acp/acp-v1-config.js'
import { homedir } from 'node:os'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { methods, type SessionConfigOption } from '@agentclientprotocol/sdk/unstable'
import type { AcpLaunch } from '../execution/types.js'
import {
  acpControl,
  initializeAcp,
  legacyAcpLaunch,
  openAcpConnection,
} from '../providers/acp/acp-connection.js'

function options(config: SessionConfigOption[] | null | undefined, category: string) {
  const entry =
    category === 'model'
      ? acpModelOption(config)
      : config?.find((item) => item.category === category && item.type === 'select')
  return entry?.type === 'select'
    ? entry.options
        .flatMap((item) => ('options' in item ? item.options : [item]))
        .map((item) => ({ id: item.value, name: item.name }))
    : []
}

export async function acpModels(agent: AgentDiscovery, launch?: AcpLaunch): Promise<ModelCatalog> {
  if (!launch?.command && !agent.endpoint)
    throw new Error('Set an ACP executable to discover its models')
  const command = launch ?? {
    ...legacyAcpLaunch(agent.endpoint, agent.args ?? []),
    env: agent.env ?? {},
  }
  const v2 = await acpV2Models(command, agent)
  if (v2.handled) return v2.value
  let commands: Array<{ name: string; description: string; inputHint?: string }> = []
  let updatedConfig: SessionConfigOption[] | undefined
  const connection = openAcpConnection(command, {
    requestPermission: () => ({ outcome: { outcome: 'cancelled' } }),
    sessionUpdate: ({ update }) => {
      if (update.sessionUpdate === 'available_commands_update')
        commands = update.availableCommands.map((item) => ({
          name: item.name,
          description: item.description,
          inputHint: item.input?.hint,
        }))
      if (update.sessionUpdate === 'config_option_update') updatedConfig = update.configOptions
    },
  })
  let closeSessionId: string | undefined
  let canClose = false
  let succeeded = false
  try {
    const initialization = await initializeAcp(connection, {
      session: { configOptions: { boolean: {} } },
    })
    canClose = !!initialization.agentCapabilities?.sessionCapabilities?.close
    const session = await acpControl(
      connection,
      connection.rpc.request(methods.agent.session.new, { cwd: homedir(), mcpServers: [] }),
      'model discovery',
    )
    closeSessionId = session.sessionId
    let config = updatedConfig ?? session.configOptions
    if (agent.acpMode) {
      config =
        (await setAcpV1Mode(
          connection,
          closeSessionId,
          { ...session, configOptions: config },
          agent.acpMode,
        )) ??
        updatedConfig ??
        config
    }
    const legacy = legacyAcpModels(session)
    let legacyModel = legacy?.currentModelId
    const configured = options(config, 'model')
    const models = configured.length
      ? configured
      : (legacy?.availableModels ?? []).map((model) => ({
          id: model.modelId,
          name: model.name,
          description: model.description ?? undefined,
          isDefault: model.modelId === legacy?.currentModelId,
        }))
    const modelOption = acpModelOption(config)
    if (agent.model && modelOption && modelOption.currentValue !== agent.model) {
      config = (
        await acpControl(
          connection,
          connection.rpc.request(methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: modelOption.id,
            value: agent.model,
          }),
          'model discovery',
        )
      ).configOptions
      if (acpModelOption(config)?.currentValue !== agent.model)
        throw new Error(`ACP did not apply ${modelOption.name}: ${agent.model}`)
    }
    if (agent.model && !modelOption) {
      if (!legacy?.availableModels.some((model) => model.modelId === agent.model))
        throw new Error('ACP agent does not offer the selected model')
      if (legacyModel !== agent.model) {
        updatedConfig = undefined
        await acpControl(
          connection,
          connection.rpc.request('session/set_model', {
            sessionId: session.sessionId,
            modelId: agent.model,
          }),
          'model selection',
        )
        legacyModel = agent.model
        config = updatedConfig ?? config
      }
    }
    for (const [configId, value] of Object.entries(agent.acpConfig ?? {})) {
      if (agent.model && acpModelOption(config)?.id === configId) continue
      const option = config?.find((item) => item.id === configId)
      if (!config || !option) throw new Error(`ACP configuration ${configId} is unavailable`)
      if (agent.acpMode && acpV1ModeOption(config)?.id === configId) continue
      config = await applyAcpV1Option(connection, session.sessionId, config, option, value)
    }
    const currentModel = acpModelOption(config)?.currentValue ?? legacyModel
    const currentReasoning = config?.find(
      (option) => option.category === 'thought_level' && option.type === 'select',
    )?.currentValue
    const modes = options(config, 'mode')
    const catalog: ModelCatalog = {
      models: models.map((model) => ({
        ...model,
        isDefault: model.id === currentModel,
        ...(model.id === currentModel && typeof currentReasoning === 'string'
          ? { defaultReasoning: currentReasoning }
          : {}),
      })),
      reasoning: options(config, 'thought_level'),
      acp: {
        modes: modes.length
          ? modes
          : (session.modes?.availableModes.map(({ id, name }) => ({ id, name })) ?? []),
        configOptions: (config ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category ?? undefined,
          currentValue: String(item.currentValue),
          options:
            item.type === 'boolean'
              ? [
                  { id: 'true', name: 'On' },
                  { id: 'false', name: 'Off' },
                ]
              : item.options
                  .flatMap((choice) => ('options' in choice ? choice.options : [choice]))
                  .map((choice) => ({ id: choice.value, name: choice.name })),
        })),
        commands,
      },
    }
    succeeded = true
    return catalog
  } finally {
    try {
      if (succeeded && canClose && closeSessionId && !connection.signal.aborted)
        await acpControl(
          connection,
          connection.rpc.request(methods.agent.session.close, { sessionId: closeSessionId }),
          'session close',
        )
    } finally {
      await connection.close()
    }
  }
}
